import { CaretDown } from "@phosphor-icons/react";

// Options match the backend's whitelisted `sort` values (backend/app/tracks.py SORT_ORDER)
export const SORTS = [
  ["added_desc", "Newest added"],
  ["added_asc", "Oldest added"],
  ["title_asc", "Title A–Z"],
  ["title_desc", "Title Z–A"],
];

export const SORT_STORAGE_KEY = "player.sort";

export function getSavedSort(fallback = "added_desc") {
  try {
    const s = localStorage.getItem(SORT_STORAGE_KEY);
    return SORTS.some(([id]) => id === s) ? s : fallback;
  } catch {
    return fallback;
  }
}

// A native select (keyboard, touch and screen readers for free), dressed with the
// design-system chevron. Persists user selection to localStorage automatically.
export default function SortSelect({ value, onChange, persistKey = SORT_STORAGE_KEY, className = "" }) {
  const handleChange = (e) => {
    const v = e.target.value;
    if (persistKey) {
      try { localStorage.setItem(persistKey, v); } catch {}
    }
    onChange?.(v);
  };

  return (
    <span className={`relative inline-flex ${className}`}>
      <select aria-label="Sort tracks" value={value} onChange={handleChange}
        className="field !w-auto !min-h-11 appearance-none !pr-10 text-small">
        {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <CaretDown size={14} weight="bold" aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-mute" />
    </span>
  );
}
