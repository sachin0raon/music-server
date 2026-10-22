import { memo } from "react";
import { motion } from "motion/react";
import { CaretDown, CaretUp, Check, DotsThree, Play } from "@phosphor-icons/react";
import Cover from "./Cover";
import Chip from "./Chip";
import EqBars from "./EqBars";
import { IconButton } from "./Button";
import { fmt } from "../api";
import { usePlayer } from "../state";

// Pure memoized track row: skips re-rendering when other rows change (rerender-memo)
const PureTrackRow = memo(function PureTrackRow({
  track, list, onMenu, onMove, at = 0, total = 0, rowRef, index = 0,
  source = null, selectable = false, selected = false, onSelect,
  active = false, eq = false, onPlay
}) {
  const isFolder = track.source === "folder";
  return (
    <motion.li ref={rowRef}
      initial={index < 12 ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1], delay: index < 12 ? index * 0.022 : 0 }}
      className={`track-row-item group relative flex items-center gap-1 pr-2 transition-colors duration-[160ms] sm:pr-3 ${active ? "bg-accent-soft" : selected ? "bg-white/[0.08]" : "hover:bg-white/[0.05] focus-within:bg-white/[0.05]"}`}>
      {selectable && (
        <button type="button" role="checkbox" aria-checked={selected} aria-label={`Select ${track.title}`}
          onClick={() => onSelect?.(track)} className="grid min-h-[64px] place-items-center pl-3.5 pr-1.5 sm:pl-4">
          <span className={`grid h-[22px] w-[22px] place-items-center rounded-md border transition-colors duration-[160ms] ${selected ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-white/[0.04] group-hover:border-white/30"}`}>
            {selected && <Check size={14} weight="bold" />}
          </span>
        </button>
      )}
      <button onClick={() => onPlay?.(track, list, source)} aria-label={`Play ${track.title} by ${track.artist}`} aria-current={active ? "true" : undefined}
        className={`flex min-h-[64px] min-w-0 flex-1 items-center gap-3.5 text-left ${selectable ? "pl-1" : "pl-3.5 sm:pl-4"}`}>
        {/* The scale sits on the wrapper, not the Cover, so the hover overlay grows with the image instead of leaving a ring of un-darkened cover around it */}
        <span className="relative shrink-0 transition-transform duration-[220ms] ease-out group-hover:scale-[1.04]">
          <Cover track={track} className="h-12 w-12" />
          <span className={`absolute inset-0 grid place-items-center rounded-xl bg-black/55 text-ink transition-opacity duration-[160ms] ${eq ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
            {eq ? <EqBars /> : <Play size={18} weight="fill" />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-small font-medium sm:text-body ${active ? "text-accent" : ""}`}>{track.title}</span>
          <span className="block truncate text-[13px] text-mute sm:text-small">{track.artist}{!track.owned && track.owner ? `, shared by ${track.owner}` : ""}{track.is_shared && track.owned && <span className="sm:hidden">, shared</span>}</span>
        </span>
      </button>
      {track.is_shared && track.owned && <Chip className="hidden sm:inline-flex">Shared</Chip>}
      {isFolder && track.in_library && <Chip className="hidden sm:inline-flex">In your library</Chip>}
      <span className={`tnum w-11 text-right text-small text-mute ${onMove ? "hidden sm:block" : ""}`}>{fmt(track.duration)}</span>
      {onMove && (
        <>
          <IconButton label={`Move ${track.title} up`} data-move="up" size="sm" disabled={at <= 1}
            onClick={() => onMove(-1)} className="text-mute"><CaretUp size={18} weight="bold" /></IconButton>
          <IconButton label={`Move ${track.title} down`} data-move="down" size="sm" disabled={at >= total}
            onClick={() => onMove(1)} className="text-mute"><CaretDown size={18} weight="bold" /></IconButton>
        </>
      )}
      {onMenu && <IconButton label={`More options for ${track.title}`} onClick={() => onMenu(track)} className="text-mute"><DotsThree size={24} weight="bold" /></IconButton>}
    </motion.li>
  );
});

function ConnectedTrackRow(props) {
  const { track: current, playing, playTrack } = usePlayer();
  const active = current?.id === props.track.id;
  const eq = active && playing;
  return <PureTrackRow active={active} eq={eq} onPlay={playTrack} {...props} />;
}

// `onMove(delta)`, `at` (1-based) and `total` are passed only by the playlist
// view, which grows up/down buttons so the order can be changed with a thumb or
// a keyboard. `source` tags the queue this row starts (a playlist, the folder).
// `selectable`/`selected`/`onSelect` add a checkbox for multi-select importing.
export default function TrackRow(props) {
  if (props.onPlay !== undefined && props.active !== undefined) {
    return <PureTrackRow {...props} />;
  }
  return <ConnectedTrackRow {...props} />;
}
