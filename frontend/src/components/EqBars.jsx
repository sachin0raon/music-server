// Animated "now playing" bars; static when reduced motion is on
export default function EqBars({ className = "h-4" }) {
  return (
    <span aria-hidden="true" className={`flex items-end gap-[3px] ${className}`}>
      {[0, 0.25, 0.1].map((d, i) => (
        <span key={i} className="h-full w-[3px] origin-bottom rounded-full bg-accent" style={{ animation: `eq 0.9s ease-in-out ${d}s infinite` }} />
      ))}
    </span>
  );
}
