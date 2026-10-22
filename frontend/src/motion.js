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
};
