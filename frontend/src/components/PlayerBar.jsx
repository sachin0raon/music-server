import { CaretUp } from "@phosphor-icons/react";
import Cover from "./Cover";
import GlassPanel from "./GlassPanel";
import { IconButton } from "./Button";
import PlayerControls from "./PlayerControls";
import SeekBar, { MiniProgress } from "./SeekBar";
import { usePlayer } from "../state";

export default function PlayerBar() {
  const { track, setOpen } = usePlayer();
  if (!track) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] lg:bottom-4 lg:left-60">
      <GlassPanel level="raised" className="relative mx-auto flex max-w-2xl items-center gap-3 overflow-hidden p-2.5 pr-3 shadow-float md:max-w-3xl sm:p-3 xl:max-w-4xl">
        <button onClick={() => setOpen(true)} aria-label={`Open player: ${track.title}`} className="interactive flex min-w-0 flex-1 basis-0 items-center gap-3 rounded-tile text-left sm:-m-1 sm:p-1">
          <Cover track={track} className="h-12 w-12 sm:h-14 sm:w-14" />
          <span className="min-w-0">
            <span className="block truncate text-body font-medium">{track.title}</span>
            <span className="block truncate text-small text-mute">{track.artist}</span>
          </span>
        </button>
        <div className="flex shrink-0 flex-col items-center sm:min-w-0 sm:flex-[1.5] sm:basis-0">
          <PlayerControls size="sm" />
          <SeekBar inline className="hidden w-full max-w-md sm:flex" />
        </div>
        <div className="hidden sm:flex sm:shrink-0 lg:flex-1 lg:basis-0 lg:justify-end">
          <IconButton label="Open player" onClick={() => setOpen(true)} className="text-mute"><CaretUp size={20} weight="bold" /></IconButton>
        </div>
        <MiniProgress className="sm:hidden" />
      </GlassPanel>
    </div>
  );
}
