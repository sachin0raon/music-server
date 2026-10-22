import { MusicNotesIcon as MusicNotes, WarningCircleIcon as WarningCircle } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import { Button } from "./Button";

// `featured`: the Library's My-music tab shows a "Latest upload" card above the
// list, so the skeleton includes it too — otherwise the list jumps down on load.
export function Skeleton({ rows = 6, featured = false }) {
  return (
    <div>
      {featured && (
        <GlassPanel className="mb-4 flex gap-4 p-3.5 sm:gap-6 sm:p-6" aria-hidden="true">
          <div className="shimmer h-[122px] w-[122px] shrink-0 rounded-2xl sm:h-[184px] sm:w-[184px]" />
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 py-1 sm:flex-row sm:items-center sm:gap-8 sm:py-0">
            <div className="space-y-3">
              <div className="shimmer h-3 w-24 rounded" />
              <div className="shimmer h-5 w-2/3 rounded" />
              <div className="shimmer h-3.5 w-1/3 rounded" />
            </div>
            <div className="shimmer h-11 w-28 rounded-full self-start sm:self-center" />
          </div>
        </GlassPanel>
      )}
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
    </div>
  );
}

// `compact`: a shorter panel that sits icon-beside-text from sm up, for places where the
// full centred block would be a large, mostly empty card on a wide screen
export function Empty({ title, children, action, icon: Icon = MusicNotes, compact = false }) {
  if (compact) {
    return (
      <GlassPanel className="flex flex-col items-center gap-4 px-6 py-8 text-center sm:flex-row sm:gap-5 sm:px-7 sm:py-6 sm:text-left">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-tile bg-accent-soft text-accent ring-1 ring-inset ring-accent/20"><Icon size={26} weight="duotone" /></span>
        <div className="min-w-0">
          <h2 className="text-heading font-semibold">{title}</h2>
          <p className="mt-1.5 max-w-[46ch] text-body text-mute">{children}</p>
          {action && <div className="mt-5">{action}</div>}
        </div>
      </GlassPanel>
    );
  }
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
