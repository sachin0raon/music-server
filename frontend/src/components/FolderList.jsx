import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsClockwise, FolderOpen } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import TrackRow from "./TrackRow";
import ImportResults from "./ImportResults";
import { Button, IconButton } from "./Button";
import { Empty, ErrorBox, Skeleton } from "./States";
import { api } from "../api";
import { useData, usePlayer } from "../state";

const PAGE = 50;
// Tags this list's queue, so "Show more" can grow a folder that is already playing.
const SOURCE = { type: "folder" };

// The Server music tab: browse MUSIC_DIR and preview it in place. Nothing is copied
// until the user imports, and the folder itself is never changed.
export default function FolderList({ sort, onTotal, empty }) {
  const { bump } = useData();
  const { extendQueue, patchTrack } = usePlayer();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const gen = useRef(0); // bumped on every refresh, so a late "Show more" response is dropped

  const page = (offset) => `/api/library/files?${new URLSearchParams({ sort, limit: String(PAGE), offset: String(offset) })}`;

  const load = useCallback(() => {
    gen.current += 1;
    const g = gen.current;
    setLoading(true); setErr(""); setResults(null); setSelected(new Set());
    api.get(page(0))
      .then((d) => { if (g === gen.current) { setItems(d.items); setTotal(d.total); setLoading(false); } })
      .catch((e) => { if (g === gen.current) { setErr(e.message); setLoading(false); } });
  }, [sort]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!loading) onTotal?.(total); }, [loading, onTotal, total]);

  const loadMore = async () => {
    const g = gen.current;
    setBusy(true); setErr("");
    try {
      const d = await api.get(page(items.length));
      if (g !== gen.current) return;
      setItems((p) => [...p, ...d.items]);
      setTotal(d.total);
      extendQueue(SOURCE, d.items); // keep a playing folder growing
    } catch (e) {
      if (g === gen.current) setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (t) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
    return n;
  });

  const selectable = items.filter((t) => !t.in_library);
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id));

  const importSelected = async () => {
    const tokens = [...selected];
    if (!tokens.length || importing) return;
    setImporting(true); setErr("");
    try {
      const d = await api.post("/api/library/import", { tokens });
      setResults(d.results);
      // Mark the rows that landed (or were already there) as owned, without losing the
      // page position, and tell the player so "Import this" reflects it too.
      d.results.forEach((r, i) => {
        if (r.status === "ok" || r.status === "duplicate") {
          patchTrack(tokens[i], { in_library: true });
        }
      });
      const done = new Set(d.results.map((r, i) => (r.status === "ok" || r.status === "duplicate" ? tokens[i] : null)));
      setItems((p) => p.map((t) => (done.has(t.id) ? { ...t, in_library: true } : t)));
      setSelected(new Set());
      bump();
    } catch (e) {
      setErr(e.message);
    } finally {
      setImporting(false);
    }
  };

  if (loading) return <Skeleton />;
  if (err && !items.length) return <ErrorBox message={err} onRetry={load} />;
  if (!items.length) {
    return empty ?? (
      <Empty title="Nothing to browse" icon={FolderOpen}>
        The server's music folder has no playable files right now.
      </Empty>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-small text-mute">
          Playing from the server folder — nothing is copied until you import.
        </p>
        {selectable.length > 0 && (
          <Button small onClick={() => (allSelected ? setSelected(new Set()) : setSelected(new Set(selectable.map((t) => t.id))))}>
            {allSelected ? "Clear selection" : "Select all"}
          </Button>
        )}
        <IconButton label="Refresh folder" onClick={load} disabled={busy}><ArrowsClockwise size={18} weight="bold" /></IconButton>
      </div>

      <GlassPanel as="ul" className="p-2">
        {items.map((t) => (
          <TrackRow key={t.id} track={t} list={items} source={SOURCE}
            selectable={!t.in_library} selected={selected.has(t.id)} onSelect={toggle} />
        ))}
      </GlassPanel>

      {err && <p role="alert" className="mt-3 text-small text-danger">{err}</p>}
      {items.length < total && <Button onClick={loadMore} disabled={busy} className="mt-4 w-full">{busy ? "Loading" : "Show more"}</Button>}

      {selected.size > 0 && (
        <GlassPanel className="mt-4 flex flex-wrap items-center gap-3 p-3">
          <p className="min-w-0 flex-1 text-small text-mute">{selected.size} selected</p>
          <Button variant="accent" onClick={importSelected} disabled={importing}>
            {importing ? "Importing" : `Import ${selected.size === 1 ? "this file" : `${selected.size} files`}`}
          </Button>
          <Button onClick={() => setSelected(new Set())} disabled={importing}>Clear</Button>
        </GlassPanel>
      )}

      {results && <ImportResults items={results} />}
    </>
  );
}
