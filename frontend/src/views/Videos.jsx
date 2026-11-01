import { useState } from "react";
import { Link } from "react-router-dom";
import { DownloadSimpleIcon as DownloadSimple, TrashIcon as Trash, FilmSlateIcon as FilmSlate, LinkSimpleIcon as LinkSimple, PlusIcon as Plus } from "@phosphor-icons/react";
import PageHeader from "../components/PageHeader";
import GlassPanel from "../components/GlassPanel";
import Modal from "../components/Modal";
import { Button, IconButton } from "../components/Button";
import { Skeleton, ErrorBox, Empty } from "../components/States";
import { api, fmt, fmtSize as size } from "../api";
import { useFetch, useToast } from "../state";

// Resolution reads better than raw pixels, and the height is what people name.
const quality = (v) => (v.height ? `${v.height}p` : "");

function VideoCard({ video, onDelete }) {
  const detail = [quality(video), video.duration ? fmt(video.duration) : "", size(video.file_size)]
    .filter(Boolean).join(" · ");
  return (
    <GlassPanel as="li" className="flex gap-3 p-3">
      <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-xl bg-white/5">
        {video.has_thumb ? (
          <img src={`/api/videos/${video.id}/thumb`} alt="" loading="lazy" decoding="async"
            className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-mute"><FilmSlate size={22} /></span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium">{video.title}</p>
        {video.uploader && <p className="truncate text-small text-mute">{video.uploader}</p>}
        <p className="truncate text-micro text-mute">
          {detail}
          {/* Keyed on the codecs, not the extension. Asking yt-dlp for mp4
              always yields mp4, and ffmpeg will put VP9 and Opus inside it,
              so ".mp4" says nothing about whether a phone can open it. */}
          {video.apple_ok === false && (
            <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5"
              title={`${video.vcodec || "?"} / ${video.acodec || "?"} \u2014 iPhone and Safari may not play this`}>
              {[video.vcodec, video.acodec].filter(Boolean).join(" / ") || "codecs"}
            </span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-start gap-1">
        {/* A plain link, not fetch: the session cookie already authorises it, so
            the browser transfers it with its own progress and resumability
            instead of the page holding gigabytes in memory. */}
        <IconButton as="a" href={`/api/videos/${video.id}/file`} download size="sm"
          label={`Download ${video.title}`} className="text-mute hover:text-ink">
          <DownloadSimple size={18} weight="bold" />
        </IconButton>
        <IconButton size="sm" label={`Delete ${video.title}`} onClick={() => onDelete(video)}
          className="text-mute hover:text-danger">
          <Trash size={18} weight="bold" />
        </IconButton>
      </div>
    </GlassPanel>
  );
}

// Videos downloaded through the link importer. Private by construction: the
// server has no route that shows anyone else's, and no way to share one.
export default function Videos() {
  const { data, loading, error, reload } = useFetch("/api/videos?limit=200");
  const { showToast } = useToast();
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.del(`/api/videos/${pending.id}`);
      showToast("Video deleted");
      setPending(null);
      reload();
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items || [];

  return (
    <>
      <PageHeader title="Videos" subtitle="Downloaded videos, private to you"
        actions={<IconButton as={Link} to="/upload" label="Add a video" variant="glass"><Plus size={20} /></IconButton>} />

      {/* Said here rather than only in the empty state: the question "how do I
          add another" arrives when the page already has videos on it, which is
          exactly when an empty state is not on screen. */}
      <p className="mb-4 max-w-[68ch] text-small text-mute">
        Videos come from <Link to="/upload" className="text-accent underline underline-offset-2">Add from a page</Link>{" "}
        on the Upload page &mdash; paste a link and choose a video format. Dropping a file there adds audio to your
        library, not video.
      </p>

      {loading ? <Skeleton rows={3} /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        items.length === 0 ? (
          <Empty icon={FilmSlate} title="No videos yet"
            action={<Button as={Link} to="/upload" variant="accent">Go to Upload</Button>}>
            Paste a link there and pick a video format to download one.
          </Empty>
        ) : (
          <ul className="space-y-2">
            {items.map((v) => <VideoCard key={v.id} video={v} onDelete={setPending} />)}
          </ul>
        )
      )}

      {pending && (
        <Modal label="Confirm delete" title="Delete this video?"
          onClose={() => (busy ? null : setPending(null))}>
          <p className="text-body text-mute">
            <span className="text-ink">{pending.title}</span> will be removed from the server.
            {pending.file_size ? ` That frees ${size(pending.file_size)}.` : ""} It can&rsquo;t be undone,
            and re-downloading it means fetching the whole file again.
          </p>
          {pending.source_url && (
            <p className="mt-2 truncate text-micro text-mute">
              <LinkSimple size={12} className="mr-1 inline" />{pending.source_url}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setPending(null)} disabled={busy} className="flex-1">Keep it</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={busy} className="flex-1">
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
