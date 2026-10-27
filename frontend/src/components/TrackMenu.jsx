import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CaretLeftIcon as CaretLeft, CheckIcon as Check, InfoIcon as Info, ListPlusIcon as ListPlus, MinusCircleIcon as MinusCircle, PencilSimpleIcon as PencilSimple, ShareNetworkIcon as ShareNetwork, TrashIcon as Trash } from "@phosphor-icons/react";
import Modal from "./Modal";
import TrackHeader from "./TrackHeader";
import Field from "./Field";
import { Button, IconButton } from "./Button";
import TrackDetailsLoader from "./TrackDetails";
import useFocusTrap from "./useFocusTrap";
import { api } from "../api";
import { useAuth, useData, useFetch, usePlayer } from "../state";
import { transition, ease } from "../motion";

const VIEW_ENTER = { duration: 0.14, delay: 0.03, ease: ease.smooth };
const VIEW_EXIT = { duration: 0.05, ease: ease.smooth };

function Item({ icon: Icon, children, onClick, danger, disabled, label, initialFocus }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} data-autofocus={initialFocus ? "" : undefined}
      className={`interactive flex min-h-12 w-full items-center gap-3.5 rounded-tile px-2 text-left text-body disabled:opacity-50 ${danger ? "text-danger" : ""}`}>
      <Icon size={22} className={danger ? "" : "text-mute"} />{children}
    </button>
  );
}

function PlaylistPicker({ track, onDone }) {
  const { data, loading, error } = useFetch("/api/playlists");
  const { bump } = useData();
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const add = async (p) => {
    setErr("");
    try {
      await api.post(`/api/playlists/${p.id}/tracks`, { track_id: track.id });
      bump();
      setNote(`Added to ${p.name}`);
    } catch (e) {
      if (e.status === 409) setNote(`Already in ${p.name}`); else setErr(e.message);
    }
  };
  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { await add(await api.post("/api/playlists", { name })); setName(""); } catch (e2) { setErr(e2.message); }
  };

  return (
    <div>
      {note && <p role="status" className="mb-2 flex items-center gap-2 text-small text-accent"><Check size={18} weight="bold" />{note}</p>}
      {err && <p role="alert" className="mb-2 text-small text-danger">{err}</p>}
      {loading && <p className="py-3 text-mute">Loading playlists</p>}
      {error && <p role="alert" className="py-3 text-danger">{error}</p>}
      {data?.map((p) => <Item key={p.id} icon={ListPlus} onClick={() => add(p)}>{p.name}</Item>)}
      <form onSubmit={create} className="mt-3 flex gap-2">
        <Field className="flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist name" maxLength={100} aria-label="New playlist name" />
        <Button variant="accent" className="!min-h-12" disabled={!name.trim()}>Create</Button>
      </form>
      <Button onClick={onDone} className="mt-4 w-full">Done</Button>
    </div>
  );
}

// Confirmation layer shown over the details form when closing would throw away
// edits. The form stays mounted underneath, so typed values survive.
function DiscardPrompt({ onKeep, onDiscard }) {
  const ref = useRef(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="alertdialog" aria-modal="true" aria-label="Discard changes?"
      className="w-full max-w-xs rounded-2xl border border-line bg-surface-2 p-4 shadow-float">
      <p className="text-body font-medium">Discard changes?</p>
      <p className="mt-1 text-small text-mute">Your edits to this track will be lost.</p>
      <div className="mt-4 flex gap-2">
        <Button variant="glass" className="flex-1" onClick={onKeep} data-autofocus>Keep editing</Button>
        <Button variant="danger" className="flex-1" onClick={onDiscard}>Discard</Button>
      </div>
    </div>
  );
}

