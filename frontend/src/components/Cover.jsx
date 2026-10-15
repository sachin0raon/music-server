import { useEffect, useState } from "react";
import { MusicNote } from "@phosphor-icons/react";

const TONES = ["#1E4F5C", "#5A3A2E", "#2E4A3F", "#4A4A52", "#3C4A2D", "#2D4A5A", "#26407A"];
export const toneFor = (id) => TONES[id % TONES.length];

export default function Cover({ track, className = "", rounded = "rounded-xl" }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const art = track.has_cover && !failed;
  return (
    <div className={`relative shrink-0 overflow-hidden ${rounded} ${className}`} style={{ background: `linear-gradient(145deg, ${toneFor(track.id)}, color-mix(in srgb, ${toneFor(track.id)} 55%, #000))` }}>
      {art ? (
        <img src={`/api/tracks/${track.id}/cover`} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ease-out ${loaded ? "opacity-100" : "opacity-0"}`} />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-white/45"><MusicNote size="38%" weight="fill" /></div>
      )}
      <div className={`pointer-events-none absolute inset-0 ${rounded} ring-1 ring-inset ring-white/10`} />
    </div>
  );
}

// Average colour of the cover (saturated pixels count more); drives the ambient glow
export function useDominantColor(track) {
  const [color, setColor] = useState(track ? toneFor(track.id) : "#1E4F5C");
  useEffect(() => {
    if (!track) return;
    setColor(toneFor(track.id));
    if (!track.has_cover) return;
    let dead = false;
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 8;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 8, 8);
        const d = ctx.getImageData(0, 0, 8, 8).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const wt = 0.15 + (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255;
          r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
        }
        if (!dead) setColor(`rgb(${(r / w) | 0},${(g / w) | 0},${(b / w) | 0})`);
      } catch { /* keep the fallback tone */ }
    };
    img.src = `/api/tracks/${track.id}/cover`;
    return () => { dead = true; };
  }, [track?.id, track?.has_cover]); // eslint-disable-line react-hooks/exhaustive-deps
  return color;
}
