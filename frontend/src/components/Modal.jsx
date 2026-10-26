import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CaretLeftIcon as CaretLeft, XIcon as X } from "@phosphor-icons/react";
import { IconButton } from "./Button";
import useFocusTrap from "./useFocusTrap";
import { ease } from "../motion";

const ENTER = { duration: 0.26, ease: ease.smooth };
const EXIT = { duration: 0.3, ease: ease.smooth };
// Reduced motion keeps a short cross-fade rather than snapping: a cut between
// two full-screen states is harder to follow than a brief fade.
const ENTER_REDUCED = { duration: 0.12 };
const EXIT_REDUCED = { duration: 0.1 };

// Page scroll lock, shared by every open modal. The counter keeps nested
// overlays from unlocking the page early, and the padding compensates for the
// scrollbar that disappears so locked content does not shift sideways.
let locks = 0;
let saved = null;

function lockScroll() {
  if (locks === 0) {
    const html = document.documentElement;
    const gap = window.innerWidth - html.clientWidth;
    saved = { overflow: html.style.overflow, padding: document.body.style.paddingRight };
    html.style.overflow = "hidden";
    if (gap > 0) {
      const current = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${current + gap}px`;
    }
  }
  locks += 1;
}

function unlockScroll() {
  locks = Math.max(0, locks - 1);
  if (locks === 0 && saved) {
    document.documentElement.style.overflow = saved.overflow;
    document.body.style.paddingRight = saved.padding;
    saved = null;
  }
}

// Top-anchored dialog. The card is content-sized (no height animation), capped
// at 85dvh, with a fixed bar and one scrollable body. Closing is explicit:
// the X button or Escape, never the scrim.
export default function Modal({ label, title, onBack, actions, onClose, onEscape, fullScreen = false, scrollKey, overlay, children }) {
  const reduce = useReducedMotion();
  const root = useRef(null);
  const body = useRef(null);
  const heading = useRef(null);
  const lastKey = useRef(scrollKey);
  useFocusTrap(root);

  // Stable listener: the handler changes with every render, but subscribing
  // once avoids re-adding a window listener on each one.
  const escape = useRef(onEscape || onClose);
  escape.current = onEscape || onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") escape.current?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    lockScroll();
    return unlockScroll;
  }, []);

  // On a view change the control that was clicked usually unmounts, leaving
  // focus on <body>. Move it to the new heading (announced by screen readers)
  // or, for the untitled actions view, its first action. Comparing against the
  // previous key also skips the initial mount (and StrictMode's double effect),
  // where the focus trap already placed focus.
  useEffect(() => {
    if (lastKey.current === scrollKey) return;
    lastKey.current = scrollKey;
    if (body.current) body.current.scrollTop = 0;
    const target = heading.current || body.current?.querySelector("[data-autofocus]") || body.current;
    target?.focus({ preventScroll: true });
  }, [scrollKey]);

  return (
    <motion.div ref={root} role="dialog" aria-modal="true" aria-label={label || title || "Dialog"}
      className={`fixed inset-0 z-50 flex items-start justify-center px-4 pt-[8dvh] sm:pt-[10dvh] ${fullScreen ? "" : "lg:pl-60"}`}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: reduce ? EXIT_REDUCED : EXIT }}
      transition={reduce ? ENTER_REDUCED : ENTER}>
      <div aria-hidden="true" className="absolute inset-0 bg-black/60" />
      <motion.div
        className="glass-overlay relative flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl"
        initial={{ opacity: 0, scale: reduce ? 1 : 0.92, y: reduce ? 0 : 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: reduce ? 1 : 0.93, y: reduce ? 0 : 10, transition: reduce ? EXIT_REDUCED : EXIT }}
        transition={reduce ? ENTER_REDUCED : ENTER}>
        <div className="flex min-h-11 shrink-0 items-center gap-2 px-5 pt-3">
          {onBack && (
            <IconButton label="Back" size="sm" onClick={onBack} className="-ml-2 text-mute hover:text-ink">
              <CaretLeft size={20} weight="bold" />
            </IconButton>
          )}
          {title
            ? <h2 ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate text-heading font-semibold outline-none">{title}</h2>
            : <div className="flex-1" />}
          {actions}
          <IconButton label="Close" size="sm" onClick={onClose} className="-mr-2 text-mute hover:text-ink">
            <X size={18} weight="bold" />
          </IconButton>
        </div>
        <div ref={body} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-1 outline-none">
          {children}
        </div>
        {overlay && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-black/50 p-5">
            {overlay}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
