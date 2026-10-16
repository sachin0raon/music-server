// Options match the backend's whitelisted `sort` values (backend/app/tracks.py SORT_ORDER)
export const SORTS = [
  ["added_desc", "Newest added"],
  ["added_asc", "Oldest added"],
  ["title_asc", "Title A–Z"],
  ["title_desc", "Title Z–A"],
];

export default function SortSelect({ value, onChange, className = "" }) {
  return (
    <select aria-label="Sort tracks" value={value} onChange={(e) => onChange(e.target.value)}
      className={`field !w-auto !min-h-11 text-small ${className}`}>
      {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select>
  );
}
