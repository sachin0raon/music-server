// Shared motion tokens aligning Framer Motion with frontend/src/index.css
// CSS equivalents:
//   --ease-smooth: cubic-bezier(0.22, 1, 0.36, 1)
//   --duration-fast: 160ms
//   --duration-base: 220ms
//   --duration-slow: 280ms

export const ease = {
  smooth: [0.22, 1, 0.36, 1],
  easeOut: "easeOut",
  easeInOut: "easeInOut",
};

export const transition = {
  fast: { duration: 0.16, ease: ease.smooth },
  base: { duration: 0.22, ease: ease.smooth },
  slow: { duration: 0.28, ease: ease.smooth },
  sheet: { type: "spring", damping: 30, stiffness: 280, mass: 0.8 },
  bar: { type: "spring", damping: 30, stiffness: 320 },
  pill: { type: "spring", damping: 30, stiffness: 400 },
  // MotionConfig's reducedMotion="user" (see App.jsx) already snaps anything
  // positional -- x/y/scale/layout -- for a reduced-motion user, with no
  // per-component check needed. It leaves opacity alone, so a plain fade
  // still runs at whatever duration it is given. Anything that fades and
  // nothing else should use this instead of `base`/`slow` once reduce is true.
  reducedFade: { duration: 0.12 },
};

// One pace for every staggered list entrance, so two lists of similar things
// (tracks, playlists) do not silently drift to different speeds with no
// record of why. Capped so a long list does not keep the last row waiting.
export const STAGGER_STEP = 0.022;
export const STAGGER_CAP = 12;
export const staggerDelay = (index) => (index < STAGGER_CAP ? index * STAGGER_STEP : 0);
