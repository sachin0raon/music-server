import { Playlist } from "@phosphor-icons/react";
import { toneFor } from "./Cover";

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
