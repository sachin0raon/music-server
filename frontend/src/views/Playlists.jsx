import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PlayIcon as Play, PlaylistIcon as Playlist } from "@phosphor-icons/react";
import TrackRow from "../components/TrackRow";
import TrackMenu from "../components/TrackMenu";
import PageHeader, { BackLink } from "../components/PageHeader";
import { PlaylistArt } from "../components/PlaylistTile";
import GlassPanel from "../components/GlassPanel";
import Field from "../components/Field";
import { Button } from "../components/Button";
import { Empty, ErrorBox, Skeleton } from "../components/States";
import { api } from "../api";
import { useData, useFetch, usePlayer } from "../state";
import { transition } from "../motion";

export function PlaylistsIndex() {
  const { data, loading, error, reload } = useFetch("/api/playlists");
  const { bump } = useData();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const reduce = useReducedMotion();

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
          {data.map((p, i) => (
            <motion.li key={p.id} initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { ...transition.base, delay: i < 12 ? i * 0.03 : 0 }}>
              <Link to={`/playlists/${p.id}`} className="glass interactive block rounded-card p-3 transition-transform duration-[220ms] ease-out hover:-translate-y-0.5">
                <PlaylistArt id={p.id} className="aspect-square w-full" />
                <span className="mt-3 block truncate text-body font-medium">{p.name}</span>
                <span className="block text-small text-mute">{p.track_count} {p.track_count === 1 ? "track" : "tracks"}</span>
              </Link>
            </motion.li>
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
  const { playTrack, reorderQueue, track: current, playing } = usePlayer();
  const navigate = useNavigate();
  const source = { type: "playlist", id }; // tags this playlist's queue, so reorders follow it
  const [menu, setMenu] = useState(null);
  const [mode, setMode] = useState(null); // "rename" | "delete"
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [order, setOrder] = useState([]); // local play order while reordering
  const [announce, setAnnounce] = useState(""); // so a keyboard/screen-reader move is not silent
  const rowRefs = useRef(new Map());
  const pendingFocus = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const latestIds = useRef(null);

  // Each fetch (first load, rename, add/remove via the menu) resets the local order.
  useEffect(() => { if (data?.tracks) setOrder(data.tracks); }, [data]);

  const setRowRef = useCallback((trackId) => (el) => {
    if (el) rowRefs.current.set(trackId, el);
    else rowRefs.current.delete(trackId);
  }, []);

  // After a move, keep focus on that track's button so the key can be pressed again;
  // if it just became disabled at an end, move to the row's other button instead.
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    const row = rowRefs.current.get(want.id);
    if (!row) return;
    const same = row.querySelector(`[data-move="${want.dir}"]`);
    const other = row.querySelector(`[data-move="${want.dir === "up" ? "down" : "up"}"]`);
    (same && !same.disabled ? same : other)?.focus();
  }, [order]);

  const act = async (fn) => { setErr(""); try { await fn(); bump(); } catch (e) { setErr(e.message); } };
  const rename = (e) => { e.preventDefault(); act(async () => { await api.patch(`/api/playlists/${id}`, { name }); setMode(null); }); };
  // No bump(): the playlists list refetches when it mounts, and bump would refetch this deleted playlist
  const remove = async () => {
    setErr("");
    try { await api.del(`/api/playlists/${id}`); navigate("/playlists", { replace: true }); } catch (e) { setErr(e.message); }
  };

  // One save at a time, in order: two quick moves must not race on the server.
  const move = (from, delta) => {
    const to = from + delta;
    if (to < 0 || to >= order.length) return;
    const next = order.slice();
    [next[from], next[to]] = [next[to], next[from]];
    const moved = next[to];
    const before = order.map((t) => t.id);
    const ids = next.map((t) => t.id);
    setErr("");
    pendingFocus.current = { id: moved.id, dir: delta < 0 ? "up" : "down" };
    setOrder(next);
    setAnnounce(`Moved ${moved.title} to position ${to + 1} of ${next.length}.`);
    reorderQueue(source, ids); // if this playlist is playing, move it too
    latestIds.current = ids;
    saveQueue.current = saveQueue.current
      .then(() => api.put(`/api/playlists/${id}/order`, { track_ids: ids }))
      // A newer move already set the order; only settle on this response if it is still the latest.
      .then((updated) => { if (latestIds.current === ids) setOrder(updated.tracks); })
      .catch((e) => { if (latestIds.current === ids) { setErr(e.message); reorderQueue(source, before); reload(); } });
  };

  return (
    <>
      <BackLink to="/playlists">Playlists</BackLink>
      {loading ? <Skeleton rows={4} /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <>
          <div className="mb-5 flex items-end gap-4 sm:gap-6">
            <PlaylistArt id={id} tracks={order} rounded="rounded-card" className="h-28 w-28 shadow-float sm:h-40 sm:w-40" />
            <div className="min-w-0 pb-1">
              <p className="text-micro font-medium uppercase tracking-wider text-mute">Playlist</p>
              <h1 className="truncate text-title font-semibold sm:text-display">{data.name}</h1>
              <p className="text-small text-mute sm:text-body">{order.length} {order.length === 1 ? "track" : "tracks"}</p>
            </div>
          </div>
          <div className="mb-5 flex flex-wrap gap-2">
            {order.length > 0 && <Button variant="accent" onClick={() => playTrack(order[0], order, source)}><Play weight="fill" size={16} />Play</Button>}
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
          {!order.length ? (
            <Empty title="This playlist is empty" icon={Playlist}>Open the menu on any song and choose Add to playlist.</Empty>
          ) : (
            <>
              <p aria-live="polite" className="sr-only">{announce}</p>
              <GlassPanel as="ul" className="overflow-hidden divide-y divide-line/40">
                {order.map((t, i) => {
                  const active = current?.id === t.id;
                  return (
                    <TrackRow key={t.id} track={t} list={order} onMenu={setMenu} index={i}
                      onMove={(delta) => move(i, delta)} at={i + 1} total={order.length} rowRef={setRowRef(t.id)}
                      active={active} eq={active && playing} onPlay={playTrack} />
                  );
                })}
              </GlassPanel>
            </>
          )}
        </>
      )}
      <AnimatePresence>{menu && <TrackMenu key="menu" track={menu} playlistId={id} onClose={() => setMenu(null)} />}</AnimatePresence>
    </>
  );
}
