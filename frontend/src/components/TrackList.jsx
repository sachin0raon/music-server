import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowsClockwiseIcon as ArrowsClockwise, CaretDownIcon as CaretDown, PlayIcon as Play, QueueIcon as Queue } from "@phosphor-icons/react";
import Cover from "./Cover";
import { useCoverPalette } from "../palette";
import TrackRow from "./TrackRow";
import TrackMenu from "./TrackMenu";
import GlassPanel from "./GlassPanel";
import { Button, IconButton } from "./Button";
import { Empty, ErrorBox, Skeleton } from "./States";
import { useFetch, usePlayer, useToast, useTracks } from "../state";
import useSelection from "./useSelection";
import { transition } from "../motion";

// Used by Library (scope mine/shared) and Search (scope all + q)
export default function TrackList({ scope, q, letter, empty, featured, onTotal, sort = "added_desc" }) {
  const { items, total, loading, error, busy, reload, loadMore } = useTracks(scope, q, sort, letter);
  const { data: newest } = useFetch(featured ? `/api/tracks?scope=${scope}&sort=added_desc&limit=1` : null);
  const { playTrack, addToQueue, track: current, playing } = usePlayer();
  const { showToast } = useToast();
  const { selected, count, isSelected, toggle, clear } = useSelection(items);
  const [menu, setMenu] = useState(null);
  const reduce = useReducedMotion();

  // A selection only means anything for the rows on screen, and every one of
  // these changes which rows those are.
  useEffect(() => { clear(); }, [scope, q, sort, letter]); // eslint-disable-line react-hooks/exhaustive-deps

  const queueSelected = () => {
    const { added, skipped } = addToQueue(selected);
    showToast(
      added
        ? `Added ${added} ${added === 1 ? "track" : "tracks"} to the queue${skipped ? `, ${skipped} already there` : ""}`
        : "Already in the queue",
    );
    clear();
  };

  // Let the parent show the scope's total (Library puts it under the header).
  // Only once loaded, so a count of 0 never flashes before the real number.
  useEffect(() => { if (!loading) onTotal?.(total); }, [loading, onTotal, total]);

  // The card always shows the newest upload, whatever order the list is in
  const latest = featured ? newest?.items?.[0] ?? null : null;
  const tint = useCoverPalette(latest).topLeft;

  if (loading) return <Skeleton featured={featured} />;
  if (error && !items.length) return <ErrorBox message={error} onRetry={reload} />;
  if (!items.length) return empty ?? <Empty title={letter ? `No tracks starting with "${letter}"` : "Nothing here yet"} />;

  // Play from the card: inside the sorted list when it is there, otherwise just that track
  const playLatest = () => (items.some((t) => t.id === latest.id) ? playTrack(latest, items) : playTrack(latest, [latest]));
  return (
    <>
      {latest && (
        // The card is tinted from its own cover, so the list below reads as one piece with it
        <GlassPanel as={motion.section} initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }}
          transition={transition.slow}
          className="mb-4 flex gap-4 bg-clip-padding p-3.5 sm:gap-6 sm:p-6"
          // bg-clip-padding keeps the tint out from under the border. The border
          // is translucent white, so a background that is strongly coloured at
          // one corner and clear at the other shows through it and the edge
          // reads brighter on one side than the other.
          //
          // The second layer restates .glass-flat, which this element's own
          // background would otherwise replace. Keep the two in step.
          style={{ background: `linear-gradient(115deg, color-mix(in srgb, ${tint} 45%, transparent), transparent 72%), linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.045))` }}>
          <Cover track={latest} eager className="h-[122px] w-[122px] shadow-lift sm:h-[184px] sm:w-[184px]" rounded="rounded-2xl" />
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 py-1 sm:flex-row sm:items-center sm:gap-8 sm:py-0">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-micro font-medium uppercase tracking-wider text-accent">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]" />Latest upload
              </p>
              <h2 className="mt-2 truncate text-heading font-semibold sm:text-title">{latest.title}</h2>
              <p className="truncate text-small text-mute sm:text-body">{latest.artist}</p>
              {/* list responses carry album but not year, so only album is shown here */}
              {latest.album && <p className="truncate text-small text-mute">{latest.album}</p>}
            </div>
            <Button variant="accent" onClick={playLatest} className="self-start sm:shrink-0 sm:self-center"><Play weight="fill" size={16} />Play</Button>
          </div>
        </GlassPanel>
      )}
      {count > 0 && (
        <div className="mb-3 flex items-center gap-3">
          <p className="text-small text-mute" role="status">{count} selected</p>
          <Button small variant="accent" onClick={queueSelected} className="ml-auto">
            <Queue size={16} weight="bold" />Add to queue
          </Button>
          <Button small onClick={clear}>Clear</Button>
        </div>
      )}
      <GlassPanel as="ul" className="overflow-hidden divide-y divide-line/40">
        {items.map((t, i) => {
          const active = current?.id === t.id;
          return (
            <TrackRow
              key={t.id}
              track={t}
              list={items}
              onMenu={setMenu}
              index={i}
              selectable
              selected={isSelected(t)}
              onSelect={toggle}
              active={active}
              eq={active && playing}
              onPlay={playTrack}
            />
          );
        })}
      </GlassPanel>
      {error && <p role="alert" className="mt-3 text-small text-danger">{error}</p>}
      {items.length < total && (
        <div className="mt-4 flex justify-center">
          <IconButton
            variant="glass"
            size="md"
            onClick={loadMore}
            disabled={busy}
            label={busy ? "Loading more tracks" : "Show more tracks"}
            className="shadow-lift hover:scale-105 active:scale-95 transition-transform"
          >
            {busy ? (
              <ArrowsClockwise size={20} weight="bold" className="animate-spin" />
            ) : (
              <CaretDown size={20} weight="bold" />
            )}
          </IconButton>
        </div>
      )}
      <AnimatePresence>{menu && <TrackMenu key="menu" track={menu} onClose={() => setMenu(null)} />}</AnimatePresence>
    </>
  );
}
