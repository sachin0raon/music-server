from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String,
    Text, UniqueConstraint, func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # utf8mb4 default collation is case-insensitive, so "Sam" and "sam" collide
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    tracks: Mapped[list["Track"]] = relationship(back_populates="owner", cascade="all, delete-orphan", passive_deletes=True)
    videos: Mapped[list["Video"]] = relationship(back_populates="owner", cascade="all, delete-orphan", passive_deletes=True)
    telegram_account: Mapped["TelegramAccount | None"] = relationship(back_populates="owner", cascade="all, delete-orphan", passive_deletes=True)


class Session(Base):
    """Server-side login session. `id` is the SHA-256 hash of the cookie token."""
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)


class Track(Base):
    __tablename__ = "tracks"
    __table_args__ = (
        # Per-user duplicate detection
        UniqueConstraint("owner_id", "content_hash", name="uq_track_owner_hash"),
        # Fast "my tracks OR shared tracks" lookups
        Index("ix_track_shared", "is_shared", "shared_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Path relative to the data dir, e.g. users/3/ab12cd.flac. Never sent to clients.
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    artist: Mapped[str] = mapped_column(String(255), default="Unknown Artist", nullable=False)
    album: Mapped[str | None] = mapped_column(String(255), nullable=True)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    cover_path: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Audio metadata, best-effort from the file tags (all nullable; older rows have NULL)
    bitrate: Mapped[int | None] = mapped_column(Integer, nullable=True)  # bits per second
    sample_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)  # Hz
    channels: Mapped[int | None] = mapped_column(Integer, nullable=True)
    format: Mapped[str | None] = mapped_column(String(32), nullable=True)  # e.g. "MP3", "FLAC", "Opus"
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    genre: Mapped[str | None] = mapped_column(String(64), nullable=True)
    track_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    disc_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    composer: Mapped[str | None] = mapped_column(String(255), nullable=True)

    is_shared: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    shared_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    owner: Mapped[User] = relationship(back_populates="tracks")


class Playlist(Base):
    __tablename__ = "playlists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class PlaylistTrack(Base):
    __tablename__ = "playlist_tracks"
    __table_args__ = (UniqueConstraint("playlist_id", "track_id", name="uq_playlist_track"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    playlist_id: Mapped[int] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False, index=True)
    # Deleting a track removes it from every playlist (DB-level cascade)
    track_id: Mapped[int] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Video(Base):
    """A downloaded video. Deliberately not a Track.

    Sharing, playlists and the play queue all key off `tracks`, so keeping
    videos in their own table makes those unreachable rather than merely
    filtered out -- there is no `is_shared` column here to set, and no foreign
    key pointing at this table. A video is private to its owner by construction
    rather than by remembering to add a WHERE clause in every new query.
    """

    __tablename__ = "videos"
    __table_args__ = (
        # The same link at the same quality is the realistic duplicate. Hashed
        # because the URL is far too long to index: utf8mb4 is 4 bytes per
        # character against InnoDB's 3072-byte key limit.
        UniqueConstraint("owner_id", "source_hash", name="uq_video_owner_source"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Relative to the data dir, like Track.file_path. Never sent to clients.
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    uploader: Mapped[str | None] = mapped_column(String(255), nullable=True)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    container: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Read off the finished file with ffprobe, because the container does not
    # answer the question people actually have. Asking for mp4 always gets mp4
    # -- yt-dlp disables its mkv fallback once a format is named -- and ffmpeg
    # will happily put VP9 and Opus inside it, which an iPhone then refuses to
    # play despite the .mp4 on the end.
    vcodec: Mapped[str | None] = mapped_column(String(32), nullable=True)
    acodec: Mapped[str | None] = mapped_column(String(32), nullable=True)

    source_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    format_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    thumb_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    # Set once a Telegram upload finishes. The chat name is a snapshot, not a
    # live join to TelegramAccount.target_chat_title: re-targeting later must
    # not relabel where a past upload actually went.
    telegram_uploaded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    telegram_chat_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Also snapshotted, not read from the live TelegramAccount row: building a
    # link needs the chat's id and type, and by the time someone looks at an
    # old upload's badge the current target may be a different chat entirely.
    telegram_chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    telegram_chat_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    telegram_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    owner: Mapped[User] = relationship(back_populates="videos")


class TelegramAccount(Base):
    """A user's own Telegram login, used to upload videos to a chat they pick.

    One row per user, not a flag on User: this is optional configuration with
    its own lifecycle -- connect, disconnect, reconnect, relogin -- not an
    intrinsic property of the account, the same reasoning that kept Video off
    Track.

    api_hash and session_string are plaintext, consistent with cookies.txt:
    whoever reached this credential on disk already reached everything else on
    this server. session_string is a live Telegram login -- full account
    control, not just one site's download access -- which is a materially
    larger risk than the cookie file, accepted explicitly rather than assumed.
    """

    __tablename__ = "telegram_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)

    api_id: Mapped[int] = mapped_column(Integer, nullable=False)
    api_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Display only ("+91 xxxx…"); never re-sent to Telegram once logged in.
    phone_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Set once a login completes. Never returned to the browser as a value to
    # copy -- only its presence (via `status`) is ever exposed.
    session_string: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Flips on login success and reconnect, off on disconnect. Never implies a
    # live connection is held open -- nothing in this feature keeps one: every
    # operation connects fresh and disconnects when done. This is purely the
    # status the UI shows.
    is_connected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    target_chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    target_chat_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_chat_type: Mapped[str | None] = mapped_column(String(16), nullable=True)  # channel | group | saved

    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    owner: Mapped[User] = relationship(back_populates="telegram_account")
