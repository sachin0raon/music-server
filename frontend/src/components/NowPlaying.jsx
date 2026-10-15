import { useEffect, useRef, useState } from "react";
import useFocusTrap from "./useFocusTrap";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CaretDown, DotsThree } from "@phosphor-icons/react";
import Cover, { useDominantColor } from "./Cover";
import TrackMenu from "./TrackMenu";
import { Button, IconButton } from "./Button";
import PlayerControls from "./PlayerControls";
import SeekBar from "./SeekBar";
import { api, fmt } from "../api";
import { useData, usePlayer } from "../state";

export default function NowPlaying() {
  const { track, queue, index, next, setOpen, patchTrack } = usePlayer();
  const { bump } = useData();
  const color = useDominantColor(track);
  const reduce = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState("");
  const upNext = queue[index + 1];
  const root = useRef(null);
  useFocusTrap(root);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !menu && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, setOpen]);
  if (!track) return null; // e.g. the playing track was just deleted

  const toggleShare = async () => {
    setErr("");
    try {
      const t = await api.put(`/api/tracks/${track.id}/share`, { shared: !track.is_shared });
      patchTrack(track.id, { is_shared: t.is_shared });
      bump();
    } catch (e) { setErr(e.message); }
  };

  return (
    <motion.div ref={root} className="fixed inset-0 z-40 overflow-y-auto bg-ground" role="dialog" aria-modal="true" aria-label="Now playing"
      initial={{ y: reduce ? 0 : "100%" }} animate={{ y: 0 }} exit={{ y: reduce ? 0 : "100%" }}
      transition={{ type: "spring", damping: 34, stiffness: 300 }}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-10 -top-20 h-[460px] w-[460px] rounded-full opacity-75 blur-[90px] transition-colors duration-1000" style={{ background: color }} />
        <div className="absolute -right-36 bottom-0 h-[340px] w-[340px] rounded-full bg-glow-b opacity-55 blur-[90px]" />
      </div>
      <div className="relative mx-auto flex min-h-full max-w-md flex-col gap-6 [@media(max-height:500px)]:gap-3 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] lg:max-w-5xl">
        <div className="flex items-center justify-between">
          <IconButton label="Close player" variant="glass" onClick={() => setOpen(false)}><CaretDown size={20} /></IconButton>
          <IconButton label="More options" variant="glass" onClick={() => setMenu(true)}><DotsThree size={22} weight="bold" /></IconButton>
        </div>

        <div className="flex flex-1 flex-col gap-6 [@media(max-height:500px)]:gap-3 lg:grid lg:grid-cols-2 lg:items-center lg:gap-16">
          <motion.div key={track.id} initial={{ scale: reduce ? 1 : 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 26, stiffness: 260 }} className="self-center lg:justify-self-end">
            <Cover track={track} rounded="rounded-[28px]" className="h-[min(350px,calc(100vw-2.5rem),40dvh)] w-[min(350px,calc(100vw-2.5rem),40dvh)] shadow-float lg:h-[min(440px,62dvh)] lg:w-[min(440px,62dvh)]" />
          </motion.div>

          <div className="flex flex-col gap-6 [@media(max-height:500px)]:gap-3 lg:max-w-md">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-title font-semibold">{track.title}</h1>
                <p className="truncate text-body text-mute">{track.artist}</p>
              </div>
              {track.owned ? (
                <Button onClick={toggleShare} aria-pressed={!!track.is_shared} className="shrink-0">
                  {track.is_shared && <span className="h-2 w-2 rounded-full bg-accent" />}{track.is_shared ? "Shared" : "Share"}
                </Button>
              ) : track.owner ? <span className="shrink-0 text-small text-mute">Shared by {track.owner}</span> : null}
            </div>
            {err && <p role="alert" className="-mt-3 text-small text-danger">{err}</p>}

            <SeekBar />
            <PlayerControls size="lg" />

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
      <AnimatePresence>{menu && <TrackMenu key="menu" track={track} onClose={() => setMenu(false)} />}</AnimatePresence>
    </motion.div>
  );
}
