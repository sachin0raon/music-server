import { useState } from "react";
import { Link } from "react-router-dom";
import { DotsThreeIcon as DotsThree, FilmSlateIcon as FilmSlate, PlusIcon as Plus } from "@phosphor-icons/react";
import PageHeader from "../components/PageHeader";
import GlassPanel from "../components/GlassPanel";
import VideoMenu from "../components/VideoMenu";
import { Button, IconButton } from "../components/Button";
import { Skeleton, ErrorBox, Empty } from "../components/States";
import { fmt, fmtSize as size } from "../api";
import { useFetch } from "../state";

// Resolution reads better than raw pixels, and the height is what people name.
const quality = (v) => (v.height ? `${v.height}p` : "");

function VideoCard({ video, onMenu }) {
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

      {/* One trigger rather than a row of icons: on a phone three of them left
          almost nothing for the title, and each was a guess until tapped. */}
      <IconButton label={`More options for ${video.title}`} onClick={() => onMenu(video)}
        className="shrink-0 self-start text-mute">
        <DotsThree size={24} weight="bold" />
      </IconButton>
    </GlassPanel>
  );
}

// Videos downloaded through the link importer. Private by construction: the
// server has no route that shows anyone else's, and no way to share one.
export default function Videos() {
  const { data, loading, error, reload } = useFetch("/api/videos?limit=200");
  const [menu, setMenu] = useState(null);

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
            {items.map((v) => <VideoCard key={v.id} video={v} onMenu={setMenu} />)}
          </ul>
        )
      )}

      {menu && (
        <VideoMenu video={menu} onClose={() => setMenu(null)} onDeleted={reload} />
      )}
    </>
  );
}
