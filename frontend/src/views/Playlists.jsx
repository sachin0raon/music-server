import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { Play, Playlist } from "@phosphor-icons/react";
import TrackRow from "../components/TrackRow";
import TrackMenu from "../components/TrackMenu";
import PageHeader, { BackLink } from "../components/PageHeader";
import PlaylistTile from "../components/PlaylistTile";
import GlassPanel from "../components/GlassPanel";
import Field from "../components/Field";
import { Button } from "../components/Button";
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
      <PageHeader title="Playlists" className="mb-4" />
      <form onSubmit={create} className="mb-5 flex gap-2">
        <Field className="flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name a new playlist" maxLength={100} aria-label="New playlist name" />
        <Button variant="accent" className="!min-h-12" disabled={!name.trim()}>Create</Button>
      </form>
      {err && <p role="alert" className="mb-3 text-small text-danger">{err}</p>}
      {loading ? <Skeleton rows={3} /> : error ? <ErrorBox message={error} onRetry={reload} /> : !data.length ? (
        <Empty title="No playlists yet" icon={Playlist}>Name one above, then add tracks from the menu on any song.</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
          {data.map((p) => (
            <li key={p.id}>
              <Link to={`/playlists/${p.id}`} className="glass interactive block rounded-card p-3 transition-transform duration-200 ease-out hover:-translate-y-0.5">
                <PlaylistTile id={p.id} className="aspect-square w-full" />
                <span className="mt-3 block truncate text-body font-medium">{p.name}</span>
                <span className="block text-small text-mute">{p.track_count} {p.track_count === 1 ? "track" : "tracks"}</span>
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
      <BackLink to="/playlists">Playlists</BackLink>
      {loading ? <Skeleton rows={4} /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <>
          <div className="mb-5 flex items-end gap-4 sm:gap-6">
            <PlaylistTile id={id} rounded="rounded-card" className="h-28 w-28 shadow-float sm:h-40 sm:w-40" />
            <div className="min-w-0 pb-1">
              <p className="text-micro font-medium uppercase tracking-wider text-mute">Playlist</p>
              <h1 className="truncate text-title font-semibold sm:text-display">{data.name}</h1>
              <p className="text-small text-mute sm:text-body">{data.track_count} {data.track_count === 1 ? "track" : "tracks"}</p>
            </div>
          </div>
          <div className="mb-5 flex flex-wrap gap-2">
            {data.tracks.length > 0 && <Button variant="accent" onClick={() => playTrack(data.tracks[0], data.tracks)}><Play weight="fill" size={16} />Play</Button>}
            <Button onClick={() => { setName(data.name); setMode("rename"); }}>Rename</Button>
            <Button onClick={() => setMode("delete")}>Delete</Button>
          </div>
          {mode === "rename" && (
            <form onSubmit={rename} className="mb-5 flex gap-2">
              <Field className="flex-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label="Playlist name" autoFocus />
              <Button variant="accent" className="!min-h-12" disabled={!name.trim()}>Save</Button>
            </form>
          )}
          {mode === "delete" && (
            <GlassPanel className="mb-5 p-4">
              <p className="text-body text-mute">Delete this playlist? The tracks stay in your library.</p>
              <div className="mt-3 flex gap-2"><Button onClick={() => setMode(null)}>Keep it</Button><Button variant="danger" onClick={remove}>Delete playlist</Button></div>
            </GlassPanel>
          )}
          {err && <p role="alert" className="mb-3 text-small text-danger">{err}</p>}
          {!data.tracks.length ? (
            <Empty title="This playlist is empty" icon={Playlist}>Open the menu on any song and choose Add to playlist.</Empty>
          ) : (
            <GlassPanel as="ul" className="p-2">{data.tracks.map((t) => <TrackRow key={t.id} track={t} list={data.tracks} onMenu={setMenu} />)}</GlassPanel>
          )}
        </>
      )}
      <AnimatePresence>{menu && <TrackMenu key="menu" track={menu} playlistId={id} onClose={() => setMenu(null)} />}</AnimatePresence>
    </>
  );
}
