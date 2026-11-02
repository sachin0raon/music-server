import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DotsThreeIcon as DotsThree, FilmSlateIcon as FilmSlate, PlusIcon as Plus } from "@phosphor-icons/react";
import PageHeader from "../components/PageHeader";
import GlassPanel from "../components/GlassPanel";
import VideoMenu from "../components/VideoMenu";
import { Button, IconButton } from "../components/Button";
import { Skeleton, ErrorBox, Empty } from "../components/States";
import { api, fmt, fmtSize as size } from "../api";
import { staggerDelay, transition } from "../motion";
import { useFetch } from "../state";

const POLL_MS = 1000;
const RUNNING = new Set(["queued", "uploading"]);

// Resolution reads better than raw pixels, and the height is what people name.
const quality = (v) => (v.height ? `${v.height}p` : "");

function VideoCard({ video, job, onMenu, index }) {
  const reduce = useReducedMotion();
  const detail = [quality(video), video.duration ? fmt(video.duration) : "", size(video.file_size)]
    .filter(Boolean).join(" · ");
  return (
    // The same entrance every other list in the app gives a newly loaded row
    // (TrackRow, playlist tiles) -- this was the one list with none at all.
    <GlassPanel as={motion.li} initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -8, transition: reduce ? { duration: 0 } : transition.fast }}
      transition={reduce ? { duration: 0 } : { ...transition.base, delay: staggerDelay(index) }}
      className="flex flex-col gap-2 p-3">
      <div className="flex gap-3">
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
                title={`${video.vcodec || "?"} / ${video.acodec || "?"} — iPhone and Safari may not play this`}>
                {[video.vcodec, video.acodec].filter(Boolean).join(" / ") || "codecs"}
              </span>
            )}
            {video.telegram_uploaded_at && (
              <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-accent">
                Sent to {video.telegram_chat_title}
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
      </div>

      {/* Lives on the card, not only inside the menu: closing the menu after
          starting an upload must not make the progress disappear. */}
      {job && RUNNING.has(job.state) && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-accent transition-[width] duration-[220ms]"
              style={{ width: `${job.state === "uploading" ? job.percent : 4}%` }} />
          </div>
          <p className="mt-1 text-micro text-mute">
            {job.state === "queued" ? "Waiting to upload to Telegram…" : `Uploading to Telegram… ${Math.round(job.percent)}%`}
          </p>
        </div>
      )}
    </GlassPanel>
  );
}

// Videos downloaded through the link importer. Private by construction: the
// server has no route that shows anyone else's, and no way to share one.
export default function Videos() {
  const { data, loading, error, reload } = useFetch("/api/videos?limit=200");
  const [menu, setMenu] = useState(null);
  const [telegram, setTelegram] = useState(null);
  const [jobs, setJobs] = useState([]);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const pollingRef = useRef(false);
  // Once reloaded for, never again: a finished job sits in the list until its
  // own TTL sweep, and every tick in between must not refetch the video list
  // a second time for the same completion.
  const reloadedForRef = useRef(new Set());

  useEffect(() => {
    api.get("/api/telegram/account").then(setTelegram).catch(() => setTelegram({ is_connected: false }));
  }, []);

  // Adopt anything already running -- same reason MediaLinkImport does this
  // for downloads: the job id otherwise lives only in the tab that started
  // it, so navigating away and back would leave it running with nothing
  // watching it. Also what keeps polling going after starting a new upload.
  const poll = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    const tick = async () => {
      try {
        const d = await api.get("/api/telegram/jobs");
        setJobs(d.jobs || []);
        for (const j of d.jobs || []) {
          if (j.state === "done" && !reloadedForRef.current.has(j.id)) {
            reloadedForRef.current.add(j.id);
            reloadRef.current(); // picks up the real badge fields on the video
          }
        }
        if ((d.jobs || []).some((j) => RUNNING.has(j.state))) {
          setTimeout(tick, POLL_MS);
          return;
        }
      } catch { /* a missed tick just means the next one tries again */ }
      pollingRef.current = false;
    };
    tick();
  }, []);

  useEffect(() => { poll(); }, [poll]);

  const startUpload = useCallback(async (video) => {
    const job = await api.post("/api/telegram/upload", { video_id: video.id });
    setJobs((prev) => [...prev.filter((j) => j.video_id !== video.id), job]);
    poll();
  }, [poll]);

  const jobsByVideo = useMemo(() => Object.fromEntries(jobs.map((j) => [j.video_id, j])), [jobs]);
  const items = data?.items || [];

  return (
    <>
      <PageHeader title="Videos" subtitle="Downloaded videos, private to you"
        actions={<IconButton as={Link} to="/upload" label="Add a video" variant="glass"><Plus size={20} /></IconButton>} />

      {/* Said here rather than only in the empty state: the question "how do I
          add another" arrives when the page already has videos on it, which is
          exactly when an empty state is not on screen. */}
      <p className="mb-2 max-w-[68ch] text-small text-mute">
        Videos come from <Link to="/upload" className="text-accent underline underline-offset-2">Add from a page</Link>{" "}
        on the Upload page &mdash; paste a link and choose a video format. Dropping a file there adds audio to your
        library, not video.
      </p>

      {telegram && (
        <p className="mb-4 text-micro text-mute">
          Telegram: {telegram.is_connected
            ? <span className="text-accent">connected{telegram.target_chat_title ? ` · uploading to ${telegram.target_chat_title}` : ""}</span>
            : <>not connected &mdash; <Link to="/account" className="text-accent underline underline-offset-2">set up in Account</Link></>}
        </p>
      )}

      {loading ? <Skeleton rows={3} /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        items.length === 0 ? (
          <Empty icon={FilmSlate} title="No videos yet"
            action={<Button as={Link} to="/upload" variant="accent">Go to Upload</Button>}>
            Paste a link there and pick a video format to download one.
          </Empty>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence>
              {items.map((v, i) => (
                <VideoCard key={v.id} video={v} job={jobsByVideo[v.id]} onMenu={setMenu} index={i} />
              ))}
            </AnimatePresence>
          </ul>
        )
      )}

      {menu && (
        <VideoMenu video={menu} onClose={() => setMenu(null)} onDeleted={reload}
          telegram={telegram} job={jobsByVideo[menu.id]} onUpload={startUpload} />
      )}
    </>
  );
}
