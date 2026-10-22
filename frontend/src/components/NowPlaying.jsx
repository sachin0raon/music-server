import { useEffect, useRef, useState } from "react";
import useFocusTrap from "./useFocusTrap";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CaretDownIcon as CaretDown, DotsThreeIcon as DotsThree, QueueIcon as Queue } from "@phosphor-icons/react";
import Cover, { useDominantColor } from "./Cover";
import Chip from "./Chip";
import TrackMenu from "./TrackMenu";
import QueueSheet from "./QueueSheet";
import { Button, IconButton } from "./Button";
import PlayerControls from "./PlayerControls";
import SeekBar from "./SeekBar";
import VolumeRow from "./VolumeControl";
import { api, fmt, fmtBitrate, fmtHz } from "../api";
import { useData, useFetch, usePlayer } from "../state";
import { transition } from "../motion";

export default function NowPlaying() {
  const { track, queue, index, next, setOpen, patchTrack, repeat } = usePlayer();
  const { bump } = useData();
  const color = useDominantColor(track);
  const reduce = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [err, setErr] = useState("");
  const [importing, setImporting] = useState(false);
  const isFolder = track?.source === "folder"; // a preview from the server folder
  // With repeat all/one, the end of the list wraps, so that is what comes next.
  const upNext = queue[index + 1] ?? (repeat !== "off" && queue.length > 1 ? queue[0] : undefined);
  const { data: info } = useFetch(track && !isFolder ? `/api/tracks/${track.id}` : null);
  // Guard against a stale response from the previous track while the new one loads.
  // When playing from the server folder, track already carries full extracted metadata.
  const meta = isFolder ? track : (info && info.id === track?.id ? info : null);
  const extra = meta ? [meta.album, meta.year, meta.genre].filter(Boolean).join(" · ") : "";
  const specs = meta ? [fmtBitrate(meta.bitrate), fmtHz(meta.sample_rate)].filter(Boolean).join(" · ") : "";
  const root = useRef(null);
  useFocusTrap(root);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !menu && !queueOpen && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, queueOpen, setOpen]);
  if (!track) return null; // e.g. the playing track was just deleted

  const toggleShare = async () => {
    setErr("");
    try {
      const t = await api.put(`/api/tracks/${track.id}/share`, { shared: !track.is_shared });
      patchTrack(track.id, { is_shared: t.is_shared });
      bump();
    } catch (e) { setErr(e.message); }
  };

  // Keep a folder song by copying it into this user's library, from the player.
  const importThis = async () => {
    if (importing) return;
    setImporting(true); setErr("");
    try {
      const d = await api.post("/api/library/import", { tokens: [track.id] });
      const r = d.results?.[0];
      if (r?.status === "ok" || r?.status === "duplicate") { patchTrack(track.id, { in_library: true }); bump(); }
      else setErr(r?.detail || "Could not import this file");
    } catch (e) { setErr(e.message); }
    finally { setImporting(false); }
  };

  return (
    <motion.div ref={root} className="fixed inset-0 z-40 overflow-hidden bg-ground" role="dialog" aria-modal="true" aria-label="Now playing"
      initial={{ y: reduce ? 0 : "100%" }} animate={{ y: 0 }} exit={{ y: reduce ? 0 : "100%" }}
      transition={transition.sheet}>
      {/* The glow layer is tied to the viewport, so it must not sit inside the
          scroller: only the content scrolls, and the background stays put. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-[background] duration-1000"
        style={{
          background: `radial-gradient(ellipse 80% 55% at 0% 0%, color-mix(in srgb, ${color} 50%, transparent) 0%, transparent 75%), radial-gradient(ellipse 65% 50% at 100% 100%, color-mix(in srgb, var(--color-glow-b) 40%, transparent) 0%, transparent 70%), var(--color-ground)`,
        }}
      />
      <div className="relative h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-md flex-col gap-6 [@media(max-height:500px)]:gap-3 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] lg:max-w-5xl">
          <div className="flex items-center justify-between">
            <IconButton label="Close player" variant="glass" onClick={() => setOpen(false)}><CaretDown size={20} /></IconButton>
            <div className="flex items-center gap-2">
              <IconButton label="Queue" variant="glass" onClick={() => setQueueOpen(true)}><Queue size={20} /></IconButton>
              <IconButton label="More options" variant="glass" onClick={() => setMenu(true)}><DotsThree size={22} weight="bold" /></IconButton>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-6 [@media(max-height:500px)]:gap-3 lg:grid lg:grid-cols-2 lg:items-center lg:gap-16">
            <div className="relative self-center lg:justify-self-end">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={track.id} initial={{ scale: reduce ? 1 : 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: reduce ? 1 : 0.96, opacity: 0 }}
                  transition={transition.base}>
                  <Cover track={track} rounded="rounded-[28px]" eager className="h-[min(350px,calc(100vw-2.5rem),40dvh)] w-[min(350px,calc(100vw-2.5rem),40dvh)] shadow-float lg:h-[min(440px,62dvh)] lg:w-[min(440px,62dvh)]" />
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex flex-col gap-6 [@media(max-height:500px)]:gap-3 lg:max-w-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="line-clamp-2 text-title font-semibold">{track.title}</h1>
                  <p className="truncate text-body text-mute">{track.artist}</p>
                  {extra && <p className="truncate text-small text-mute">{extra}</p>}
                  {specs && <p className="tnum truncate text-small text-mute">{specs}</p>}
                </div>
                {isFolder ? (
                  track.in_library ? (
                    <Chip variant="soft" className="shrink-0">In your library</Chip>
                  ) : (
                    <Button variant="accent" onClick={importThis} disabled={importing} className="shrink-0">
                      {importing ? "Importing" : "Import this"}
                    </Button>
                  )
                ) : track.owned ? (
                  <Button onClick={toggleShare} aria-pressed={!!track.is_shared} className="shrink-0">
                    {track.is_shared && <span className="h-2 w-2 rounded-full bg-accent" />}{track.is_shared ? "Shared" : "Share"}
                  </Button>
                ) : track.owner ? <span className="shrink-0 text-small text-mute">Shared by {track.owner}</span> : null}
              </div>
              {err && <p role="alert" className="-mt-3 text-small text-danger">{err}</p>}

              <SeekBar />
              <PlayerControls size="lg" />
              <VolumeRow />

              {upNext && (
                <button onClick={() => next(false)} className="glass interactive flex items-center gap-3 rounded-tile p-3 text-left" aria-label={`Play next: ${upNext.title}`}>
                  <Cover track={upNext} className="h-11 w-11" />
                  <span className="min-w-0 flex-1"><span className="block text-micro text-mute">Up next</span><span className="block truncate text-body font-medium">{upNext.title}</span></span>
                  <span className="tnum text-small text-mute">{fmt(upNext.duration)}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <AnimatePresence>{menu && <TrackMenu key="menu" track={track} fullScreen onClose={() => setMenu(false)} />}</AnimatePresence>
      <AnimatePresence>{queueOpen && <QueueSheet key="queue" fullScreen onClose={() => setQueueOpen(false)} />}</AnimatePresence>
    </motion.div>
  );
}
