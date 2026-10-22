import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CaretUpIcon as CaretUp } from "@phosphor-icons/react";
import Cover from "./Cover";
import GlassPanel from "./GlassPanel";
import { IconButton } from "./Button";
import PlayerControls from "./PlayerControls";
import SeekBar, { MiniProgress } from "./SeekBar";
import { SpeakerIcon, VolumePanel, useVolumeLevel } from "./VolumeControl";
import { usePlayer } from "../state";
import { transition } from "../motion";

// `track` comes in as a prop (not from context) so AnimatePresence can finish the
// exit animation with the last track still on screen after playback stops.
export default function PlayerBar({ track }) {
  const { setOpen } = usePlayer();
  const reduce = useReducedMotion();
  const level = useVolumeLevel();
  const [volOpen, setVolOpen] = useState(false);
  const volRef = useRef(null);

  // Dismiss the volume popover on an outside pointer press or Escape.
  useEffect(() => {
    if (!volOpen) return;
    const onDown = (e) => { if (!volRef.current?.contains(e.target)) setVolOpen(false); };
    const onKey = (e) => e.key === "Escape" && setVolOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [volOpen]);

  return (
    <motion.div
      className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] lg:bottom-4 lg:left-60"
      initial={{ y: reduce ? 0 : 96, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: reduce ? 0 : 96, opacity: 0 }}
      transition={transition.bar}>
      {/* The popover is a sibling of the bar, not a child: the bar clips its own
          contents (overflow-hidden, for MiniProgress), so a child would be cut off. */}
      <div ref={volRef} className="relative mx-auto max-w-2xl md:max-w-3xl xl:max-w-4xl">
        <GlassPanel level="bar" className="relative flex items-center gap-3 overflow-hidden p-2.5 pr-3 shadow-float sm:p-3">
          <button onClick={() => setOpen(true)} aria-label={`Open player: ${track.title}`} className="interactive flex min-w-0 flex-1 basis-0 items-center gap-3 rounded-tile text-left sm:-m-1 sm:p-1">
            <Cover track={track} eager className="h-12 w-12 sm:h-14 sm:w-14" />
            <span className="min-w-0">
              <span className="block truncate text-body font-medium">{track.title}</span>
              <span className="block truncate text-small text-mute">{track.artist}</span>
            </span>
          </button>
          <div className="flex shrink-0 flex-col items-center sm:min-w-0 sm:flex-[1.5] sm:basis-0">
            <PlayerControls size="sm" />
            <SeekBar inline className="hidden w-full max-w-md sm:flex" />
          </div>
          <div className="hidden sm:flex sm:shrink-0 sm:items-center sm:gap-1 lg:flex-1 lg:basis-0 lg:justify-end">
            <IconButton label="Volume" aria-expanded={volOpen} onClick={() => setVolOpen((o) => !o)}>
              <SpeakerIcon level={level} />
            </IconButton>
            <IconButton label="Open player" onClick={() => setOpen(true)} className="text-mute"><CaretUp size={20} weight="bold" /></IconButton>
          </div>
          <MiniProgress className="sm:hidden" />
        </GlassPanel>
        <AnimatePresence>
          {volOpen && (
            <motion.div key="vol" initial={{ opacity: 0, y: reduce ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : 6 }}
              transition={transition.fast}
              className="absolute right-3 bottom-[calc(100%+0.5rem)] z-10">
              <VolumePanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
