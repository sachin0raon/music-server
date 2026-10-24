import { useEffect, useLayoutEffect, useRef, useState } from "react";
import useFocusTrap from "./useFocusTrap";
import { motion, useReducedMotion } from "motion/react";
import { transition, ease } from "../motion";

const HEIGHT_MS = 320;

// fullScreen: the player covers the sidebar, so the sheet centres on the whole screen.
// Otherwise, on lg+, the sidebar (w-60) stays visible and the sheet centres on the content beside it.
export default function Sheet({ title, header, onClose, fullScreen = false, children }) {
  const reduce = useReducedMotion();
  const root = useRef(null);
  const sheet = useRef(null);
  const content = useRef(null);
  const [height, setHeight] = useState(null);
  const [scrollable, setScrollable] = useState(false);
  const [animating, setAnimating] = useState(false);
  const target = useRef(null);
  useFocusTrap(root);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The sheet is content-sized, so a view change (menu -> details) used to
  // teleport its top edge. Measure the natural content height and animate to
  // it instead; max-height still caps the sheet and makes it scrollable.
  const measure = () => {
    const el = sheet.current;
    const inner = content.current;
    if (!el || !inner) return;
    const cs = getComputedStyle(el);
    const padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const max = parseFloat(cs.maxHeight);
    const natural = inner.offsetHeight + padding;
    const next = Number.isFinite(max) ? Math.min(natural, max) : natural;
    if (target.current === next) return;
    target.current = next;
    setHeight(next);
    setAnimating(true);
  };

  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const inner = content.current;
    if (!inner || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // The max-height cap is viewport-relative (85dvh), so a resize can change the
  // allowed height even when the content does not.
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Hide the scrollbar while the sheet resizes, then allow scrolling.
  // Backdrop blur is also paused: re-blurring a 660px surface every frame is
  // what made the collapse drop frames. The sheet is 92% opaque, so the
  // difference is imperceptible for the length of the motion.
  useEffect(() => {
    setScrollable(false);
    const id = window.setTimeout(() => {
      setAnimating(false);
      setScrollable(true);
    }, reduce ? 0 : HEIGHT_MS + 60);
    return () => window.clearTimeout(id);
  }, [height, reduce]);

  return (
    <motion.div ref={root} className={`fixed inset-0 z-50 flex items-end justify-center ${fullScreen ? "" : "lg:pl-60"}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Dialog"}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={transition.base}>
      <button aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/60 sm:backdrop-blur-[2px]" />
      <motion.div ref={sheet} className={`glass-overlay relative max-h-[85dvh] w-full max-w-xl ${scrollable ? "overflow-y-auto" : "overflow-hidden"} rounded-t-[28px] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3`}
        style={animating && !reduce ? { backdropFilter: "none", WebkitBackdropFilter: "none" } : undefined}
        initial={{ y: reduce ? 0 : "100%" }} animate={{ y: 0, height: height ?? "auto" }} exit={{ y: reduce ? 0 : "100%" }}
        transition={{
          ...transition.sheet,
          height: reduce ? { duration: 0 } : { duration: HEIGHT_MS / 1000, ease: ease.easeInOut },
        }}>
        <div ref={content}>
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
          {header ? header : title && <h2 className="mb-2 truncate text-heading font-semibold">{title}</h2>}
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}
