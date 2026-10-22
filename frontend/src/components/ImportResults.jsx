import { CheckIcon as Check, WarningCircleIcon as WarningCircle } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";

const LABEL = { ok: "Added", duplicate: "Already in your library", error: "Failed" };

// Result list shared by the folder scan and the link import.
// `items` are { filename, status: "ok" | "duplicate" | "error", detail }.
export default function ImportResults({ items, limit = 200 }) {
  if (!items?.length) return null;
  return (
    <GlassPanel as="ul" className="mt-4 px-4" aria-live="polite">
      {items.slice(0, limit).map((r, i) => (
        <li key={i} className="border-b border-line py-3 last:border-0">
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-body">{r.filename}</span>
            {r.status === "ok" && <Check size={18} weight="bold" className="text-accent" />}
            {(r.status === "error" || r.status === "duplicate") && (
              <WarningCircle size={18} className={r.status === "error" ? "text-danger" : "text-mute"} />
            )}
          </div>
          <p className={`mt-0.5 text-small ${r.status === "error" ? "text-danger" : "text-mute"}`}>
            {r.status === "ok" ? LABEL.ok : (r.detail || LABEL[r.status])}
          </p>
        </li>
      ))}
      {items.length > limit && (
        <li className="py-3 text-small text-mute">Showing the first {limit} of {items.length}.</li>
      )}
    </GlassPanel>
  );
}
