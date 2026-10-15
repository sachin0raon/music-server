import { useEffect, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import TrackList from "../components/TrackList";
import { Empty } from "../components/States";

export default function Search() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  return (
    <>
      <h1 className="text-[40px] font-medium leading-tight tracking-tighter">Search</h1>
      <div className="relative mb-5 mt-4">
        <MagnifyingGlass size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
        <input className="field !pl-11" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Title, artist or album" aria-label="Search" autoFocus />
      </div>
      {q ? (
        <TrackList scope="all" q={q} empty={<Empty title="No matches">Nothing in your library or shared with you matches “{q}”. Try fewer words.</Empty>} />
      ) : (
        <p className="text-[15px] text-mute">Search your library and everything shared with you.</p>
      )}
    </>
  );
}
