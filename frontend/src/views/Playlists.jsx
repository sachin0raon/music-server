import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { CaretLeft, CaretRight, Play } from "@phosphor-icons/react";
import TrackRow from "../components/TrackRow";
import TrackMenu from "../components/TrackMenu";
import { Empty, ErrorBox, Skeleton } from "../components/States";
import { api } from "../api";
import { useData, useFetch, usePlayer } from "../state";

export function PlaylistsIndex() {
  const { data, loading, error, reload } = useFetch("/api/playlists");
  const { bump } = useData();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { const p = await api.post("/api/playlists", { name }); setName(""); bump(); navigate(`/playlists/${p.id}`); }
    catch (e2) { setErr(e2.message); }
  };

  return (
    <>
      <h1 className="text-[40px] font-medium leading-tight tracking-tighter">Playlists</h1>
      <form onSubmit={create} className="mb-5 mt-4 flex gap-2">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name a new playlist" maxLength={100} aria-label="New playlist name" />
        <button className="btn btn-accent" disabled={!name.trim()}>Create</button>
      </form>
      {err && <p role="alert" className="mb-3 text-[15px] text-[#ff8a8a]">{err}</p>}
      {loading ? <Skeleton rows={3} /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data.length ? (
        <Empty title="No playlists yet">Name one above, then add tracks from the menu on any song.</Empty>
      ) : (
        <ul className="glass rounded-card px-4">
          {data.map((p) => (
            <li key={p.id} className="border-b border-line last:border-0">
              <Link to={`/playlists/${p.id}`} className="flex min-h-[64px] items-center gap-3">
                <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-medium">{p.name}</span>
                  <span className="block text-sm text-mute">{p.track_count} {p.track_count === 1 ? "track" : "tracks"}</span></span>
                <CaretRight size={18} className="text-mute" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function PlaylistDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useFetch(`/api/playlists/${id}`);
  const { bump } = useData();
  const { playTrack } = usePlayer();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(null);
  const [mode, setMode] = useState(null); // "rename" | "delete"
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const act = async (fn) => { setErr(""); try { await fn(); bump(); } catch (e) { setErr(e.message); } };
  const rename = (e) => { e.preventDefault(); act(async () => { await api.patch(`/api/playlists/${id}`, { name }); setMode(null); }); };
  // No bump(): the playlists list refetches when it mounts, and bump would refetch this deleted playlist
  const remove = async () => {
    setErr("");
    try { await api.del(`/api/playlists/${id}`); navigate("/playlists", { replace: true }); } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <Link to="/playlists" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[15px] text-mute"><CaretLeft size={16} />Playlists</Link>
      {loading ? <Skeleton rows={4} /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <>
          <h1 className="truncate text-[34px] font-medium leading-tight tracking-tighter">{data.name}</h1>
          <p className="mb-4 text-[15px] text-mute">{data.track_count} {data.track_count === 1 ? "track" : "tracks"}</p>
          <div className="mb-5 flex flex-wrap gap-2">
            {data.tracks.length > 0 && <button className="btn btn-accent" onClick={() => playTrack(data.tracks[0], data.tracks)}><Play weight="fill" size={16} />Play</button>}
            <button className="btn glass" onClick={() => { setName(data.name); setMode("rename"); }}>Rename</button>
            <button className="btn glass" onClick={() => setMode("delete")}>Delete</button>
          </div>
          {mode === "rename" && (
            <form onSubmit={rename} className="mb-5 flex gap-2">
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label="Playlist name" autoFocus />
              <button className="btn btn-accent" disabled={!name.trim()}>Save</button>
            </form>
          )}
          {mode === "delete" && (
            <div className="glass mb-5 rounded-card p-4">
              <p className="text-[15px] text-mute">Delete this playlist? The tracks stay in your library.</p>
              <div className="mt-3 flex gap-2"><button className="btn glass" onClick={() => setMode(null)}>Keep it</button><button className="btn bg-[#ff8a8a] text-[#1a0a0a]" onClick={remove}>Delete playlist</button></div>
            </div>
          )}
          {err && <p role="alert" className="mb-3 text-[15px] text-[#ff8a8a]">{err}</p>}
          {!data.tracks.length ? (
            <Empty title="This playlist is empty">Open the menu on any song and choose Add to playlist.</Empty>
          ) : (
            <ul className="glass rounded-card px-4">{data.tracks.map((t) => <TrackRow key={t.id} track={t} list={data.tracks} onMenu={setMenu} />)}</ul>
          )}
        </>
      )}
      <AnimatePresence>{menu && <TrackMenu key="menu" track={menu} playlistId={id} onClose={() => setMenu(null)} />}</AnimatePresence>
    </>
  );
}
