import { WarningCircle } from "@phosphor-icons/react";

export function Skeleton({ rows = 6 }) {
  return (
    <div className="glass animate-pulse rounded-card px-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-[68px] items-center gap-3.5 border-b border-line last:border-0">
          <div className="h-11 w-11 rounded-xl bg-white/10" />
          <div className="flex-1 space-y-2"><div className="h-3.5 w-2/5 rounded bg-white/10" /><div className="h-3 w-1/4 rounded bg-white/[0.06]" /></div>
          <div className="h-3 w-8 rounded bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="glass rounded-card px-6 py-10">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1.5 max-w-[34ch] text-[15px] leading-relaxed text-mute">{children}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div role="alert" className="glass flex items-start gap-3 rounded-card px-5 py-5">
      <WarningCircle size={24} className="mt-0.5 shrink-0 text-[#ff8a8a]" />
      <div className="flex-1">
        <p className="text-[15px]">{message}</p>
        {onRetry && <button onClick={onRetry} className="btn glass mt-3">Try again</button>}
      </div>
    </div>
  );
}
