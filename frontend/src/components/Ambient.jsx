import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ambientGradient, useCoverPalette } from "../palette";

// The glow behind everything, tinted from the current cover.
//
// Rendered as a stack of layers rather than one element with an animated
// `background`: CSS gradients are not interpolable, so the `transition` this
// replaces never actually ran and every track change snapped. The outgoing
// layer holds full opacity underneath while the incoming one fades in over it,
// so the page ground is never visible through the pair mid-change.
//
// Keyed on the track rather than on the gradient: the palette resolves twice per
// track (a deterministic fallback first, then the colours read from the cover),
// and keying on the colours would cross-fade for each. The refinement lands a
// few frames into the fade, while the layer is still near transparent.
export default function Ambient({ track, className = "" }) {
  const reduce = useReducedMotion();
  const palette = useCoverPalette(track);
  const background = ambientGradient(palette);

  return (
    <div aria-hidden="true" className={`pointer-events-none overflow-hidden ${className}`}>
      <AnimatePresence initial={false}>
        <motion.div
          key={track?.id ?? "idle"}
          className="absolute inset-0"
          style={{ background }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 1 }}
          transition={{ duration: reduce ? 0 : 1, ease: "linear" }}
        />
      </AnimatePresence>
    </div>
  );
}
