import { SpeakerHigh, SpeakerLow, SpeakerSlash } from "@phosphor-icons/react";
import { IconButton } from "./Button";
import GlassPanel from "./GlassPanel";
import { usePlayer } from "../state";

// The level the UI should show. Mute wins, and a slider left at 0 is silent too,
// so both collapse to 0 for the icon and the percentage.
export function useVolumeLevel() {
  const { volume, muted } = usePlayer();
  return muted ? 0 : volume;
}

export function SpeakerIcon({ level, size = 20 }) {
  if (level === 0) return <SpeakerSlash size={size} weight="bold" />;
  if (level < 0.5) return <SpeakerLow size={size} weight="bold" />;
  return <SpeakerHigh size={size} weight="bold" />;
}

// Native range input, styled by the shared .seek rules in index.css. --p drives the fill.
export function VolumeSlider({ className = "flex-1" }) {
  const { volume, setVolume } = usePlayer();
  const pct = Math.round(volume * 100);
  return (
    <input type="range" className={`seek min-w-0 ${className}`} min={0} max={1} step={0.01} value={volume}
      onChange={(e) => setVolume(+e.target.value)} aria-label="Volume" aria-valuetext={`${pct}%`} style={{ "--p": `${pct}%` }} />
  );
}

// The label reads the effective level, so it drops to 0% the moment Mute is on.
function MuteButton() {
  const { volume, muted, toggleMute } = usePlayer();
  const silent = muted || volume === 0;
  return (
    <IconButton label={silent ? "Unmute" : "Mute"} aria-pressed={silent} onClick={toggleMute}>
      <SpeakerIcon level={silent ? 0 : volume} />
    </IconButton>
  );
}

function Level({ level }) {
  return <span className="tnum w-9 text-right text-small text-mute">{Math.round(level * 100)}%</span>;
}

// Full-screen player: an always-visible row under the transport controls.
export default function VolumeRow({ className = "" }) {
  const level = useVolumeLevel();
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <MuteButton /><VolumeSlider /><Level level={level} />
    </div>
  );
}

// Mini player: the same controls in a small floating panel above the bar.
// The panel has a fixed width; the slider keeps flex-1, because .seek sets width:100%.
export function VolumePanel({ className = "" }) {
  const level = useVolumeLevel();
  return (
    <GlassPanel level="overlay" className={`flex w-64 items-center gap-2 p-2.5 shadow-float ${className}`}>
      <MuteButton /><VolumeSlider /><Level level={level} />
    </GlassPanel>
  );
}
