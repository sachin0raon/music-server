import { motion, useReducedMotion } from "motion/react";
import { PlayIcon as Play } from "@phosphor-icons/react";
import { usePlayer } from "../state";
import { transition } from "../motion";

// Starts a queue that was built by hand and never played.
//
// Without it, adding tracks while nothing is playing has no visible outcome:
// the player bar only appears once playback starts, so the queue would exist
// with nothing on screen to say so. This stands in exactly that gap, which is
// why it takes the player bar's position -- the two can never be on screen at
// once, and the bar replacing it reads as the button becoming the player.
export default function QueueFab() {
  const { queue, playTrack } = usePlayer();
  const reduce = useReducedMotion();
  const count = queue.length;

  return (
    <motion.button
      type="button"
      onClick={() => playTrack(queue[0], queue)}
      aria-label={`Play ${count} queued ${count === 1 ? "track" : "tracks"}`}
      className="btn-accent fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-30 grid h-14 w-14 transform-gpu place-items-center rounded-full shadow-float lg:bottom-4"
      initial={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
      transition={reduce ? { duration: 0 } : transition.pill}
    >
      <Play size={24} weight="fill" />
      {/* The label above already carries the count, so this is decoration. */}
      <span aria-hidden="true"
        className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full border-2 border-ground bg-ink px-1 text-micro font-semibold tabular-nums text-ground">
        {count > 99 ? "99+" : count}
      </span>
    </motion.button>
  );
}
