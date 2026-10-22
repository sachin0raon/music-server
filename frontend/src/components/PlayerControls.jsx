import { PauseIcon as Pause, PlayIcon as Play, RepeatIcon as Repeat, RepeatOnceIcon as RepeatOnce, ShuffleIcon as Shuffle, SkipBackIcon as SkipBack, SkipForwardIcon as SkipForward } from "@phosphor-icons/react";
import { IconButton } from "./Button";
import { usePlayer } from "../state";

// Same icon weight and proportions at every size: skip = fill, play = fill on an
// accent disc. Shuffle and repeat sit at the outer edges; at the compact size
// (the mini player) they only appear from sm up, where there is room for five
// controls, but play/pause, previous and next are always available.
const SIZES = {
  sm: {
    side: "!h-10 !w-10 [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11", sideIcon: 20, sideHide: "hidden sm:grid",
    skip: "!h-10 !w-10 [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11", skipIcon: 22, prevHide: "",
    play: "!h-11 !w-11 sm:!h-12 sm:!w-12", playIcon: 22,
    gap: "gap-1 sm:gap-3",
  },
  lg: {
    side: "!h-11 !w-11 sm:!h-12 sm:!w-12", sideIcon: 22, sideHide: "",
    skip: "!h-12 !w-12 sm:!h-[52px] sm:!w-[52px]", skipIcon: 28, prevHide: "",
    play: "!h-16 !w-16 sm:!h-[76px] sm:!w-[76px] shadow-glow", playIcon: 32,
    gap: "gap-2 sm:gap-6 lg:gap-8",
  },
};

const REPEAT_LABEL = { off: "Repeat off", all: "Repeat all", one: "Repeat one" };

export default function PlayerControls({ size = "sm", className = "" }) {
  const { playing, toggle, next, prev, shuffle, repeat, toggleShuffle, cycleRepeat, canNext } = usePlayer();
  const s = SIZES[size];
  const RepeatIcon = repeat === "one" ? RepeatOnce : Repeat;
  return (
    <div className={`flex items-center justify-center ${s.gap} ${className}`}>
      <IconButton label="Shuffle" aria-pressed={shuffle} onClick={toggleShuffle}
        className={`${s.side} ${s.sideHide}`}><Shuffle size={s.sideIcon} weight="bold" /></IconButton>
      <IconButton label="Previous" onClick={prev} className={`${s.skip} ${s.prevHide} text-ink`}><SkipBack size={s.skipIcon} weight="fill" /></IconButton>
      <IconButton label={playing ? "Pause" : "Play"} variant="accent" onClick={toggle} className={s.play}>
        {playing ? <Pause size={s.playIcon} weight="fill" /> : <Play size={s.playIcon} weight="fill" />}
      </IconButton>
      <IconButton label="Next" onClick={() => next(false)} disabled={!canNext} className={`${s.skip} text-ink`}><SkipForward size={s.skipIcon} weight="fill" /></IconButton>
      <IconButton label={REPEAT_LABEL[repeat]} aria-pressed={repeat !== "off"} onClick={cycleRepeat}
        className={`${s.side} ${s.sideHide}`}><RepeatIcon size={s.sideIcon} weight="bold" /></IconButton>
    </div>
  );
}
