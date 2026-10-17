import { useEffect, useRef } from "react";
import useFocusTrap from "./useFocusTrap";
import { motion, useReducedMotion } from "motion/react";

// fullScreen: the player covers the sidebar, so the sheet centres on the whole screen.
// Otherwise, on lg+, the sidebar (w-60) stays visible and the sheet centres on the content beside it.
export default function Sheet({ title, header, onClose, fullScreen = false, children }) {
  const reduce = useReducedMotion();
  const root = useRef(null);
  useFocusTrap(root);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <motion.div ref={root} className={`fixed inset-0 z-50 flex items-end justify-center ${fullScreen ? "" : "lg:pl-60"}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Dialog"}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeInOut" }}>
      <button aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
      <motion.div className="glass-overlay relative max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-[28px] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3"
        initial={{ y: reduce ? 0 : "100%" }} animate={{ y: 0 }} exit={{ y: reduce ? 0 : "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 280, mass: 0.8 }}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        {header ? header : title && <h2 className="mb-2 truncate text-heading font-semibold">{title}</h2>}
        {children}
      </motion.div>
    </motion.div>
  );
}
