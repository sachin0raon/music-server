// Small status/format pill. Variants map to the .chip-* classes in index.css so
// every label (Shared, In your library, format, year) keeps one size and radius.
// Layout (e.g. hiding on phones) stays with the caller via `className`.
export default function Chip({ variant = "outline", className = "", children }) {
  return <span className={`chip chip-${variant} ${className}`}>{children}</span>;
}
