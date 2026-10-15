import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { Play } from "@phosphor-icons/react";
import Cover from "./Cover";
import TrackRow from "./TrackRow";
import TrackMenu from "./TrackMenu";
import { Empty, ErrorBox, Skeleton } from "./States";
import { usePlayer, useTracks } from "../state";

// Used by Library (scope mine/shared) and Search (scope all + q)
export default function TrackList({ scope, q, empty, featured }) {
  const { items, total, loading, error, busy, reload, loadMore } = useTracks(scope, q);
  const { playTrack } = usePlayer();
  const [menu, setMenu] = useState(null);

  if (loading) return <Skeleton />;
  if (error && !items.length) return <ErrorBox message={error} onRetry={reload} />;
  if (!items.length) return empty ?? <Empty title="Nothing here yet" />;

  const latest = featured ? items[0] : null;
  return (
    <>
      {latest && (
        <section className="glass mb-4 flex gap-4 rounded-card p-3.5">
          <Cover track={latest} className="h-[122px] w-[122px]" rounded="rounded-2xl" />
          <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
            <div>
              <p className="text-sm text-mute">Latest upload</p>
              <h2 className="mt-1 truncate text-[22px] font-medium tracking-tight">{latest.title}</h2>
              <p className="truncate text-sm text-mute">{latest.artist}</p>
            </div>
            <button onClick={() => playTrack(latest, items)} className="btn btn-accent self-start"><Play weight="fill" size={16} />Play</button>
          </div>
        </section>
      )}
      <ul className="glass rounded-card px-4">
        {items.map((t) => <TrackRow key={t.id} track={t} list={items} onMenu={setMenu} />)}
      </ul>
      {error && <p role="alert" className="mt-3 text-[15px] text-[#ff8a8a]">{error}</p>}
      {items.length < total && <button onClick={loadMore} disabled={busy} className="btn glass mt-4 w-full">{busy ? "Loading" : "Show more"}</button>}
      <AnimatePresence>{menu && <TrackMenu key="menu" track={menu} onClose={() => setMenu(null)} />}</AnimatePresence>
    </>
  );
}
