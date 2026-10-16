import { CaretDown } from "@phosphor-icons/react";

// Options match the backend's whitelisted `sort` values (backend/app/tracks.py SORT_ORDER)
export const SORTS = [
  ["added_desc", "Newest added"],
  ["added_asc", "Oldest added"],
  ["title_asc", "Title A–Z"],
  ["title_desc", "Title Z–A"],
];

// A native select (keyboard, touch and screen readers for free), dressed with the
// design-system chevron. The OS dropdown itself cannot be restyled.
export default function SortSelect({ value, onChange, className = "" }) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select aria-label="Sort tracks" value={value} onChange={(e) => onChange(e.target.value)}
        className="field !w-auto !min-h-11 appearance-none !pr-10 text-small">
        {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <CaretDown size={14} weight="bold" aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-mute" />
    </span>
  );
}
