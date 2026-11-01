import { useCallback, useState } from "react";
import { QueueIcon as Queue, ShareNetworkIcon as ShareNetwork, MinusCircleIcon as MinusCircle, DownloadSimpleIcon as DownloadSimple, LinkSimpleIcon as LinkSimple, TrashIcon as Trash, XIcon as X } from "@phosphor-icons/react";
import Modal from "./Modal";
import { Button, IconButton } from "./Button";
import useCopyLink from "./useCopyLink";
import { api } from "../api";
import { useData, usePlayer, useToast } from "../state";

// Management actions belong to the tabs where a selection is only ever your own
// tracks. Search deliberately lets you tick other people's so they can be
// queued, which would leave a Delete button counting a fraction of what is
// ticked -- the thing checkboxes are worst at communicating.
const MANAGED = new Set(["mine", "shared"]);

// Runs the per-track endpoints a few at a time. One failure never abandons the
// rest: a half-finished delete that stops without saying where is worse than
// one that finishes and reports. Successes come back so the caller can act on
// what actually changed rather than on what was attempted.
async function runAll(items, fn, limit = 4) {
  const done = [];
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await fn(item);
        done.push(item);
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { done, failed };
}

const count = (n, noun) => `${n} ${n === 1 ? noun : `${noun}s`}`;

export default function SelectionActions({ scope, selected, onClear }) {
  const { addToQueue, dropTracks } = usePlayer();
  const { showToast } = useToast();
  const { bump } = useData();
  const copyLink = useCopyLink();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Derived from the tracks, not the tab, so a button's count is always exactly
  // what pressing it will change.
  const managed = MANAGED.has(scope);
  const owned = managed ? selected.filter((t) => t.owned) : [];
  const toShare = owned.filter((t) => !t.is_shared);
  const toUnshare = owned.filter((t) => t.is_shared);
  const sharedToDelete = owned.filter((t) => t.is_shared).length;

  // Not gated on `owned` like the others: everything selectable here is already
  // playable by this user, and playable is the rule for downloading.
  const zipHref = `/api/downloads/zip?${selected.map((t) => `track=${t.id}`).join("&")}`;

  const report = useCallback((done, failed, verb) => {
    showToast(failed
      ? `${verb} ${done} of ${done + failed}, ${failed} failed`
      : `${verb} ${count(done, "track")}`);
  }, [showToast]);

  const queueSelected = () => {
    const { added, skipped } = addToQueue(selected);
    showToast(added
      ? `Added ${count(added, "track")} to the queue${skipped ? `, ${skipped} already there` : ""}`
      : "Already in the queue");
    onClear();
  };

  const setShared = async (tracks, shared) => {
    setBusy(true);
    const { done, failed } = await runAll(tracks, (t) => api.put(`/api/tracks/${t.id}/share`, { shared }));
    setBusy(false);
    report(done.length, failed, shared ? "Shared" : "Stopped sharing");
    onClear();
    bump();
  };

  const confirmDelete = async () => {
    setBusy(true);
    const { done, failed } = await runAll(owned, (t) => api.del(`/api/tracks/${t.id}`));
    setBusy(false);
    setConfirming(false);
    // Only what actually went: a track whose delete failed still exists, and
    // pulling it from the queue would leave you playing something the list
    // still shows.
    dropTracks(done.map((t) => t.id));
    report(done.length, failed, "Deleted");
    onClear();
    bump();
  };

  if (!selected.length) return null;

  return (
    <>
      {/* Labels stay short and Clear is an icon: with five controls the full
          wording wrapped onto three lines on a phone, the same way the folder
          toolbar did. flex-wrap remains the fallback for a selection that needs
          every button at once. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto whitespace-nowrap text-small text-mute" role="status">
          {selected.length} selected
        </p>
        <Button small variant="accent" onClick={queueSelected} disabled={busy}>
          <Queue size={16} weight="bold" />Queue
        </Button>
        {/* A link, so the browser owns the transfer. The selection deliberately
            survives the click: a download changes nothing, and clearing would
            suggest it had. */}
        <Button as="a" small href={zipHref} download>
          <DownloadSimple size={16} weight="bold" />Download
        </Button>
        <Button small onClick={() => copyLink({ kind: "zip", tracks: selected.map((t) => t.id) })} disabled={busy}>
          <LinkSimple size={16} weight="bold" />Copy link
        </Button>
        {toShare.length > 0 && (
          <Button small onClick={() => setShared(toShare, true)} disabled={busy}>
            <ShareNetwork size={16} weight="bold" />Share {toShare.length}
          </Button>
        )}
        {toUnshare.length > 0 && (
          <Button small onClick={() => setShared(toUnshare, false)} disabled={busy}>
            <MinusCircle size={16} weight="bold" />Unshare {toUnshare.length}
          </Button>
        )}
        {owned.length > 0 && (
          <Button small variant="danger" onClick={() => setConfirming(true)} disabled={busy}>
            <Trash size={16} weight="bold" />Delete {owned.length}
          </Button>
        )}
        <IconButton size="sm" label="Clear selection" onClick={onClear} disabled={busy}>
          <X size={16} weight="bold" />
        </IconButton>
      </div>

      {confirming && (
        <Modal
          label="Confirm delete"
          title={`Delete ${count(owned.length, "track")}?`}
          onClose={() => (busy ? null : setConfirming(false))}
        >
          <p className="text-body text-mute">
            This removes {owned.length === 1 ? "the file" : "the files"} from the server and takes
            {owned.length === 1 ? " it" : " them"} out of every playlist. It can&rsquo;t be undone.
          </p>
          {sharedToDelete > 0 && (
            <p className="mt-2 text-body text-mute">
              {sharedToDelete === owned.length
                ? owned.length === 1 ? "It is shared, so it" : "They are shared, so they"
                : `${sharedToDelete} of these are shared, so they`}{" "}
              will disappear for everyone else too.
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setConfirming(false)} disabled={busy} className="flex-1">Keep them</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={busy} className="flex-1">
              {busy ? "Deleting…" : `Delete ${owned.length}`}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
