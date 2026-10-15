import { useEffect, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import TrackList from "../components/TrackList";
import PageHeader from "../components/PageHeader";
import Field from "../components/Field";
import { Empty } from "../components/States";

export default function Search() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  return (
    <>
      <PageHeader title="Search" className="mb-4" />
      <Field icon={MagnifyingGlass} className="mb-5" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Title, artist or album" aria-label="Search" autoFocus />
      {q ? (
        <TrackList scope="all" q={q} empty={<Empty title="No matches" icon={MagnifyingGlass}>Nothing in your library or shared with you matches “{q}”. Try fewer words.</Empty>} />
      ) : (
        <Empty title="Find something to play" icon={MagnifyingGlass}>Search your library and everything shared with you.</Empty>
      )}
    </>
  );
}
