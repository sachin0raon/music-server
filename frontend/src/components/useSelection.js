import { useCallback, useMemo, useState } from "react";

// Checkbox selection over a list that changes underneath it.
//
// Ids are what is held, but the selection itself is derived from the live list,
// so rows that have gone -- a filter narrowed, a page reloaded -- are ignored
// rather than counted, and whatever comes back is in list order. That order
// matters: it is the order the tracks are queued in.
export default function useSelection(items) {
  const [ids, setIds] = useState(() => new Set());
  const list = items || [];

  const selected = useMemo(() => list.filter((t) => ids.has(t.id)), [list, ids]);
  const isSelected = useCallback((t) => ids.has(t.id), [ids]);

  const toggle = useCallback((t) => setIds((p) => {
    const next = new Set(p);
    if (!next.delete(t.id)) next.add(t.id); // delete reports whether it was there
    return next;
  }), []);

  // Returning the same set when it is already empty keeps this from rendering
  // every list that calls clear() defensively.
  const clear = useCallback(() => setIds((p) => (p.size ? new Set() : p)), []);
  const selectAll = useCallback(() => setIds(new Set(list.map((t) => t.id))), [list]);

  return { selected, count: selected.length, isSelected, toggle, clear, selectAll };
}
