import { Pause, Play, SkipBack, SkipForward } from "@phosphor-icons/react";
import { IconButton } from "./Button";
import { usePlayer } from "../state";

// Same icon weight and proportions at every size: skip = fill, play = fill on an accent disc
const SIZES = {
  sm: { skip: "!h-10 !w-10", skipIcon: 22, play: "!h-11 !w-11 sm:!h-12 sm:!w-12", playIcon: 22, gap: "gap-1 sm:gap-3", prevHide: "hidden sm:grid" },
  lg: { skip: "!h-[52px] !w-[52px]", skipIcon: 28, play: "!h-[76px] !w-[76px] shadow-glow", playIcon: 32, gap: "gap-9", prevHide: "" },
};

export default function PlayerControls({ size = "sm", className = "" }) {
  const { queue, index, playing, toggle, next, prev } = usePlayer();
  const s = SIZES[size];
  return (
    <div className={`flex items-center justify-center ${s.gap} ${className}`}>
      <IconButton label="Previous" onClick={prev} className={`${s.skip} ${s.prevHide} text-ink`}><SkipBack size={s.skipIcon} weight="fill" /></IconButton>
      <IconButton label={playing ? "Pause" : "Play"} variant="accent" onClick={toggle} className={s.play}>
        {playing ? <Pause size={s.playIcon} weight="fill" /> : <Play size={s.playIcon} weight="fill" />}
      </IconButton>
      <IconButton label="Next" onClick={() => next(false)} disabled={!queue[index + 1]} className={`${s.skip} text-ink`}><SkipForward size={s.skipIcon} weight="fill" /></IconButton>
    </div>
  );
}
