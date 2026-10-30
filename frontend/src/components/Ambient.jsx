import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ambientGradient, useCoverPalette } from "../palette";

// The glow behind everything, tinted from the current cover.
//
// Two layers rather than one element with an animated `background`: CSS
// gradients are not interpolable, so a `transition` on them never runs and the
// change snaps.
//
// The base layer is opaque and always shows the last gradient that finished
// arriving; the incoming one fades in above it and is promoted to base once it
// is fully opaque. Nothing is ever removed from underneath a half-faded layer,
// which is what left the page ground showing through mid-change.
//
// The incoming layer is keyed on the track, not on the colours. A palette
// resolves twice per track -- a deterministic fallback at once, then the
// colours read from the cover -- and keying on the colours mounted a second
// layer and ran a second full-screen fade for the refinement, doubling the
// gradient work per track change. Keyed this way the refinement updates the
// layer that is already fading, a few frames in while it is still near
// transparent.
export default function Ambient({ track, className = "" }) {
  const reduce = useReducedMotion();
  const palette = useCoverPalette(track);
  const background = ambientGradient(palette);
  const [base, setBase] = useState(background);

  return (
    <div aria-hidden="true" className={`pointer-events-none overflow-hidden ${className}`}>
      <div className="absolute inset-0" style={{ background: base }} />
      {base !== background && (
        <motion.div
          key={track?.id ?? "idle"}
          className="absolute inset-0"
          style={{ background }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduce ? 0 : 1, ease: "linear" }}
          onAnimationComplete={() => setBase(background)}
        />
      )}
    </div>
  );
}
