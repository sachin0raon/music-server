import { fmt } from "../api";
import { usePlayer, useTime } from "../state";

// Native range input keeps keyboard and touch seeking for free. --p drives the fill.
export default function SeekBar({ inline = false, className = "" }) {
  const { seek } = usePlayer();
  const { time, duration } = useTime();
  const max = duration || 0;
  const pct = max ? Math.min(100, (time / max) * 100) : 0;
  const slider = (
    <input type="range" className="seek min-w-0 flex-1" min={0} max={max} step={0.1} value={Math.min(time, max)} onChange={(e) => seek(+e.target.value)}
      aria-label="Seek" aria-valuetext={`${fmt(time)} of ${fmt(max)}`} style={{ "--p": `${pct}%` }} />
  );
  return inline ? (
    <div className={`tnum flex items-center gap-2 text-micro text-mute ${className}`}>
      <span className="w-9 text-right">{fmt(time)}</span>{slider}<span className="w-9">{fmt(max)}</span>
    </div>
  ) : (
    <div className={className}>
      <div className="flex">{slider}</div>
      <div className="tnum flex justify-between text-small text-mute"><span>{fmt(time)}</span><span>{fmt(max)}</span></div>
    </div>
  );
}

// Thin read-only progress line along the bottom edge of the mini player
export function MiniProgress({ className = "" }) {
  const { time, duration } = useTime();
  const pct = duration ? Math.min(100, (time / duration) * 100) : 0;
  return (
    <div aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-[3px] bg-white/10 ${className}`}>
      <div className="h-full rounded-r-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}
