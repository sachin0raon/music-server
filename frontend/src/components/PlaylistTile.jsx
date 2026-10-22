import { useEffect, useState } from "react";
import { PlaylistIcon as Playlist } from "@phosphor-icons/react";
import { api } from "../api";
import Cover, { toneFor } from "./Cover";

// Generated artwork: playlists have no cover of their own, so tint by id
export default function PlaylistTile({ id, className = "", rounded = "rounded-tile" }) {
  const tone = toneFor(Number(id) || 0);
  return (
    <div className={`relative grid shrink-0 place-items-center overflow-hidden ring-1 ring-inset ring-white/10 ${rounded} ${className}`}
      style={{ background: `linear-gradient(145deg, color-mix(in srgb, ${tone} 80%, #fff), color-mix(in srgb, ${tone} 50%, #000))` }}>
      <Playlist size="38%" weight="fill" className="text-white/60" />
    </div>
  );
}

// Art built from the playlist's own covers: one cover alone, or a 2×2 collage of the
// first four. `tracks` lets a screen that already has them skip the request. Otherwise
// the playlist is fetched once per mount (not on every data change, which would refetch
// every tile after each upload or share). A failed fetch shows the generated tile.
// Until then, and when there is no track, the generated tile shows.
export function PlaylistArt({ id, tracks, className = "", rounded = "rounded-tile" }) {
  const [own, setOwn] = useState(null);
  useEffect(() => {
    if (tracks) return;
    let live = true;
    api.get(`/api/playlists/${id}`).then((d) => live && setOwn(d.tracks)).catch(() => {});
    return () => { live = false; };
  }, [id, tracks]);
  const list = (tracks ?? own ?? []).slice(0, 4);
  if (!list.length) return <PlaylistTile id={id} className={className} rounded={rounded} />;
  if (list.length === 1) return <Cover track={list[0]} className={className} rounded={rounded} />;
  return (
    <div className={`grid shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden bg-ground ring-1 ring-inset ring-white/10 ${rounded} ${className}`}>
      {[0, 1, 2, 3].map((i) => list[i]
        ? <Cover key={`${list[i].id}-${i}`} track={list[i]} rounded="rounded-none" className="h-full w-full" />
        : <PlaylistTile key={`empty-${i}`} id={id} rounded="rounded-none" className="h-full w-full" />)}
    </div>
  );
}
