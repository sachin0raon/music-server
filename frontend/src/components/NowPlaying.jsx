import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CaretDown, DotsThree, Pause, Play, SkipBack, SkipForward } from "@phosphor-icons/react";
import Cover, { useDominantColor } from "./Cover";
import TrackMenu from "./TrackMenu";
import { api, fmt } from "../api";
import { useData, usePlayer, useTime } from "../state";

export default function NowPlaying() {
  const { track, queue, index, playing, toggle, next, prev, seek, setOpen, patchTrack } = usePlayer();
  const { time, duration } = useTime();
  const { bump } = useData();
  const color = useDominantColor(track);
  const reduce = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState("");
  const upNext = queue[index + 1];
  const max = duration || 0;
  const pct = max ? Math.min(100, (time / max) * 100) : 0;
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
    <motion.div className="fixed inset-0 z-40 overflow-y-auto bg-ground" role="dialog" aria-modal="true" aria-label="Now playing"
      initial={{ y: reduce ? 0 : "100%" }} animate={{ y: 0 }} exit={{ y: reduce ? 0 : "100%" }}
      transition={{ type: "spring", damping: 34, stiffness: 300 }}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-10 -top-20 h-[460px] w-[460px] rounded-full opacity-75 blur-[90px] transition-colors duration-1000" style={{ background: color }} />
        <div className="absolute -right-36 bottom-0 h-[340px] w-[340px] rounded-full bg-[#26407a] opacity-55 blur-[90px]" />
      </div>
      <div className="relative mx-auto flex min-h-full max-w-md flex-col gap-6 [@media(max-height:500px)]:gap-3 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <button onClick={() => setOpen(false)} aria-label="Close player" className="btn-round glass"><CaretDown size={20} /></button>
          <button onClick={() => setMenu(true)} aria-label="More options" className="btn-round glass"><DotsThree size={22} weight="bold" /></button>
        </div>

        <motion.div key={track.id} initial={{ scale: reduce ? 1 : 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 26, stiffness: 260 }} className="self-center">
          <Cover track={track} rounded="rounded-[28px]" className="h-[min(350px,calc(100vw-2.5rem),40dvh)] w-[min(350px,calc(100vw-2.5rem),40dvh)] border border-white/15 shadow-[0_30px_60px_rgba(0,0,0,0.5)]" />
        </motion.div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-[28px] font-medium leading-tight tracking-tight">{track.title}</h1>
            <p className="truncate text-base text-mute">{track.artist}</p>
          </div>
          {track.owned ? (
            <button onClick={toggleShare} aria-pressed={!!track.is_shared} className="btn glass shrink-0">
              {track.is_shared && <span className="h-2 w-2 rounded-full bg-accent" />}{track.is_shared ? "Shared" : "Share"}
            </button>
          ) : track.owner ? <span className="shrink-0 text-sm text-mute">Shared by {track.owner}</span> : null}
        </div>
        {err && <p role="alert" className="-mt-3 text-[15px] text-[#ff8a8a]">{err}</p>}

        <div>
          <input type="range" className="seek" min={0} max={max} step={0.1} value={Math.min(time, max)} onChange={(e) => seek(+e.target.value)}
            aria-label="Seek" aria-valuetext={`${fmt(time)} of ${fmt(max)}`} style={{ "--p": `${pct}%` }} />
          <div className="tnum flex justify-between text-[13px] text-mute"><span>{fmt(time)}</span><span>{fmt(max)}</span></div>
        </div>

        <div className="flex items-center justify-center gap-9">
          <button onClick={prev} aria-label="Previous" className="grid h-[52px] w-[52px] place-items-center"><SkipBack size={28} weight="fill" /></button>
          <button onClick={toggle} aria-label={playing ? "Pause" : "Play"}
            className="grid h-[76px] w-[76px] place-items-center rounded-full bg-accent text-[#0a0b0d] shadow-[0_0_40px_rgba(200,230,76,0.28)]">
            {playing ? <Pause size={30} weight="fill" /> : <Play size={30} weight="fill" />}
          </button>
          <button onClick={() => next(false)} disabled={!upNext} aria-label="Next" className="grid h-[52px] w-[52px] place-items-center disabled:opacity-40"><SkipForward size={28} weight="fill" /></button>
        </div>

        {upNext && (
          <button onClick={() => next(false)} className="glass mt-auto flex items-center gap-3 rounded-[20px] p-3 text-left" aria-label={`Play next: ${upNext.title}`}>
            <Cover track={upNext} className="h-10 w-10" />
            <span className="min-w-0 flex-1"><span className="block text-xs text-mute">Up next</span><span className="block truncate text-[15px] font-medium">{upNext.title}</span></span>
            <span className="tnum text-[13px] text-mute">{fmt(upNext.duration)}</span>
          </button>
        )}
      </div>
      <AnimatePresence>{menu && <TrackMenu key="menu" track={track} onClose={() => setMenu(false)} />}</AnimatePresence>
    </motion.div>
  );
}