export default function TrackMenu({ track: initialTrack, onClose, playlistId, fullScreen = false }) {
  const [track, setTrack] = useState(initialTrack);
  useEffect(() => { setTrack(initialTrack); }, [initialTrack]);
  const { bump } = useData();
  const { patchTrack, dropTrack } = usePlayer();
  const { user } = useAuth();
  const [view, setView] = useState("actions");
  const [editingDetails, setEditingDetails] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(null);
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isFolder = track?.source === "folder";
  const canEdit = isFolder ? Boolean(user?.is_admin) : Boolean(track?.owned);
  const detailsUrl = isFolder ? `/api/library/file/${track?.id}` : (track?.id ? `/api/tracks/${track.id}` : null);
  // Folder rows already carry the full file record; library rows do not, so
  // fetch the detail once on open. The child views reuse this result.
  const rowComplete = track?.bitrate !== undefined || track?.format !== undefined;
  // Prefetch both views when the menu opens so switching to them does not show
  // a loading line and snap the card's height. useFetch caches per version and
  // dedupes in-flight requests.
  const { data: details } = useFetch(rowComplete ? null : detailsUrl);
  useFetch(isFolder ? null : "/api/playlists");
  // Editing needs the full detail set (composer, genre, year). The row data is
  // enough to show the header, but saving a form built from it could wipe the
  // fields the row never carried, so Edit waits for the prefetch.
  const detailsReady = rowComplete || Boolean(details);
  const run = async (fn) => {
    setBusy(true); setErr("");
    try { await fn(); bump(); onClose(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  const toggleShare = () => run(async () => {
    const t = await api.put(`/api/tracks/${track.id}/share`, { shared: !track.is_shared });
    patchTrack(track.id, { is_shared: t.is_shared });
  });
  const remove = () => run(async () => { await api.del(`/api/tracks/${track.id}`); dropTrack(track.id); });
  const removeFromPlaylist = () => run(() => api.del(`/api/playlists/${playlistId}/tracks/${track.id}`));

  const importFolderTrack = () => run(async () => {
    const d = await api.post(`/api/library/import`, { tokens: [track.id] });
    const r = d.results?.[0];
    if (r?.status === "ok" || r?.status === "duplicate") {
      patchTrack(track.id, { in_library: true });
    } else {
      throw new Error(r?.detail || "Could not import file");
    }
  });

  const viewTitle = view === "details" ? (editingDetails ? "Edit details" : "Track details") : view === "playlists" ? "Add to playlist" : view === "confirm" ? "Delete track" : null;

  const requestClose = () => {
    if (dirty) setDiscard("close");
    else onClose();
  };
  const requestBack = () => {
    if (!editingDetails) { setView("actions"); return; }
    if (dirty) setDiscard("back");
    else setEditingDetails(false);
  };
  const keepEditing = () => setDiscard(null);
  const discardEdits = () => {
    const action = discard;
    setDiscard(null);
    setDirty(false);
    if (action === "close") onClose();
    else setEditingDetails(false);
  };
  const onEscape = () => {
    if (discard) setDiscard(null);
    else requestClose();
  };

  const enter = reduce ? { duration: 0 } : VIEW_ENTER;
  const exit = reduce ? { duration: 0 } : VIEW_EXIT;
  const editAction = view === "details" && canEdit && detailsReady && !editingDetails ? (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={transition.fast}>
      <IconButton
        size="sm"
        onClick={() => setEditingDetails(true)}
        className="shrink-0 text-mute hover:text-ink"
        label={`Edit details for ${track.title}`}
      >
        <PencilSimple size={18} weight="bold" />
      </IconButton>
    </motion.div>
  ) : null;

  return (
    <Modal
      label={viewTitle ? `${viewTitle}: ${track.title}` : `${track.title} options`}
      title={viewTitle}
      onBack={view === "actions" ? undefined : requestBack}
      onClose={requestClose}
      onEscape={onEscape}
      actions={editAction}
      fullScreen={fullScreen}
      scrollKey={`${view}:${editingDetails}`}
      overlay={discard ? <DiscardPrompt onKeep={keepEditing} onDiscard={discardEdits} /> : null}
    >
      <TrackHeader track={track} />
      {err ? <p role="alert" className="mb-2 text-small text-danger">{err}</p> : null}
      <AnimatePresence mode="popLayout" initial={false}>
        {view === "playlists" && (
          <motion.div key="playlists" initial={{ opacity: 0, x: reduce ? 0 : 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduce ? 0 : -8, transition: exit }} transition={enter}>
            <PlaylistPicker track={track} onDone={onClose} />
          </motion.div>
        )}
        {view === "details" && (
          <motion.div key="details" initial={{ opacity: 0, x: reduce ? 0 : 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduce ? 0 : -8, transition: exit }} transition={enter}>
            <TrackDetailsLoader
              trackId={track.id}
              track={track}
              editing={editingDetails}
              onEditingChange={setEditingDetails}
              onDirtyChange={setDirty}
              onUpdated={setTrack}
            />
          </motion.div>
        )}
        {view === "confirm" && (
          <motion.div key="confirm" initial={{ opacity: 0, x: reduce ? 0 : 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduce ? 0 : -8, transition: exit }} transition={enter}>
            <p className="text-body text-mute">
              {track.is_shared ? "This removes the track for everyone and takes it out of their playlists. " : "This removes the track and its file from the server. "}It can't be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => setView("actions")} className="flex-1">Keep it</Button>
              <Button variant="danger" onClick={remove} disabled={busy} className="flex-1">Delete track</Button>
            </div>
          </motion.div>
        )}
        {view === "actions" && (
          <motion.div key="actions" initial={{ opacity: 0, x: reduce ? 0 : -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduce ? 0 : 8, transition: exit }} transition={enter}>
            <Item icon={Info} initialFocus onClick={() => setView("details")} label={`Track details for ${track.title}`}>Track details</Item>
            {!isFolder && (
              <>
                <Item icon={ListPlus} onClick={() => setView("playlists")}>Add to playlist</Item>
                {playlistId && <Item icon={MinusCircle} onClick={removeFromPlaylist} disabled={busy}>Remove from this playlist</Item>}
                {track.owned && <Item icon={ShareNetwork} onClick={toggleShare} disabled={busy}>{track.is_shared ? "Stop sharing" : "Share with everyone"}</Item>}
                {track.owned && <Item icon={Trash} danger onClick={() => setView("confirm")}>Delete track</Item>}
              </>
            )}
            {isFolder && !track.in_library && (
              <Item icon={ListPlus} onClick={importFolderTrack} disabled={busy}>Import to library</Item>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}
