import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FolderOpenIcon as FolderOpen, MagnifyingGlassIcon as MagnifyingGlass, MusicNotesIcon as MusicNotes, PlusIcon as Plus, ShareNetworkIcon as ShareNetwork, XIcon as X } from "@phosphor-icons/react";
import TrackList from "../components/TrackList";
import FolderList from "../components/FolderList";
import PageHeader from "../components/PageHeader";
import Tabs from "../components/Tabs";
import SortSelect, { SORTS, getSavedSort } from "../components/SortSelect";
import { Button, IconButton } from "../components/Button";
import { Empty } from "../components/States";
import { useFetch } from "../state";

const TABS = [["mine", "My music"], ["shared", "Shared"]];
const FOLDER_TAB = ["folder", "Server music"];
const DEFAULT_SORT = "added_desc";

export default function Library() {
  const [params, setParams] = useSearchParams();
  const { data: source } = useFetch("/api/library/source");
  const folderOk = Boolean(source?.configured && source.exists && source.readable);
  const requested = params.get("tab");
  const tab = requested === "shared" ? "shared" : requested === "folder" && folderOk ? "folder" : "mine";
  const isFolder = tab === "folder";

  // Persistent sort preference: URL query parameter takes priority if present, otherwise localStorage
  const sortParam = params.get("sort");
  const sort = SORTS.some(([id]) => id === sortParam) ? sortParam : getSavedSort(DEFAULT_SORT);

  // Subtitle always renders (even with 0 tracks) so the header height never shifts
  const [total, setTotal] = useState(null);
  const count = total ?? 0;
  const subtitle = `${count} ${count === 1 ? "track" : "tracks"}`;

  const urlQ = params.get("q") || "";
  const [search, setSearch] = useState(urlQ);

  // Sync local search when URL query changes (e.g. back/forward navigation or tab change)
  useEffect(() => {
    setSearch(urlQ);
  }, [urlQ]);

  // Tab, sort, and search live in the URL
  const update = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const handleTabChange = (id) => {
    const next = new URLSearchParams(params);
    if (id === "mine") next.delete("tab"); else next.set("tab", id);
    setParams(next, { replace: true });
  };

  // Debounce search update to URL query
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === urlQ) return;
    const t = setTimeout(() => {
      update("q", trimmed, "");
    }, 250);
    return () => clearTimeout(t);
  }, [search, urlQ]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSearch = () => {
    setSearch("");
    update("q", "", "");
  };

  const placeholderText = isFolder
    ? "Search server music..."
    : tab === "shared"
    ? "Search shared music..."
    : "Search your music...";

  return (
    <>
      <PageHeader title="Library" className="mb-4"
        subtitle={subtitle}
        actions={<IconButton as={Link} to="/upload" label="Upload music" variant="glass"><Plus size={20} /></IconButton>} />
      {/* On phones the tabs take the full width and the controls drop to their own line.
          From sm up the tabs size to their labels and the controls sit at the far end of the same row. */}
      <div className="mb-5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <Tabs label="Library" tabs={folderOk ? [...TABS, FOLDER_TAB] : TABS} value={tab} className="w-full sm:w-auto"
          onChange={handleTabChange} />
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-56 md:w-64 sm:flex-initial">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") clearSearch();
              }}
              placeholder={placeholderText}
              aria-label={placeholderText}
              className="field !min-h-11 !pl-10 !pr-10 text-small placeholder:text-faint"
            />
            {search && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-full text-mute transition-colors hover:bg-white/10 hover:text-ink"
              >
                <X size={14} weight="bold" />
              </button>
            )}
          </div>
          <SortSelect value={sort} onChange={(v) => update("sort", v, DEFAULT_SORT)} className="shrink-0" />
        </div>
      </div>
      {isFolder ? (
        <FolderList key="folder" sort={sort} q={urlQ} onClearSearch={clearSearch} onTotal={setTotal} empty={
          <Empty title="Nothing in the server folder" icon={FolderOpen}>
            The folder the server watches has no playable files. Whoever runs the server can add music to <code>MUSIC_DIR</code> and mount it.
          </Empty>
        } />
      ) : (
        <TrackList key={tab} scope={tab} q={urlQ} featured={tab === "mine" && !urlQ} sort={sort} onTotal={setTotal}
          empty={
            urlQ ? (
              <Empty title="No matching tracks" icon={MagnifyingGlass} action={<Button variant="accent" small onClick={clearSearch}>Clear search</Button>}>
                Nothing in {tab === "mine" ? "your library" : "shared music"} matches “{urlQ}”.
              </Empty>
            ) : tab === "mine" ? (
              <Empty title="No music yet" icon={MusicNotes} action={<Button as={Link} to="/upload" variant="accent">Upload music</Button>}>
                Add your first tracks. Only you can see them until you share them.
              </Empty>
            ) : (
              <Empty title="Nothing shared yet" icon={ShareNetwork}>
                Share a track from your library and everyone on this server can play it. Tracks others share show up here too.
              </Empty>
            )
          } />
      )}
    </>
  );
}
