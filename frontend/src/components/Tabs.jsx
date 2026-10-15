import { useRef } from "react";

// Segmented control with roving tabindex and arrow/Home/End key support
export default function Tabs({ tabs, value, onChange, label, className = "" }) {
  const refs = useRef([]);
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
            className={`min-h-10 flex-1 rounded-full text-[15px] font-medium transition-colors duration-150 ${on ? "bg-white/15 text-ink shadow-rest" : "text-mute hover:text-ink"}`}>
            {text}
          </button>
        );
      })}
    </div>
  );
}
