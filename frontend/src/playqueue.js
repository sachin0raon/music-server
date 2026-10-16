// Playback queue rules, kept pure and separate so shuffle and repeat can be
// checked on their own with node. The project ships no test runner on purpose.

// Fisher-Yates over a copy. `rng` is injectable so a check can be deterministic.
export function shuffled(list, rng = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The shuffled queue: whatever is playing stays at index 0, so turning shuffle on
// never interrupts it, and every other track follows exactly once in random order.
export function shuffledQueue(list, currentId, rng = Math.random) {
  const at = list.findIndex((t) => t.id === currentId);
  if (at < 0) return shuffled(list, rng);
  return [list[at], ...shuffled([...list.slice(0, at), ...list.slice(at + 1)], rng)];
}

// Put a live queue back into a remembered order. Tracks that are gone are skipped,
// and anything not in the remembered order (added while shuffling) goes last.
export function restoreOrder(orderIds, liveQueue) {
  const byId = new Map(liveQueue.map((t) => [t.id, t]));
  const restored = orderIds.map((id) => byId.get(id)).filter(Boolean);
  const known = new Set(orderIds);
  for (const t of liveQueue) if (!known.has(t.id)) restored.push(t);
  return restored;
}

// What a "next" press should do. Returns the index to play, or:
//   "restart" - play the current track from the top again
//   "stop"    - nothing after this and repeat is off, so stop
//   "none"    - manual press at the end with repeat off: leave things alone
// `auto` is true only when the track reached its own end.
export function nextStep({ index, length, repeat, auto }) {
  if (length === 0) return "none";
  if (auto && repeat === "one") return "restart"; // repeat one: same track again
  if (index + 1 < length) return index + 1;
  if (repeat !== "off") return index === 0 ? "restart" : 0; // repeat all: wrap to the top
  return auto ? "stop" : "none";
}

// Whether a Next control should be usable: repeat all/one can always wrap.
export function canGoNext({ index, length, repeat }) {
  return length > 0 && (index + 1 < length || repeat !== "off");
}
