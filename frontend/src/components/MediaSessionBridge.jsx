import { useEffect, useRef } from "react";
import { coverUrl } from "./Cover";
import { usePlayer, useTime } from "../state";

// Lock screen, notification shade and headphone/keyboard media keys
export default function MediaSessionBridge() {
  const { track, playing, play, pause, next, prev, seek, canNext } = usePlayer();
  const { time, duration } = useTime();
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  const timeRef = useRef(0);
  const durRef = useRef(0);
  const handlersRef = useRef({});
  handlersRef.current = { play, pause, next, prev, seek, canNext };
  timeRef.current = time;
  durRef.current = duration;

  useEffect(() => {
    document.title = track ? `${track.title}, ${track.artist} - Music Server` : "Music Server";
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ms || typeof MediaMetadata === "undefined") return;
    if (!track) { ms.metadata = null; return; }
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || "",
      artwork: track.has_cover
        ? [{ src: coverUrl(track), sizes: "512x512" }]
        : [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
  }, [track?.id, track?.has_cover]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ms) return;
    const set = (action, handler) => { try { ms.setActionHandler(action, handler); } catch { /* not supported here */ } };
    const clamp = (t) => Math.max(0, Math.min(t, durRef.current || t));
    set("play", () => handlersRef.current.play?.());
    set("pause", () => handlersRef.current.pause?.());
    set("stop", () => handlersRef.current.pause?.());
    set("previoustrack", () => handlersRef.current.prev?.());
    set("nexttrack", () => {
      if (handlersRef.current.canNext) handlersRef.current.next?.(false);
    });
    set("seekto", (d) => handlersRef.current.seek?.(clamp(d.seekTime)));
    set("seekbackward", (d) => handlersRef.current.seek?.(clamp(timeRef.current - (d.seekOffset || 10))));
    set("seekforward", (d) => handlersRef.current.seek?.(clamp(timeRef.current + (d.seekOffset || 10))));
    return () => ["play", "pause", "stop", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"].forEach((a) => set(a, null));
  }, [ms]);

  useEffect(() => { if (ms) ms.playbackState = track ? (playing ? "playing" : "paused") : "none"; }, [ms, track, playing]);

  // About once a second, so the lock screen scrubber stays in step
  const whole = Math.floor(time);
  useEffect(() => {
    if (!ms?.setPositionState || !track || !Number.isFinite(duration) || duration <= 0) return;
    try { ms.setPositionState({ duration, playbackRate: 1, position: Math.min(time, duration) }); } catch { /* ignore */ }
  }, [ms, track?.id, whole, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
