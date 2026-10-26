import { useState } from "react";
import { MusicNoteIcon as MusicNote } from "@phosphor-icons/react";

const TONES = ["#1E4F5C", "#5A3A2E", "#2E4A3F", "#4A4A52", "#3C4A2D", "#2D4A5A", "#26407A"];
const hash = (text) => { let h = 0; for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0; return Math.abs(h); };
// Library tracks are keyed by number; folder rows by an opaque token, which still needs a stable tone.
export const toneFor = (id) => TONES[(typeof id === "number" ? id : hash(String(id))) % TONES.length];

// A folder row carries its own cover_url; a library track keeps using its id-scoped route.
export const coverUrl = (track) =>
  track.cover_url ?? (track.has_cover ? `/api/tracks/${track.id}/cover` : null);

// `eager`: above-the-fold art (player, featured card, mini bar) loads at once;
// everywhere else stays lazy so a long list does not fetch every cover.
export default function Cover({ track, className = "", rounded = "rounded-xl", eager = false }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = coverUrl(track);
  const art = src && !failed;
  return (
    <div className={`relative shrink-0 overflow-hidden ${rounded} ${className}`} style={{ background: `linear-gradient(145deg, ${toneFor(track.id)}, color-mix(in srgb, ${toneFor(track.id)} 55%, #000))` }}>
      {/* The note is the base layer, not a branch: a cover that is still loading
          (or has none) shows art-like fallback instead of an empty gradient. */}
      <div className="absolute inset-0 grid place-items-center text-white/45"><MusicNote size="38%" weight="fill" /></div>
      {art && (
        <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[220ms] ease-out ${loaded ? "opacity-100" : "opacity-0"}`} />
      )}
      <div className={`pointer-events-none absolute inset-0 ${rounded} ring-1 ring-inset ring-white/10`} />
    </div>
  );
}
