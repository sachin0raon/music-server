import { Link, useSearchParams } from "react-router-dom";
import { Plus } from "@phosphor-icons/react";
import TrackList from "../components/TrackList";
import { Empty } from "../components/States";

const TABS = [["mine", "My music"], ["shared", "Shared"]];

export default function Library() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "shared" ? "shared" : "mine";
  return (
    <>
      <header className="flex items-center justify-between">
        <h1 className="text-[40px] font-medium leading-tight tracking-tighter">Library</h1>
        <Link to="/upload" aria-label="Upload music" className="btn-round glass"><Plus size={20} /></Link>
      </header>
      <div role="tablist" aria-label="Library" className="glass mb-5 mt-4 flex rounded-full p-1">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setParams(id === "mine" ? {} : { tab: id }, { replace: true })}
            className={`h-10 flex-1 rounded-full text-[15px] font-medium ${tab === id ? "bg-white/15 text-ink" : "text-mute"}`}>{label}</button>
        ))}
      </div>
      <TrackList key={tab} scope={tab} featured={tab === "mine"}
        empty={tab === "mine" ? (
          <Empty title="No music yet" action={<Link to="/upload" className="btn btn-accent">Upload music</Link>}>
            Add your first tracks. Only you can see them until you share them.
          </Empty>
        ) : (
          <Empty title="Nothing shared yet">
            Share a track from your library and everyone on this server can play it. Tracks others share show up here too.
          </Empty>
        )} />
    </>
  );
}
