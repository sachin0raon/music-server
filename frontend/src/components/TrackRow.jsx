import { DotsThree, Play } from "@phosphor-icons/react";
import Cover from "./Cover";
import EqBars from "./EqBars";
import { IconButton } from "./Button";
import { fmt } from "../api";
import { usePlayer } from "../state";

export default function TrackRow({ track, list, onMenu }) {
  const { track: current, playing, playTrack } = usePlayer();
  const active = current?.id === track.id;
  const eq = active && playing;
  return (
    <li className={`group relative flex items-center gap-1 rounded-tile pr-1 transition-colors duration-150 ${active ? "bg-accent-soft" : "hover:bg-white/[0.06] focus-within:bg-white/[0.06]"}`}>
      <button onClick={() => playTrack(track, list)} aria-label={`Play ${track.title} by ${track.artist}`} aria-current={active ? "true" : undefined}
        className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3.5 rounded-tile pl-2 text-left">
        <span className="relative shrink-0">
          <Cover track={track} className="h-12 w-12 transition-transform duration-200 ease-out group-hover:scale-[1.04]" />
          <span className={`absolute inset-0 grid place-items-center rounded-xl bg-black/55 text-ink transition-opacity duration-150 ${eq ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
            {eq ? <EqBars /> : <Play size={18} weight="fill" />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-body font-medium ${active ? "text-accent" : ""}`}>{track.title}</span>
          <span className="block truncate text-small text-mute">{track.artist}{!track.owned && track.owner ? `, shared by ${track.owner}` : ""}{track.is_shared && track.owned && <span className="sm:hidden">, shared</span>}</span>
        </span>
      </button>
      {track.is_shared && track.owned && <span className="hidden rounded-full border border-line-strong px-2.5 py-0.5 text-micro text-mute sm:inline">Shared</span>}
      <span className="tnum w-11 text-right text-small text-mute">{fmt(track.duration)}</span>
      <IconButton label={`More options for ${track.title}`} onClick={() => onMenu(track)} className="text-mute"><DotsThree size={24} weight="bold" /></IconButton>
    </li>
  );
}
