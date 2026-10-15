import { Link, useSearchParams } from "react-router-dom";
import { MusicNotes, Plus, ShareNetwork } from "@phosphor-icons/react";
import TrackList from "../components/TrackList";
import PageHeader from "../components/PageHeader";
import Tabs from "../components/Tabs";
import { Button, IconButton } from "../components/Button";
import { Empty } from "../components/States";

const TABS = [["mine", "My music"], ["shared", "Shared"]];

export default function Library() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "shared" ? "shared" : "mine";
  return (
    <>
      <PageHeader title="Library" className="mb-4"
        actions={<IconButton as={Link} to="/upload" label="Upload music" variant="glass"><Plus size={20} /></IconButton>} />
      <Tabs label="Library" tabs={TABS} value={tab} className="mb-5"
        onChange={(id) => setParams(id === "mine" ? {} : { tab: id }, { replace: true })} />
      <TrackList key={tab} scope={tab} featured={tab === "mine"}
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
