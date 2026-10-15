import { useId } from "react";

// Labelled text input. Without a visible `label`, pass aria-label through.
export default function Field({ label, hint, error, icon: Icon, trailing, className = "", ...input }) {
  const id = useId();
  const note = error || hint;
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="mb-1.5 block text-small text-mute">{label}</label>}
      <div className="relative">
        {Icon && <Icon size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />}
        <input id={id} className={`field ${Icon ? "!pl-11" : ""} ${trailing ? "!pr-12" : ""}`}
          aria-invalid={error ? true : undefined} aria-describedby={note ? `${id}-note` : undefined} {...input} />
        {trailing && <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div>}
      </div>
      {note && <p id={`${id}-note`} role={error ? "alert" : undefined} className={`mt-1.5 text-micro ${error ? "text-danger" : "text-mute"}`}>{note}</p>}
    </div>
  );
}
