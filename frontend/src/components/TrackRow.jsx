import { DotsThree } from "@phosphor-icons/react";
import Cover from "./Cover";
import { fmt } from "../api";
import { usePlayer } from "../state";

export default function TrackRow({ track, list, onMenu }) {
  const { track: current, playTrack } = usePlayer();
  const active = current?.id === track.id;
  return (
    <li className="flex items-center gap-2 border-b border-line last:border-0">
      <button onClick={() => playTrack(track, list)} aria-label={`Play ${track.title} by ${track.artist}`}
        className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3.5 text-left">
        <Cover track={track} className="h-11 w-11" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[16px] font-medium ${active ? "text-accent" : ""}`}>{track.title}</span>
          <span className="block truncate text-sm text-mute">{track.artist}{!track.owned && track.owner ? `, shared by ${track.owner}` : ""}{track.is_shared && track.owned && <span className="sm:hidden">, shared</span>}</span>
        </span>
      </button>
      {track.is_shared && track.owned && <span className="hidden rounded-lg border border-white/15 px-2 py-0.5 text-xs text-mute sm:inline">Shared</span>}
      <span className="tnum w-10 text-right text-[13px] text-mute">{fmt(track.duration)}</span>
      <button onClick={() => onMenu(track)} aria-label={`More options for ${track.title}`} className="btn-round text-mute">
        <DotsThree size={24} weight="bold" />
      </button>
    </li>
  );
}
