import { coverUrl } from "./components/Cover";

// Pushes now-playing information to the OS media session.
//
// Called from a React effect for ordinary track changes, and synchronously from
// the player's `ended` handoff. The second caller is the important one: a
// backgrounded tab throttles renders, so a session left to a React effect goes
// stale on a locked phone. Chrome then drops the media notification and stops
// treating the page as playing media, which costs it the background-audio
// exemption and kills playback at the following track boundary.
export function applyNowPlaying(track, playbackState) {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!ms) return;

  if (!track) {
    ms.metadata = null;
    try { ms.playbackState = "none"; } catch { /* not supported here */ }
    return;
  }

  if (typeof MediaMetadata !== "undefined") {
    try {
      ms.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || "",
        artwork: track.has_cover
          ? [{ src: coverUrl(track), sizes: "512x512" }]
          : [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
      });
    } catch { /* metadata is best-effort */ }
  }

  if (playbackState) {
    try { ms.playbackState = playbackState; } catch { /* not supported here */ }
  }

  // Position is deliberately not touched here: this runs again whenever artwork
  // arrives mid-track, and resetting it then would snap the scrubber back to
  // zero. Callers that genuinely started a new track reset it themselves.
}

// Kept off React for the same reason as the rest of this module: the scrubber is
// fed from the element's own `timeupdate`, which keeps firing in a backgrounded
// tab long after renders have been throttled away.
export function applyPosition(duration, position) {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!ms?.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const at = Math.min(Math.max(position || 0, 0), duration);
  try { ms.setPositionState({ duration, playbackRate: 1, position: at }); } catch { /* ignore */ }
}

// Lock-screen play/pause icon. Same throttling problem, same fix.
export function applyPlaybackState(state) {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!ms) return;
  try { ms.playbackState = state; } catch { /* not supported here */ }
}
