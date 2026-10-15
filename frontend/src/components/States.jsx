import { MusicNotes, WarningCircle } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import { Button } from "./Button";

export function Skeleton({ rows = 6 }) {
  return (
    <GlassPanel className="p-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-16 items-center gap-3.5 pl-2 pr-3">
          <div className="shimmer h-12 w-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <div className="shimmer h-3.5 rounded" style={{ width: `${48 - (i % 3) * 8}%` }} />
            <div className="shimmer h-3 w-1/4 rounded" />
          </div>
          <div className="shimmer h-3 w-9 rounded" />
        </div>
      ))}
    </GlassPanel>
  );
}

export function Empty({ title, children, action, icon: Icon = MusicNotes }) {
  return (
    <GlassPanel className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-5 grid h-16 w-16 place-items-center rounded-tile bg-accent-soft text-accent ring-1 ring-inset ring-accent/20"><Icon size={30} weight="duotone" /></span>
      <h2 className="text-heading font-semibold">{title}</h2>
      <p className="mt-2 max-w-[36ch] text-body text-mute">{children}</p>
      {action && <div className="mt-6">{action}</div>}
    </GlassPanel>
  );
}

export function ErrorBox({ message, onRetry }) {
  return (
    <GlassPanel role="alert" className="flex items-start gap-3 px-5 py-5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-danger-soft text-danger"><WarningCircle size={22} /></span>
      <div className="flex-1 pt-1.5">
        <p className="text-body">{message}</p>
        {onRetry && <Button onClick={onRetry} className="mt-3">Try again</Button>}
      </div>
    </GlassPanel>
  );
}
