import { Pause, Play } from "@phosphor-icons/react";
import Cover from "./Cover";
import { usePlayer, useTime } from "../state";

export default function PlayerBar() {
  const { track, playing, toggle, setOpen } = usePlayer();
  const { time, duration } = useTime();
  if (!track) return null;
  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] lg:bottom-4 lg:left-60">
      <div className="glass relative mx-auto flex max-w-2xl items-center gap-3 overflow-hidden rounded-card p-2.5 pr-3">
        <button onClick={() => setOpen(true)} aria-label={`Open player: ${track.title}`} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Cover track={track} className="h-11 w-11" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-medium">{track.title}</span>
            <span className="block truncate text-[13px] text-mute">{track.artist}</span>
          </span>
        </button>
        <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="btn-round bg-accent text-[#0a0b0d]">
          {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
        </button>
        <div className="absolute bottom-0 left-0 h-0.5 bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
