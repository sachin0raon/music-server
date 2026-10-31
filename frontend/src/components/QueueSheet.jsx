import { useRef, useState } from "react";
import { BroomIcon as Broom } from "@phosphor-icons/react";
import Cover from "./Cover";
import EqBars from "./EqBars";
import Modal from "./Modal";
import { Button, IconButton } from "./Button";
import useFocusTrap from "./useFocusTrap";
import { fmt } from "../api";
import { usePlayer } from "../state";

// Confirming inside the dialog rather than stacking a second one: two modals
// both listen for Escape on the window, so one press would answer the prompt
// and close the queue behind it. Same reason the discard prompt sits in the
// track menu this way.
function ClearPrompt({ count, keepsPlaying, onKeep, onClear }) {
  const ref = useRef(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="alertdialog" aria-modal="true" aria-label="Clear the queue?"
      className="w-full max-w-xs rounded-2xl border border-line bg-surface-2 p-4 shadow-float">
      <p className="text-body font-medium">Clear the queue?</p>
      <p className="mt-1 text-small text-mute">
        {keepsPlaying
          ? `${count === 1 ? "The other track" : `The other ${count} tracks`} will be removed. `
            + "What is playing now keeps playing, and the queue empties when it ends."
          : `${count === 1 ? "The track" : `All ${count} tracks`} will be removed.`}
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="glass" className="flex-1" onClick={onKeep} data-autofocus>Keep</Button>
        <Button variant="danger" className="flex-1" onClick={onClear}>Clear</Button>
      </div>
    </div>
  );
}

// The full play queue, opened from the player. Tapping a row jumps to it, so a
// long shuffled queue can be scanned without stepping through it one at a time.
export default function QueueSheet({ onClose, fullScreen = false }) {
  const { queue, index, playing, jumpTo, clearQueue } = usePlayer();
  const [confirming, setConfirming] = useState(false);
  const remaining = Math.max(0, queue.length - index - 1);

  // What Clear would actually remove. The playing track is not counted because
  // it is the one thing Clear leaves behind, so with nothing else queued there
  // is nothing to offer.
  const keepsPlaying = index >= 0;
  const removable = queue.length - (keepsPlaying ? 1 : 0);

  const confirmClear = () => {
    setConfirming(false);
    clearQueue();
    // Clearing an unstarted queue leaves nothing to look at, and the floating
    // play button is what takes over from here.
    if (!keepsPlaying) onClose();
  };

  return (
    <Modal
      label="Queue"
      title="Queue"
      onClose={onClose}
      onEscape={() => (confirming ? setConfirming(false) : onClose())}
      fullScreen={fullScreen}
      actions={removable > 0 ? (
        <IconButton size="sm" label="Clear the queue" onClick={() => setConfirming(true)}
          className="shrink-0 text-mute hover:text-ink">
          <Broom size={18} weight="bold" />
        </IconButton>
      ) : null}
      overlay={confirming ? (
        <ClearPrompt count={removable} keepsPlaying={keepsPlaying}
          onKeep={() => setConfirming(false)} onClear={confirmClear} />
      ) : null}
    >
      <p className="-mt-1 mb-2 text-small text-mute" role="status">
        {queue.length} {queue.length === 1 ? "track" : "tracks"} · {remaining} after this one
      </p>
      <ul className="pb-2">
        {queue.map((t, i) => {
          const current = i === index;
          return (
            <li key={`${t.id}-${i}`}>
              <button onClick={() => { jumpTo(i); onClose(); }} aria-current={current ? "true" : undefined}
                data-autofocus={current ? "" : undefined}
                aria-label={`Play ${t.title} by ${t.artist}`}
                /* .interactive:hover outranks bg-accent-soft, so without a hover of
                   its own the playing row lost its tint under the pointer. */
                className={`interactive flex min-h-[56px] w-full items-center gap-3 rounded-tile px-2 py-1 text-left ${current ? "bg-accent-soft hover:bg-accent/20" : ""}`}>
                <span className="tnum w-6 shrink-0 text-right text-small text-mute">{i + 1}</span>
                <span className="relative shrink-0">
                  <Cover track={t} className="h-10 w-10" />
                  {/* Same treatment the library rows give the playing track, so
                      the queue does not mark it differently from everywhere else. */}
                  {current && playing && (
                    <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/55 text-ink">
                      <EqBars />
                    </span>
                  )}
                </span>
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
    </Modal>
  );
}
