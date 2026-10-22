import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowsClockwise, PencilSimple } from "@phosphor-icons/react";
import Cover from "./Cover";
import Chip from "./Chip";
import Field from "./Field";
import { Button, IconButton } from "./Button";
import { Skeleton, ErrorBox } from "./States";
import { api, fmt, fmtBitrate, fmtChannels, fmtDate, fmtHz, fmtSize } from "../api";
import { useAuth, useData, useFetch, usePlayer } from "../state";
const MISSING = <span className="text-mute">—</span>;

// Track and disc are one row, but either can stand alone: a file can carry a
// disc number without a track number, and both must still be visible.
const trackLabel = (n, disc) => {
  const parts = [];
  if (n) parts.push(String(n));
  if (disc) parts.push(n ? `disc ${disc}` : `Disc ${disc}`);
  return parts.length ? parts.join(" · ") : null;
};

function Row({ label, children }) {
  return (
    <div className="min-w-0 border-b border-line py-2.5 last:border-0 sm:col-span-1">
      <dt className="text-micro font-medium uppercase tracking-wider text-mute">{label}</dt>
      <dd className="tnum mt-0.5 truncate text-body">{children ?? MISSING}</dd>
    </div>
  );
}

// The full metadata grid, given a detail object from GET /api/tracks/{id} or /api/library/file/{token}.
// Missing values show a dash instead of an empty or hidden row.
export function TrackDetails({ track: initialTrack, onUpdated, editing: controlledEditing, onEditingChange }) {
  const [track, setTrack] = useState(initialTrack);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [internalEditing, setInternalEditing] = useState(false);
  const editing = controlledEditing !== undefined ? controlledEditing : internalEditing;
  const setEditing = onEditingChange || setInternalEditing;
  const [err, setErr] = useState("");
  const [form, setForm] = useState({
    title: initialTrack?.title || "",
    artist: initialTrack?.artist || "",
    album: initialTrack?.album || "",
    composer: initialTrack?.composer || "",
    genre: initialTrack?.genre || "",
    year: initialTrack?.year ? String(initialTrack.year) : "",
  });
  const { user } = useAuth();
  const { bump } = useData();
  const { patchTrack } = usePlayer();

  useEffect(() => {
    setTrack(initialTrack);
    setForm({
      title: initialTrack?.title || "",
      artist: initialTrack?.artist || "",
      album: initialTrack?.album || "",
      composer: initialTrack?.composer || "",
      genre: initialTrack?.genre || "",
      year: initialTrack?.year ? String(initialTrack.year) : "",
    });
  }, [initialTrack]);

  const isFolder = track.source === "folder";
  const canRefetch = isFolder || track.owned;
  const canEdit = isFolder ? Boolean(user?.is_admin) : Boolean(track.owned);

  const startEditing = () => {
    setForm({
      title: track.title || "",
      artist: track.artist || "",
      album: track.album || "",
      composer: track.composer || "",
      genre: track.genre || "",
      year: track.year ? String(track.year) : "",
    });
    setErr("");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setErr("");
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || saving) return;
    setSaving(true);
    setErr("");
    try {
      const payload = {
        title: form.title.trim(),
        artist: form.artist.trim() || "Unknown Artist",
        album: form.album.trim() || null,
        composer: form.composer.trim() || null,
        genre: form.genre.trim() || null,
        year: form.year.trim() ? parseInt(form.year.trim(), 10) : null,
      };
      const endpoint = isFolder
        ? `/api/library/file/${track.id}`
        : `/api/tracks/${track.id}`;
      const updated = await api.patch(endpoint, payload);
      const fullTrack = {
        ...track,
        ...updated,
      };
      setTrack(fullTrack);
      onUpdated?.(fullTrack);
      patchTrack(track.id, fullTrack);
      bump();
      setEditing(false);
    } catch (e) {
      setErr(e.message || "Could not save track details");
    } finally {
      setSaving(false);
    }
  };
  const handleRefetch = async () => {
    setBusy(true);
    setErr("");
    try {
      const endpoint = isFolder
        ? `/api/library/file/${track.id}/refetch`
        : `/api/tracks/${track.id}/refetch`;
      const updated = await api.post(endpoint);
      const cacheBust = Date.now();
      const cover_url = isFolder
        ? (updated.has_cover ? `/api/library/file/${track.id}/cover?t=${cacheBust}` : null)
        : (updated.has_cover ? `/api/tracks/${track.id}/cover?t=${cacheBust}` : null);
      const fullTrack = {
        ...track,
        ...updated,
        cover_url,
      };
      setTrack(fullTrack);
      onUpdated?.(fullTrack);
      patchTrack(track.id, fullTrack);
      bump();
    } catch (e) {
      setErr(e.message || "Could not refetch track details");
    } finally {
      setBusy(false);
    }
  };

  const num = (n) => (n === null || n === undefined ? null : String(n));
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: "easeOut" }}>
      <div className="mb-5 flex items-start gap-4">
        <Cover track={track} className="h-20 w-20 shrink-0" rounded="rounded-2xl" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-heading font-semibold leading-snug">{track.title}</p>
          <p className="break-words text-small text-mute">{track.artist}</p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {track.source === "folder" ? (
              <Chip variant="soft">{track.in_library ? "In your library" : "Server file"}</Chip>
            ) : track.owned ? (
              <Chip variant={track.is_shared ? "accent" : "soft"}>{track.is_shared ? "Shared" : "Private"}</Chip>
            ) : track.owner && (
              <Chip variant="soft">Shared by {track.owner}</Chip>
            )}
            {track.format && <Chip variant="soft">{track.format}</Chip>}
          </p>
        </div>
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="space-y-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              placeholder="Track title"
              aria-label="Track title"
            />
            <Field
              label="Artist"
              value={form.artist}
              onChange={(e) => setForm((f) => ({ ...f, artist: e.target.value }))}
              placeholder="Artist name"
              aria-label="Artist name"
            />
            <Field
              label="Album"
              value={form.album}
              onChange={(e) => setForm((f) => ({ ...f, album: e.target.value }))}
              placeholder="Album name"
              aria-label="Album name"
            />
            <Field
              label="Composer"
              value={form.composer}
              onChange={(e) => setForm((f) => ({ ...f, composer: e.target.value }))}
              placeholder="Composer"
              aria-label="Composer"
            />
            <Field
              label="Genre"
              value={form.genre}
              onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}
              placeholder="Genre"
              aria-label="Genre"
            />
            <Field
              label="Year"
              type="number"
              min="1000"
              max="3000"
              value={form.year}
              onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
              placeholder="Year (e.g. 2024)"
              aria-label="Release year"
            />
          </div>
          {err && <p role="alert" className="text-small text-danger">{err}</p>}
          <div className="flex items-center gap-2 pt-2">
            <Button type="button" variant="glass" onClick={cancelEditing} disabled={saving} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" variant="accent" disabled={saving || !form.title.trim()} className="flex-1">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <Row label="Album">{track.album || null}</Row>
            <Row label="Artist">{track.artist}</Row>
            <Row label="Composer">{track.composer || null}</Row>
            <Row label="Genre">{track.genre || null}</Row>
            <Row label="Year">{num(track.year)}</Row>
            <Row label="Duration">{track.duration ? fmt(track.duration) : null}</Row>
            <Row label="Track">{trackLabel(track.track_number, track.disc_number)}</Row>
            <Row label="Bitrate">{fmtBitrate(track.bitrate)}</Row>
            <Row label="Sample rate">{fmtHz(track.sample_rate)}</Row>
            <Row label="Channels">{fmtChannels(track.channels)}</Row>
            <Row label="File size">{fmtSize(track.file_size)}</Row>
            <Row label="Added">{fmtDate(track.created_at)}</Row>
          </dl>

          {canRefetch && (
            <div className="mt-5 border-t border-line pt-4">
              <Button
                variant="glass"
                onClick={handleRefetch}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2"
              >
                <ArrowsClockwise size={18} className={busy ? "animate-spin" : ""} weight="bold" />
                {busy ? "Refetching details..." : "Refetch track details"}
              </Button>
              {err && <p role="alert" className="mt-2 text-center text-small text-danger">{err}</p>}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

// Fetches the detail for one track id and renders the grid with loading/error states
export default function TrackDetailsLoader({ trackId, track: initialTrack, editing, onEditingChange }) {
  const isFolder = initialTrack?.source === "folder";
  const url = isFolder ? `/api/library/file/${trackId}` : (trackId ? `/api/tracks/${trackId}` : null);
  const ready = initialTrack && (initialTrack.bitrate !== undefined || initialTrack.format !== undefined);
  const { data, loading, error, reload } = useFetch(!ready ? url : null);
  const [overrideTrack, setOverrideTrack] = useState(null);
  const track = overrideTrack || (ready ? initialTrack : data);
  if (loading && !track) return <Skeleton rows={4} />;
  if (error && !track) return <ErrorBox message={error || "Track not found"} onRetry={reload} />;
  if (!track) return null;
  return (
    <TrackDetails
      track={track}
      onUpdated={setOverrideTrack}
      editing={editing}
      onEditingChange={onEditingChange}
    />
  );
}
