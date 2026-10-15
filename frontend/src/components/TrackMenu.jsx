import { useState } from "react";
import { Check, ListPlus, MinusCircle, ShareNetwork, Trash } from "@phosphor-icons/react";
import Sheet from "./Sheet";
import Field from "./Field";
import { Button } from "./Button";
import { api } from "../api";
import { useData, useFetch, usePlayer } from "../state";

function Item({ icon: Icon, children, onClick, danger, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
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

export default function TrackMenu({ track, onClose, playlistId }) {
  const { bump } = useData();
  const { patchTrack, dropTrack } = usePlayer();
  const [view, setView] = useState("actions");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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

  return (
    <Sheet title={track.title} onClose={onClose}>
      {err && <p role="alert" className="mb-2 text-small text-danger">{err}</p>}
      {view === "playlists" && <PlaylistPicker track={track} onDone={onClose} />}
      {view === "confirm" && (
        <div>
          <p className="text-body text-mute">
            {track.is_shared ? "This removes the track for everyone and takes it out of their playlists. " : "This removes the track and its file from the server. "}It can't be undone.
          </p>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setView("actions")} className="flex-1">Keep it</Button>
            <Button variant="danger" onClick={remove} disabled={busy} className="flex-1">Delete track</Button>
          </div>
        </div>
      )}
      {view === "actions" && (
        <div>
          <Item icon={ListPlus} onClick={() => setView("playlists")}>Add to playlist</Item>
          {playlistId && <Item icon={MinusCircle} onClick={removeFromPlaylist} disabled={busy}>Remove from this playlist</Item>}
          {track.owned && <Item icon={ShareNetwork} onClick={toggleShare} disabled={busy}>{track.is_shared ? "Stop sharing" : "Share with everyone"}</Item>}
          {track.owned && <Item icon={Trash} danger onClick={() => setView("confirm")}>Delete track</Item>}
        </div>
      )}
    </Sheet>
  );
}
