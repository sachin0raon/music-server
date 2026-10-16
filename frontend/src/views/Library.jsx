import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MusicNotes, Plus, ShareNetwork } from "@phosphor-icons/react";
import TrackList from "../components/TrackList";
import PageHeader from "../components/PageHeader";
import Tabs from "../components/Tabs";
import SortSelect, { SORTS } from "../components/SortSelect";
import { Button, IconButton } from "../components/Button";
import { Empty } from "../components/States";

const TABS = [["mine", "My music"], ["shared", "Shared"]];
const DEFAULT_SORT = "added_desc";

export default function Library() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "shared" ? "shared" : "mine";
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
        subtitle={total > 0 ? `${total} ${total === 1 ? "track" : "tracks"}` : undefined}
        actions={<IconButton as={Link} to="/upload" label="Upload music" variant="glass"><Plus size={20} /></IconButton>} />
      <div className="mb-5 flex items-center gap-2">
        <Tabs label="Library" tabs={TABS} value={tab} className="min-w-0 flex-1"
          onChange={(id) => update("tab", id, "mine")} />
        <SortSelect value={sort} onChange={(v) => update("sort", v, DEFAULT_SORT)} />
      </div>
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
    </>
  );
}
