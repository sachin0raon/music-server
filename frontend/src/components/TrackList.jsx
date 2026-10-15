import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { Play } from "@phosphor-icons/react";
import Cover from "./Cover";
import TrackRow from "./TrackRow";
import TrackMenu from "./TrackMenu";
import GlassPanel from "./GlassPanel";
import { Button } from "./Button";
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
        <GlassPanel as="section" className="mb-4 flex gap-4 p-3.5 sm:gap-6 sm:p-5">
          <Cover track={latest} className="h-[122px] w-[122px] shadow-lift sm:h-40 sm:w-40" rounded="rounded-2xl" />
          <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
            <div>
              <p className="text-micro font-medium uppercase tracking-wider text-accent">Latest upload</p>
              <h2 className="mt-1.5 truncate text-heading font-semibold sm:text-title">{latest.title}</h2>
              <p className="truncate text-small text-mute sm:text-body">{latest.artist}</p>
              {/* list responses carry album but not year, so only album is shown here */}
              {latest.album && <p className="truncate text-small text-mute">{latest.album}</p>}
            </div>
            <Button variant="accent" onClick={() => playTrack(latest, items)} className="self-start"><Play weight="fill" size={16} />Play</Button>
          </div>
        </GlassPanel>
      )}
      <GlassPanel as="ul" className="p-2">
        {items.map((t) => <TrackRow key={t.id} track={t} list={items} onMenu={setMenu} />)}
      </GlassPanel>
      {error && <p role="alert" className="mt-3 text-small text-danger">{error}</p>}
      {items.length < total && <Button onClick={loadMore} disabled={busy} className="mt-4 w-full">{busy ? "Loading" : "Show more"}</Button>}
      <AnimatePresence>{menu && <TrackMenu key="menu" track={menu} onClose={() => setMenu(null)} />}</AnimatePresence>
    </>
  );
}
