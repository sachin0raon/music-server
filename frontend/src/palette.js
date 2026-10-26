import { useEffect, useState } from "react";
import { coverUrl, toneFor } from "./components/Cover";

// Cover art reduced to four ambient-glow colours, one per corner.
//
// Two are read from the artwork, the other two are blends of those. Covers
// rarely carry four genuinely distinct hues, and forcing a third and fourth
// cluster out of one that does not produces noise; interpolating keeps the set
// harmonious whatever the cover looks like.

// ---------- colour space ----------
// Working in OKLCH rather than sRGB: hue, lightness and chroma come apart
// cleanly, which is what lets the glows be clamped to a usable band and blended
// without passing through grey.

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function rgbToOklch(r, g, b) {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.hypot(a, bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

const css = ({ L, C, H }) => `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${H.toFixed(2)})`;

// Shortest way round the hue circle, so a blend between 350 and 10 passes
// through red rather than sweeping the long way through green.
function mixOklch(a, b, t) {
  let dh = b.H - a.H;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return {
    L: a.L + (b.L - a.L) * t,
    C: a.C + (b.C - a.C) * t,
    H: (a.H + dh * t + 360) % 360,
  };
}

// Ambient glows sit behind content, so they are held well away from both ends:
// bright enough to read as colour, dim enough to keep text on top legible.
const asGlow = ({ L, C, H }) => ({
  L: Math.min(Math.max(L, 0.38), 0.55),
  C: Math.min(Math.max(C, 0.04), 0.14),
  H,
});

// ---------- extraction ----------

const SIZE = 16; // 256 samples: enough to find clusters, cheap enough to run inline
const BINS = 12; // 30 degrees apart
const MIN_SAMPLES = 20; // below this the cover has no usable colour at all

function paletteFromImage(img) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

  // Letterbox black, blown highlights and greys all pull the average toward mud,
  // so they are dropped rather than weighted down.
  const bins = Array.from({ length: BINS }, () => ({ weight: 0, L: 0, C: 0, sin: 0, cos: 0 }));
  let kept = 0;
  for (let i = 0; i < data.length; i += 4) {
    const { L, C, H } = rgbToOklch(data[i], data[i + 1], data[i + 2]);
    if (L < 0.12 || L > 0.95 || C < 0.02) continue;
    kept += 1;
    const bin = bins[Math.floor(H / (360 / BINS)) % BINS];
    const w = C; // saturated pixels describe the cover better than washed-out ones
    bin.weight += w;
    bin.L += L * w;
    bin.C += C * w;
    bin.sin += Math.sin((H * Math.PI) / 180) * w;
    bin.cos += Math.cos((H * Math.PI) / 180) * w;
  }
  if (kept < MIN_SAMPLES) return null;

  const resolved = bins
    .filter((b) => b.weight > 0)
    .map((b) => {
      let H = (Math.atan2(b.sin / b.weight, b.cos / b.weight) * 180) / Math.PI;
      if (H < 0) H += 360;
      return { weight: b.weight, L: b.L / b.weight, C: b.C / b.weight, H };
    })
    .sort((x, y) => y.weight - x.weight);

  if (!resolved.length) return null;

  const primary = resolved[0];
  const apart = (a, b) => {
    const d = Math.abs(a.H - b.H) % 360;
    return d > 180 ? 360 - d : d;
  };
  // A second hue far enough from the first to read as a different colour. With
  // nothing suitable, a rotation of the first keeps the pair related instead of
  // inventing a clash.
  const secondary = resolved.slice(1).find((b) => apart(b, primary) >= 40)
    ?? { ...primary, H: (primary.H + 150) % 360, C: primary.C * 0.7 };

  return { primary, secondary };
}

function toneToOklch(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgbToOklch((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

// The four corner colours, as CSS strings ready to drop into a gradient.
function cornersFrom(primary, secondary) {
  const a = asGlow(primary);
  const b = asGlow(secondary);
  // Nudged off the straight line between the two, so the pair of blended
  // corners do not read as the same colour twice.
  const c = mixOklch(a, b, 0.35);
  const d = mixOklch(a, b, 0.7);
  return {
    topLeft: css(a),
    bottomRight: css(b),
    topRight: css({ ...c, H: (c.H + 8) % 360 }),
    bottomLeft: css({ ...d, H: (d.H - 8 + 360) % 360 }),
  };
}

// Covers with no usable colour still get a stable, track-specific set.
function fallbackPalette(track) {
  const tone = toneToOklch(track ? toneFor(track.id) : "#1E4F5C");
  return cornersFrom(tone, { ...tone, H: (tone.H + 150) % 360, C: tone.C * 0.7 });
}

// ---------- gradient ----------

// Four corners. The two blended ones are deliberately weaker: at equal strength
// four hues bleeding together over a near-black ground average back to grey.
export function ambientGradient(p) {
  return [
    `radial-gradient(ellipse 80% 55% at 0% 0%, color-mix(in srgb, ${p.topLeft} 50%, transparent) 0%, transparent 75%)`,
    `radial-gradient(ellipse 55% 45% at 100% 0%, color-mix(in srgb, ${p.topRight} 28%, transparent) 0%, transparent 70%)`,
    `radial-gradient(ellipse 60% 40% at 0% 100%, color-mix(in srgb, ${p.bottomLeft} 24%, transparent) 0%, transparent 70%)`,
    `radial-gradient(ellipse 65% 50% at 100% 100%, color-mix(in srgb, ${p.bottomRight} 40%, transparent) 0%, transparent 70%)`,
    "var(--color-ground)",
  ].join(", ");
}

// ---------- hook ----------

const cache = new Map();

const keyFor = (track) =>
  (track ? (track.cover_url ?? (track.has_cover ? `/api/tracks/${track.id}/cover` : String(track.id))) : null);

export function useCoverPalette(track) {
  const cacheKey = keyFor(track);
  const [palette, setPalette] = useState(() => (
    cacheKey && cache.has(cacheKey) ? cache.get(cacheKey) : fallbackPalette(track)
  ));

  useEffect(() => {
    if (!track || !cacheKey) return undefined;
    if (cache.has(cacheKey)) {
      setPalette(cache.get(cacheKey));
      return undefined;
    }
    setPalette(fallbackPalette(track));
    const src = coverUrl(track);
    if (!src) return undefined;

    let dead = false;
    const img = new Image();
    img.onload = () => {
      let next;
      try {
        const found = paletteFromImage(img);
        next = found ? cornersFrom(found.primary, found.secondary) : fallbackPalette(track);
      } catch {
        next = fallbackPalette(track); // tainted canvas or no 2d context
      }
      cache.set(cacheKey, next);
      if (!dead) setPalette(next);
    };
    img.src = src;
    return () => { dead = true; };
  }, [track?.id, track?.has_cover, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return palette;
}
