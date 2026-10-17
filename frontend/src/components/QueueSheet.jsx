import Cover from "./Cover";
import Sheet from "./Sheet";
import { fmt } from "../api";
import { usePlayer } from "../state";

// The full play queue, opened from the player. Tapping a row jumps to it, so a
// long shuffled queue can be scanned without stepping through it one at a time.
export default function QueueSheet({ onClose, fullScreen = false }) {
  const { queue, index, jumpTo } = usePlayer();
  const remaining = Math.max(0, queue.length - index - 1);
  return (
    <Sheet title="Queue" onClose={onClose} fullScreen={fullScreen}>
      <p className="-mt-1 mb-2 text-small text-mute" role="status">
        {queue.length} {queue.length === 1 ? "track" : "tracks"} · {remaining} after this one
      </p>
      <ul className="pb-2">
        {queue.map((t, i) => {
          const current = i === index;
          return (
            <li key={`${t.id}-${i}`}>
              <button onClick={() => { jumpTo(i); onClose(); }} aria-current={current ? "true" : undefined}
                aria-label={`Play ${t.title} by ${t.artist}`}
                className={`interactive flex min-h-[56px] w-full items-center gap-3 rounded-tile px-2 py-1 text-left ${current ? "bg-accent-soft" : ""}`}>
                <span className="tnum w-6 shrink-0 text-right text-small text-mute">{i + 1}</span>
                <Cover track={t} className="h-10 w-10" />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-small font-medium ${current ? "text-accent" : ""}`}>{t.title}</span>
                  <span className="block truncate text-micro text-mute">{t.artist}</span>
                </span>
                <span className="tnum shrink-0 text-small text-mute">{fmt(t.duration)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
