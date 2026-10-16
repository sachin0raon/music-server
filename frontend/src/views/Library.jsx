import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FolderOpen, MusicNotes, Plus, ShareNetwork } from "@phosphor-icons/react";
import TrackList from "../components/TrackList";
import FolderList from "../components/FolderList";
import PageHeader from "../components/PageHeader";
import Tabs from "../components/Tabs";
import SortSelect, { SORTS } from "../components/SortSelect";
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
  const sort = SORTS.some(([id]) => id === params.get("sort")) ? params.get("sort") : DEFAULT_SORT;
  const [total, setTotal] = useState(null);
  // Tab and sort both live in the URL; changing one keeps the other
  const update = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeader title="Library" className="mb-4"
        subtitle={total > 0 ? `${total} ${isFolder ? (total === 1 ? "file" : "files") : (total === 1 ? "track" : "tracks")}` : undefined}
        actions={<IconButton as={Link} to="/upload" label="Upload music" variant="glass"><Plus size={20} /></IconButton>} />
      {/* On phones the tabs take the full width (three labels must not wrap) and the
          sort control drops to its own line; from sm up they share one row again. */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Tabs label="Library" tabs={folderOk ? [...TABS, FOLDER_TAB] : TABS} value={tab} className="w-full sm:min-w-0 sm:flex-1"
          onChange={(id) => update("tab", id, "mine")} />
        <SortSelect value={sort} onChange={(v) => update("sort", v, DEFAULT_SORT)} className="self-end sm:self-auto" />
      </div>
      {isFolder ? (
        <FolderList key="folder" sort={sort} onTotal={setTotal} empty={
          <Empty title="Nothing in the server folder" icon={FolderOpen}>
            The folder the server watches has no playable files. Whoever runs the server can add music to <code>MUSIC_DIR</code> and mount it.
          </Empty>
        } />
      ) : (
        <TrackList key={tab} scope={tab} featured={tab === "mine"} sort={sort} onTotal={setTotal}
          empty={tab === "mine" ? (
            <Empty title="No music yet" icon={MusicNotes} action={<Button as={Link} to="/upload" variant="accent">Upload music</Button>}>
              Add your first tracks. Only you can see them until you share them.
            </Empty>
          ) : (
            <Empty title="Nothing shared yet" icon={ShareNetwork}>
              Share a track from your library and everyone on this server can play it. Tracks others share show up here too.
            </Empty>
          )} />
      )}
    </>
  );
}
