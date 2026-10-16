import { CaretDown, CaretUp, Check, DotsThree, Play } from "@phosphor-icons/react";
import Cover from "./Cover";
import EqBars from "./EqBars";
import { IconButton } from "./Button";
import { fmt } from "../api";
import { usePlayer } from "../state";

// `onMove(delta)`, `at` (1-based) and `total` are passed only by the playlist
// view, which grows up/down buttons so the order can be changed with a thumb or
// a keyboard. `source` tags the queue this row starts (a playlist, the folder).
// `selectable`/`selected`/`onSelect` add a checkbox for multi-select importing.
// A folder row (track.source === "folder") has no library menu: nothing to share,
// delete or file away until it is imported.
export default function TrackRow({ track, list, onMenu, onMove, at = 0, total = 0, rowRef,
  source = null, selectable = false, selected = false, onSelect }) {
  const { track: current, playing, playTrack } = usePlayer();
  const active = current?.id === track.id;
  const eq = active && playing;
  const isFolder = track.source === "folder";
  return (
    <li ref={rowRef} className={`group relative flex items-center gap-1 rounded-tile pr-1 transition-colors duration-150 ${active ? "bg-accent-soft" : selected ? "bg-white/[0.07]" : "hover:bg-white/[0.06] focus-within:bg-white/[0.06]"}`}>
      {selectable && (
        <button type="button" role="checkbox" aria-checked={selected} aria-label={`Select ${track.title}`}
          onClick={() => onSelect?.(track)} className="grid min-h-[64px] place-items-center pl-3 pr-1">
          <span className={`grid h-[22px] w-[22px] place-items-center rounded-md border transition-colors duration-150 ${selected ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-white/[0.04] group-hover:border-white/30"}`}>
            {selected && <Check size={14} weight="bold" />}
          </span>
        </button>
      )}
      <button onClick={() => playTrack(track, list, source)} aria-label={`Play ${track.title} by ${track.artist}`} aria-current={active ? "true" : undefined}
        className={`flex min-h-[64px] min-w-0 flex-1 items-center gap-3.5 rounded-tile text-left ${selectable ? "pl-1.5" : "pl-2"}`}>
        {/* The scale sits on the wrapper, not the Cover, so the hover overlay grows with the image instead of leaving a ring of un-darkened cover around it */}
      <span className="relative shrink-0 transition-transform duration-200 ease-out group-hover:scale-[1.04]">
          <Cover track={track} className="h-12 w-12" />
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
      {isFolder && track.in_library && <span className="hidden rounded-full border border-line-strong px-2.5 py-0.5 text-micro text-mute sm:inline">In your library</span>}
      <span className={`tnum w-11 text-right text-small text-mute ${onMove ? "hidden sm:block" : ""}`}>{fmt(track.duration)}</span>
      {onMove && (
        <>
          <IconButton label={`Move ${track.title} up`} data-move="up" size="sm" disabled={at <= 1}
            onClick={() => onMove(-1)} className="text-mute"><CaretUp size={18} weight="bold" /></IconButton>
          <IconButton label={`Move ${track.title} down`} data-move="down" size="sm" disabled={at >= total}
            onClick={() => onMove(1)} className="text-mute"><CaretDown size={18} weight="bold" /></IconButton>
        </>
      )}
      {!isFolder && <IconButton label={`More options for ${track.title}`} onClick={() => onMenu(track)} className="text-mute"><DotsThree size={24} weight="bold" /></IconButton>}
    </li>
  );
}
