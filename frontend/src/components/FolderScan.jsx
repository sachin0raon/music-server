import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import TrackRow from "./TrackRow";
import ImportResults from "./ImportResults";
import { Button } from "./Button";
import { api } from "../api";
import { useData, usePlayer } from "../state";

// Looks through MUSIC_DIR and shows what is not in the signed-in user's library yet.
// Nothing is copied until the user confirms the songs they want: the list starts
// empty of ticks and importing runs the normal upload pipeline for each pick.
export default function FolderScan() {
  const { bump } = useData();
  const { patchTrack, playTrack, track: current, playing } = usePlayer();
  const [source, setSource] = useState(undefined); // undefined = still asking
  const [items, setItems] = useState(null); // null = not checked yet
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState("");
  const gen = useRef(0);

  useEffect(() => {
    let live = true;
    api.get("/api/library/source").then((s) => live && setSource(s)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, []);

  const check = async () => {
    if (checking) return;
    gen.current += 1;
    const g = gen.current;
    setChecking(true); setErr("");
    try {
      const d = await api.get("/api/library/scan");
      if (g !== gen.current) return;
      setItems(d.items);
      setSelected(new Set());
    } catch (e) {
      if (g === gen.current) setErr(e.message);
    } finally {
      if (g === gen.current) setChecking(false);
    }
  };

  const toggle = useCallback((t) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
    return n;
  }), []);

  const allSelected = Boolean(items?.length) && items.every((t) => selected.has(t.id));

  const importSelected = async () => {
    const tokens = [...selected];
    if (!tokens.length || importing) return;
    setImporting(true); setErr("");
    try {
      const d = await api.post("/api/library/import", { tokens });
      setResults(d.results);
      const done = new Set(d.results.map((r, i) => (["ok", "duplicate"].includes(r.status) ? tokens[i] : null)));
      setItems((p) => (p ? p.filter((t) => !done.has(t.id)) : p));
      setSelected(new Set());
      // If one of the imported songs is playing as a preview, mark its queue copy.
      d.results.forEach((r, i) => {
        if (["ok", "duplicate"].includes(r.status)) patchTrack(tokens[i], { in_library: true });
      });
      bump();
    } catch (e) {
      setErr(e.message);
    } finally {
      setImporting(false);
    }
  };

  const configured = source?.configured;
  const usable = configured && source.exists && source.readable;

  return (
    <GlassPanel className="mt-5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-tile bg-accent-soft text-accent ring-1 ring-inset ring-accent/20"><FolderOpen size={22} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-heading font-semibold">Find new music on the server</p>
          <p className="mt-1 max-w-[68ch] text-body text-mute">
            Looks through the server's music folder and lists the songs that are not in your library yet.
            Nothing is copied until you pick the ones you want. Tracks are private to you until you share them.
          </p>
          {source && (
            <p className="mt-2 text-small text-mute">
              Folder:{" "}
              <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-micro text-ink">{source.path ?? "not set"}</code>
            </p>
          )}
          {configured && !source.exists && (
            <p className="mt-2 text-small text-danger">The folder is not mounted inside the container, so there is nothing to look through.</p>
          )}
          {configured && source.exists && !source.readable && (
            <p className="mt-2 text-small text-danger">The folder cannot be read.</p>
          )}
          {source && !configured && (
            <p className="mt-2 text-small text-mute">
              No folder is set up yet. Whoever runs the server can set <code>MUSIC_DIR</code> and mount it.
            </p>
          )}
          {err && <p role="alert" className="mt-2 text-small text-danger">{err}</p>}

          {usable && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="accent" onClick={check} disabled={checking}>
                {checking ? "Looking…" : items === null ? "Check for new music" : "Check again"}
              </Button>
              {items?.length > 0 && (
                <p className="text-small text-mute" role="status">
                  {items.length} new {items.length === 1 ? "song" : "songs"} not in your library.
                </p>
              )}
              {items?.length === 0 && !checking && (
                <p className="text-small text-mute" role="status">Everything in the folder is already in your library.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {items?.length > 0 && (
        <>
          <div className="mt-4 mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-small text-mute">Pick the ones you want, or take them all.</p>
            <div className="flex justify-end">
              <Button small onClick={() => (allSelected ? setSelected(new Set()) : setSelected(new Set(items.map((t) => t.id))))}>
                {allSelected ? "Clear selection" : "Select all"}
              </Button>
            </div>
          </div>
          {/* Above the list, not below it: a long list could push the import action under the bottom nav */}
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
                <TrackRow key={t.id} track={t} list={items} selectable selected={selected.has(t.id)} onSelect={toggle} index={i}
                  active={active} eq={active && playing} onPlay={playTrack} />
              );
            })}
          </GlassPanel>
        </>
      )}

      {results && <ImportResults items={results} />}
    </GlassPanel>
  );
}
