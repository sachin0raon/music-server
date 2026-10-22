import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowsClockwiseIcon as ArrowsClockwise, CaretDownIcon as CaretDown, FolderOpenIcon as FolderOpen, MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import TrackRow from "./TrackRow";
import TrackMenu from "./TrackMenu";
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
export default function FolderList({ sort, q = "", onClearSearch, onTotal, empty }) {
  const { bump, version } = useData();
  const { extendQueue, patchTrack, playTrack, track: current, playing } = usePlayer();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [menuTrack, setMenuTrack] = useState(null);
  const gen = useRef(0); // bumped on every refresh, so a late "Show more" response is dropped
  const countRef = useRef(PAGE);
  countRef.current = Math.max(PAGE, items.length);
  const prevFilter = useRef(sort + q);
  if (prevFilter.current !== sort + q) {
    prevFilter.current = sort + q;
    countRef.current = PAGE;
  }

  const page = (offset, limit = PAGE) => {
    const params = { sort, limit: String(limit), offset: String(offset) };
    if (q) params.q = q;
    return `/api/library/files?${new URLSearchParams(params)}`;
  };

  const load = useCallback(() => {
    gen.current += 1;
    const g = gen.current;
    const limit = countRef.current;
    setLoading(items.length === 0); setErr(""); setResults(null); setSelected(new Set());
    api.get(page(0, limit))
      .then((d) => { if (g === gen.current) { setItems(d.items); setTotal(d.total); setLoading(false); } })
      .catch((e) => { if (g === gen.current) { setErr(e.message); setLoading(false); } });
  }, [sort, q, version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!loading) onTotal?.(total); }, [loading, onTotal, total]);

  const loadMore = async () => {
    const g = gen.current;
    setBusy(true); setErr("");
    try {
      const d = await api.get(page(items.length, PAGE));
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

  const toggle = useCallback((t) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
    return n;
  }), []);

  const selectable = useMemo(() => items.filter((t) => !t.in_library), [items]);
  const allSelected = useMemo(() => selectable.length > 0 && selectable.every((t) => selected.has(t.id)), [selectable, selected]);

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
    if (q) {
      return (
        <Empty
          title="No matching files"
          icon={MagnifyingGlass}
          action={onClearSearch ? <Button variant="accent" small onClick={onClearSearch}>Clear search</Button> : undefined}
        >
          Nothing in the server folder matches “{q}”.
        </Empty>
      );
    }
    return empty ?? (
      <Empty title="Nothing to browse" icon={FolderOpen}>
        The server's music folder has no playable files right now.
      </Empty>
    );
  }

  return (
    <>
      {/* Helper text gets its own line on phones; the controls sit beneath it, never beside it */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-small text-mute">Playing from the server folder. Nothing is copied until you import.</p>
        <div className="flex items-center justify-end gap-2">
          {selectable.length > 0 && (
            <Button small onClick={() => (allSelected ? setSelected(new Set()) : setSelected(new Set(selectable.map((t) => t.id))))}>
              {allSelected ? "Clear selection" : "Select all"}
            </Button>
          )}
          <IconButton label="Refresh folder" onClick={load} disabled={busy}><ArrowsClockwise size={18} weight="bold" /></IconButton>
        </div>
      </div>

      {/* The selection bar sits above the list: at the end of a long list it could fall
          under the bottom navigation on a phone, and the import action would be lost */}
      {selected.size > 0 && (
        <GlassPanel className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
          <p className="mr-auto whitespace-nowrap text-small text-mute">{selected.size} selected</p>
          <Button variant="accent" small onClick={importSelected} disabled={importing}>
            {importing ? "Importing" : `Import ${selected.size === 1 ? "this song" : `${selected.size} songs`}`}
          </Button>
          <Button small onClick={() => setSelected(new Set())} disabled={importing}>Clear</Button>
        </GlassPanel>
      )}

      <GlassPanel as="ul" className="overflow-hidden divide-y divide-line/40">
        {items.map((t, i) => {
          const active = current?.id === t.id;
          return (
            <TrackRow
              key={t.id}
              track={t}
              list={items}
              source={SOURCE}
              index={i}
              selectable={!t.in_library}
              selected={selected.has(t.id)}
              onSelect={toggle}
              onMenu={setMenuTrack}
              active={active}
              eq={active && playing}
              onPlay={playTrack}
            />
          );
        })}
      </GlassPanel>

      {err && <p role="alert" className="mt-3 text-small text-danger">{err}</p>}
      {items.length < total && (
        <div className="mt-4 flex justify-center">
          <IconButton
            variant="glass"
            size="md"
            onClick={loadMore}
            disabled={busy}
            label={busy ? "Loading more tracks" : "Show more tracks"}
            className="shadow-lift hover:scale-105 active:scale-95 transition-transform"
          >
            {busy ? (
              <ArrowsClockwise size={20} weight="bold" className="animate-spin" />
            ) : (
              <CaretDown size={20} weight="bold" />
            )}
          </IconButton>
        </div>
      )}

      {results && <ImportResults items={results} />}
      <AnimatePresence>{menuTrack && <TrackMenu key="menu" track={menuTrack} onClose={() => setMenuTrack(null)} />}</AnimatePresence>
    </>
  );
}
