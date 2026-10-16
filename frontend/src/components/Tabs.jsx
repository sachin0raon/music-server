import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";

// Segmented control with roving tabindex and arrow/Home/End key support
export default function Tabs({ tabs, value, onChange, label, className = "" }) {
  const refs = useRef([]);
  const reduce = useReducedMotion();
  const onKeyDown = (e) => {
    const i = tabs.findIndex(([id]) => id === value);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const n = (to + tabs.length) % tabs.length;
    onChange(tabs[n][0]);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`glass flex rounded-full p-1 ${className}`}>
      {tabs.map(([id, text], i) => {
        const on = id === value;
        return (
          <button key={id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(id)}
            className={`relative min-h-11 flex-1 whitespace-nowrap rounded-full px-1.5 text-small font-medium transition-colors duration-[160ms] sm:flex-none sm:px-5 sm:text-[15px] ${on ? "text-ink" : "text-mute hover:text-ink"}`}>
            {on && <motion.span layoutId={`tab-pill-${label}`} aria-hidden="true"
              className="absolute inset-0 rounded-full bg-white/15 shadow-rest"
              transition={reduce ? { duration: 0 } : { type: "spring", damping: 30, stiffness: 400 }} />}
            <span className="relative">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
