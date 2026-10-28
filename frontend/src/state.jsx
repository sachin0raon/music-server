import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { appendUnique, canGoNext, nextStep, restoreOrder, shuffledQueue } from "./playqueue";
import { applyNowPlaying, applyPlaybackState, applyPosition } from "./mediasession";

/* ---------- auth ---------- */
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking
  useEffect(() => { api.get("/api/auth/me").then(setUser).catch(() => setUser(null)); }, []);
  useEffect(() => {
    const expired = () => { fetchCache.clear(); setUser(null); };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  const value = useMemo(() => ({
    user,
    login: async (username, password) => { fetchCache.clear(); setUser(await api.post("/api/auth/login", { username, password })); },
    register: async (username, password) => { fetchCache.clear(); setUser(await api.post("/api/auth/register", { username, password })); },
    logout: async () => { fetchCache.clear(); await api.post("/api/auth/logout").catch(() => {}); setUser(null); },
  }), [user]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

/* ---------- data refresh: bump() makes every list refetch ---------- */
const DataCtx = createContext({ version: 0, bump: () => {} });
export const useData = () => useContext(DataCtx);

export function DataProvider({ children }) {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  return <DataCtx.Provider value={useMemo(() => ({ version, bump }), [version, bump])}>{children}</DataCtx.Provider>;
}

/* ---------- toast notifications ---------- */
const ToastCtx = createContext({ showToast: () => {}, dismiss: () => {}, toasts: [] });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const showToast = useCallback((message, duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ showToast, dismiss, toasts }), [showToast, dismiss, toasts]);

  return <ToastCtx.Provider value={value}>{children}</ToastCtx.Provider>;
}

/* In-memory cache & in-flight promise deduplication for client fetches (client-swr-dedup) */
const fetchCache = new Map();
const inflightFetches = new Map();

export function useFetch(url) {
  const { version } = useData();
  const [tick, setTick] = useState(0);

  // Initialize from cache if matching version
  const [s, setS] = useState(() => {
    if (!url) return { data: null, loading: false, error: null };
    const cached = fetchCache.get(url);
    if (cached && cached.version === version) {
      return { data: cached.data, loading: false, error: null };
    }
    return { data: null, loading: true, error: null };
  });

  useEffect(() => {
    if (!url) return;
    let live = true;
    const cached = fetchCache.get(url);
    if (cached && cached.version === version && tick === 0) {
      setS({ data: cached.data, loading: false, error: null });
      return;
    }

    setS((p) => ({ ...p, loading: p.data === null, error: null }));

    let promise = inflightFetches.get(url);
    if (!promise) {
      promise = api.get(url)
        .then((data) => {
          fetchCache.set(url, { data, version });
          return data;
        })
        .finally(() => {
          inflightFetches.delete(url);
        });
      inflightFetches.set(url, promise);
    }

    promise
      .then((data) => live && setS({ data, loading: false, error: null }))
      .catch((e) => live && setS({ data: null, loading: false, error: e.message }));

    return () => { live = false; };
  }, [url, version, tick]);

  const reload = useCallback(() => {
    fetchCache.delete(url);
    setTick((t) => t + 1);
  }, [url]);

  return { ...s, reload };
}

export function useTracks(scope, q = "", sort = "added_desc", letter = null) {
  const { version } = useData();
  const [s, setS] = useState({ items: [], total: 0, loading: true, error: null, busy: false });
  const [tick, setTick] = useState(0);
  const gen = useRef(0); // bumped on every reset, so a late 'Show more' response can be dropped
  const countRef = useRef(50);
  countRef.current = Math.max(50, s.items.length);
  const prevFilter = useRef(scope + q + sort + (letter || ""));
  if (prevFilter.current !== scope + q + sort + (letter || "")) {
    prevFilter.current = scope + q + sort + (letter || "");
    countRef.current = 50;
  }

  const params = (offset, limit = 50) => {
    const p = new URLSearchParams({ scope, sort, limit: String(limit), offset: String(offset) });
    if (q) p.set("q", q);
    if (letter) p.set("letter", letter);
    return `/api/tracks?${p}`;
  };
  useEffect(() => {
    let live = true;
    gen.current += 1;
    setS((p) => ({ ...p, loading: p.items.length === 0, error: null, busy: false }));
    const limit = countRef.current;
    api.get(params(0, limit))
      .then((d) => live && setS({ items: d.items, total: d.total, loading: false, error: null, busy: false }))
      .catch((e) => live && setS((p) => ({ ...p, loading: false, error: e.message })));
    return () => { live = false; };
  }, [scope, q, sort, letter, version, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMore = async () => {
    const g = gen.current;
    setS((p) => ({ ...p, busy: true }));
    try {
      const d = await api.get(params(s.items.length, 50));
      if (g !== gen.current) return;
      setS((p) => ({ ...p, items: [...p.items, ...d.items], total: d.total, busy: false }));
    } catch (e) {
      if (g !== gen.current) return;
      setS((p) => ({ ...p, busy: false, error: e.message }));
    }
  };
  return { ...s, reload: () => setTick((t) => t + 1), loadMore };
}

/* ---------- player ---------- */
const PlayerCtx = createContext(null);
const TimeCtx = createContext({ time: 0, duration: 0 });
export const usePlayer = () => useContext(PlayerCtx);
export const useTime = () => useContext(TimeCtx);

// Volume is a property of the device, not the account, so it lives in localStorage.
const VOLUME_KEY = "player.volume";
const MUTE_KEY = "player.muted";
const readStore = (key, fallback) => {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
  catch { return fallback; }
};
// Cosine S-curve volume ramp, to take the click out of starting and stopping
// playback mid-waveform.
//
// Stepped on a timer rather than requestAnimationFrame, and over long enough to
// be sampled properly. On a 60Hz display a frame is ~16.7ms, so the 25-35ms
// ramps this replaces were evaluated two or three times: a staircase whose
// middle step jumped about half the amplitude, which is the discontinuity the
// ramp exists to avoid. These durations and this step give fifteen or more
// steps of a few percent each.
//
// Element volume is still only applied at an audio block boundary (128 samples,
// ~2.9ms), so this approximates a fade rather than performing one. Doing it
// properly needs a Web Audio GainNode, which would route playback through an
// AudioContext and put background playback at risk.
const RAMP_STEP_MS = 8;
const FADE_TRACK = 110; // swapping the source out from under playback
const FADE_PLAY = 90;
const FADE_PAUSE = 90;

function rampVolume(audio, fromVol, toVol, durationMs) {
  return new Promise((resolve) => {
    // Never ramp while hidden: neither timers nor frames are reliable in a
    // backgrounded tab, and a stalled ramp would leave playback silent.
    const hidden = () => typeof document !== "undefined" && document.hidden;
    if (!audio || durationMs <= 0 || fromVol === toVol || hidden()) {
      if (audio) audio.volume = toVol;
      resolve();
      return;
    }
    const startTime = performance.now();
    const tick = () => {
      if (hidden()) {
        audio.volume = toVol;
        resolve();
        return;
      }
      const progress = Math.min(1, (performance.now() - startTime) / durationMs);
      const factor = 0.5 - 0.5 * Math.cos(progress * Math.PI);
      const currentVol = fromVol + (toVol - fromVol) * factor;
      audio.volume = Math.max(0, Math.min(1, currentVol));
      if (progress < 1) {
        setTimeout(tick, RAMP_STEP_MS);
      } else {
        audio.volume = toVol;
        resolve();
      }
    };
    tick();
  });
}

// Where a track's audio lives. Kept module-level so the preloader and the
// switch effect agree on the exact string they compare against.
const srcFor = (t) => (t ? (t.stream_url ?? `/api/tracks/${t.id}/stream`) : null);

// How close to the end of a track the next one starts buffering. Long enough to
// have it warm before the handoff, short enough that skipping costs nothing.
const PRELOAD_LEAD = 30;

export function PlayerProvider({ children }) {
  const { user } = useAuth();
  const { bump } = useData();
  const { showToast } = useToast();
  // Two elements, not one. The spare holds the upcoming track already buffered,
  // so a track change is a swap rather than a fresh load. See the `ended`
  // handler: a backgrounded tab cannot be relied on to render in time to start
  // the next track, and any silent gap costs the page its background-audio
  // exemption, which is what stopped playback on a locked phone.
  const elements = useRef(null);
  if (elements.current === null) elements.current = [new Audio(), new Audio()];
  const audioRef = useRef(elements.current[0]);
  const spareRef = useRef(elements.current[1]);
  const loadedSrc = useRef(null); // what the active element is currently playing
  const lastPosSec = useRef(-1); // throttles lock-screen position pushes to once a second

  // Attach both to the DOM so mobile browsers do not prune or discard them in background
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const els = elements.current;
    els.forEach((el) => {
      el.style.display = "none";
      el.preload = "auto";
      if (!document.body.contains(el)) document.body.appendChild(el);
    });
    return () => els.forEach((el) => el.remove());
  }, []);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [open, setOpen] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("off"); // "off" | "all" | "one"
  const [volume, setVolumeState] = useState(() => {
    const v = readStore(VOLUME_KEY, 1);
    return typeof v === "number" && v >= 0 && v <= 1 ? v : 1;
  });
  const [muted, setMuted] = useState(() => readStore(MUTE_KEY, false) === true);
  const qRef = useRef(queue);
  const failures = useRef(0); // consecutive playback errors
  const lastVolume = useRef(volume || 1); // the last audible level, to restore after muting
  const iRef = useRef(index);
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat); // read inside `next`, which must keep a stable identity
  const origOrder = useRef(null); // track ids in the pre-shuffle order; null while shuffle is off
  const queueSource = useRef(null); // the list that started this queue, so it can follow its reorders
  const volRef = useRef(volume);
  const muteRef = useRef(muted);
  // The element's own duration is Infinity for streams it cannot measure up
  // front (a VBR MP3 with no Xing header, say), so the OS scrubber is fed the
  // duration the track carries instead and only falls back to the element.
  const durRef = useRef(0);
  volRef.current = volume;
  muteRef.current = muted;
  durRef.current = duration;
  qRef.current = queue;
  iRef.current = index;
  shuffleRef.current = shuffle;
  repeatRef.current = repeat;
  const track = queue[index] ?? null;
  const patchTrack = useCallback((id, patch) => setQueue((q) => q.map((t) => (t.id === id ? { ...t, ...patch } : t))), []);

  // Restart the current track from the top without moving through the queue.
  const restart = useCallback(() => {
    const a = audioRef.current;
    a.currentTime = 0;
    a.play().catch(() => {});
  }, []);

  const next = useCallback((auto = false) => {
    const step = nextStep({ index: iRef.current, length: qRef.current.length, repeat: repeatRef.current, auto });
    if (step === "restart") restart();
    else if (step === "stop") { const a = audioRef.current; a.pause(); a.currentTime = 0; }
    else if (typeof step === "number") setIndex(step);
  }, [restart]);

  const prev = useCallback(() => {
    const a = audioRef.current, ix = iRef.current;
    if (a.currentTime > 3 || ix <= 0) a.currentTime = 0; // more than ~3s in: restart the track
    else setIndex(ix - 1);
  }, []);

  // Hands the already-buffered spare straight to the speakers and makes it the
  // active element. Runs inside the native `ended` event, so it does not wait on
  // a React render -- a backgrounded tab throttles those, and the resulting gap
  // is what used to end playback at a track boundary on a locked phone.
  const handoff = useCallback((step) => {
    const spare = spareRef.current;
    const upcoming = qRef.current[step];
    const want = srcFor(upcoming);
    if (!want || !spare || spare.getAttribute("src") !== want) return false;
    const a = audioRef.current;
    spare.volume = muteRef.current ? 0 : volRef.current;
    try { if (spare.currentTime > 0) spare.currentTime = 0; } catch { /* not seekable yet */ }
    const started = spare.play();
    if (started) started.catch(() => {});
    audioRef.current = spare;
    spareRef.current = a;
    loadedSrc.current = want;
    a.pause();
    a.removeAttribute("src");
    // Synchronously, for the same reason the play() above is: waiting on a
    // render here leaves the OS session pointing at the finished track, and a
    // stale session is what cost the page its background exemption.
    applyNowPlaying(upcoming, "playing");
    applyPosition(upcoming.duration, 0); // new track: clear the finished one's position
    lastPosSec.current = -1;
    return true;
  }, []);

  useEffect(() => {
    const els = elements.current;
    const active = (e) => e.currentTarget === audioRef.current;
    const knownDuration = (el) => (durRef.current > 0 ? durRef.current : (Number.isFinite(el.duration) ? el.duration : 0));
    const on = {
      play: (e) => { if (active(e)) { applyPlaybackState("playing"); setPlaying(true); } },
      pause: (e) => { if (active(e)) { applyPlaybackState("paused"); setPlaying(false); } },
      timeupdate: (e) => {
        if (!active(e)) return;
        const el = e.currentTarget;
        setTime(el.currentTime);
        // Straight off the media event: a backgrounded tab throttles renders,
        // which left the lock-screen scrubber frozen where the track started.
        const sec = Math.floor(el.currentTime);
        if (sec !== lastPosSec.current) {
          lastPosSec.current = sec;
          applyPosition(knownDuration(el), el.currentTime);
        }
      },
      // A scrub lands anywhere, including inside the second already pushed, so
      // the once-a-second throttle above would swallow it.
      seeked: (e) => {
        if (!active(e)) return;
        const el = e.currentTarget;
        lastPosSec.current = Math.floor(el.currentTime);
        applyPosition(knownDuration(el), el.currentTime);
      },
      loadedmetadata: (e) => { if (active(e) && Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); },
      ended: (e) => {
        if (!active(e)) return;
        const step = nextStep({ index: iRef.current, length: qRef.current.length, repeat: repeatRef.current, auto: true });
        if (typeof step === "number" && handoff(step)) { setIndex(step); return; }
        next(true);
      },
      playing: (e) => { if (active(e)) failures.current = 0; },
      error: (e) => {
        if (!active(e)) return;
        const a = audioRef.current;
        // Skip a track that is gone (deleted or unshared). Stop instead on a network drop,
        // after 3 failures in a row (e.g. expired session), or when there is nothing next.
        failures.current += 1;
        const failed = qRef.current[iRef.current];
        const name = failed?.title ? `"${failed.title}"` : "track";
        showToast(`Playback failed for ${name}. Playing next track...`);
        const last = iRef.current + 1 >= qRef.current.length;
        if (a.error?.code === 2 /* MEDIA_ERR_NETWORK */ || failures.current >= 3 || last) { a.pause(); setPlaying(false); return; }
        next(false);
      },
    };
    els.forEach((el) => Object.entries(on).forEach(([e, f]) => el.addEventListener(e, f)));
    return () => els.forEach((el) => Object.entries(on).forEach(([e, f]) => el.removeEventListener(e, f)));
  }, [next, showToast, handoff]);

  useEffect(() => {
    const a = audioRef.current;
    if (!track) {
      a.pause();
      a.removeAttribute("src");
      loadedSrc.current = null;
      setTime(0);
      setDuration(0);
      return;
    }

    const targetSrc = srcFor(track);
    const targetVol = muted ? 0 : volume;

    // The `ended` handoff already swapped this track in and started it. React is
    // only now catching up, so there is nothing left to load.
    if (loadedSrc.current === targetSrc) {
      setTime(0);
      setDuration(track.duration || 0);
      return;
    }

    let cancelled = false;

    const switchTrack = async () => {
      const isBackground = typeof document !== "undefined" && document.hidden;

      // 1. If actively playing in foreground, perform a 35ms cosine S-curve fade-out to zero.
      // In background/lock-screen, skip fade-out and pause to maintain unbroken OS media session.
      if (!isBackground && !a.paused && a.currentTime > 0 && a.volume > 0) {
        await rampVolume(a, a.volume, 0, FADE_TRACK);
        if (cancelled) return;
        a.pause();
      }

      if (cancelled) return;

      // 2. Set new source
      if (!isBackground) {
        a.volume = 0;
      }
      a.src = targetSrc;
      loadedSrc.current = targetSrc;
      setTime(0);
      setDuration(track.duration || 0);

      // 3. Begin playback
      try {
        await a.play();
        if (cancelled) return;
        if (!isBackground && targetVol > 0) {
          await rampVolume(a, 0, targetVol, FADE_TRACK);
        } else {
          a.volume = targetVol;
        }
      } catch {
        if (!cancelled) setPlaying(false);
      }
    };
    switchTrack();

    return () => {
      cancelled = true;
    };
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the spare element loaded with whatever plays next, so `ended` only has
  // to press play. Repeat-one needs no spare: it replays the active element.
  // Held back until the current track is nearly over, so skipping through a
  // queue does not start (and abandon) a download per tap.
  const nearEnd = duration > 0 && duration - time < PRELOAD_LEAD;
  useEffect(() => {
    const spare = spareRef.current;
    if (!spare || !nearEnd) return;
    const step = nextStep({ index, length: queue.length, repeat, auto: true });
    const want = typeof step === "number" ? srcFor(queue[step]) : null;
    if (!want) {
      if (spare.getAttribute("src")) spare.removeAttribute("src");
      return;
    }
    if (spare.getAttribute("src") === want) return;
    spare.volume = 0; // silent until the handoff raises it, in case it ever self-starts
    spare.src = want;
    spare.load();
  }, [index, queue, repeat, nearEnd]);

  // When a track plays without cover art, check after a short delay for background-fetched artwork
  useEffect(() => {
    if (!track || track.has_cover) return;
    const isFolder = track.source === "folder";
    const url = isFolder ? `/api/library/file/${track.id}` : `/api/tracks/${track.id}`;
    let dead = false;
    const timer = setTimeout(async () => {
      try {
        const d = await api.get(url);
        if (!dead && d?.has_cover) {
          const cacheBust = Date.now();
          const cover_url = isFolder
            ? `/api/library/file/${track.id}/cover?t=${cacheBust}`
            : `/api/tracks/${track.id}/cover?t=${cacheBust}`;
          patchTrack(track.id, { has_cover: true, cover_url });
          bump();
        }
      } catch {
        // silent: cover check is best-effort
      }
    }, 3800);
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [track?.id, track?.has_cover, patchTrack, bump]);

  // Apply the chosen level to the element; this also restores it on first mount,
  // so a persisted volume is in place before the first play.
  useEffect(() => { const a = audioRef.current; if (a) a.volume = muted ? 0 : volume; }, [volume, muted]);
  useEffect(() => { if (volume > 0) lastVolume.current = volume; }, [volume]);
  useEffect(() => {
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(volume));
      localStorage.setItem(MUTE_KEY, JSON.stringify(muted));
    } catch { /* storage disabled: keep the level for this session only */ }
  }, [volume, muted]);

  useEffect(() => { if (!user) { setQueue([]); setIndex(-1); setOpen(false); setShuffle(false); setRepeat("off"); origOrder.current = null; queueSource.current = null; } }, [user]);

  const playTrack = useCallback((t, list, source = null) => {
    failures.current = 0;
    queueSource.current = source; // remember where the queue came from (e.g. a playlist)
    if (shuffleRef.current) {
      // Shuffled run starting from the tapped track. The pre-shuffle order is
      // remembered so turning shuffle off can put it back.
      origOrder.current = list.map((x) => x.id);
      setQueue(shuffledQueue(list, t.id));
      setIndex(0);
      if (qRef.current[iRef.current]?.id === t.id) restart(); // tapping the current track replays it
      return;
    }
    origOrder.current = null;
    if (qRef.current[iRef.current]?.id === t.id) restart();
    setQueue(list);
    setIndex(list.findIndex((x) => x.id === t.id));
  }, [restart]);

  // Shuffle: reorder the live queue so the current track stays first (playback is
  // not interrupted) and remember the old order. Turning it off restores that
  // order with the same track still playing.
  const toggleShuffle = useCallback(() => {
    const q = qRef.current, ix = iRef.current;
    if (!shuffleRef.current) {
      if (q.length) {
        origOrder.current = q.map((t) => t.id);
        setQueue(shuffledQueue(q, q[ix]?.id));
        setIndex(0);
      }
      setShuffle(true);
      return;
    }
    const order = origOrder.current;
    origOrder.current = null;
    if (order) {
      const restored = restoreOrder(order, q); // newest copies of each track, gone ones skipped
      if (restored.length) {
        const at = restored.findIndex((t) => t.id === q[ix]?.id);
        setQueue(restored);
        setIndex(at < 0 ? 0 : at);
      }
    }
    setShuffle(false);
  }, []);

  // The list that started this queue was reordered (the playlist up/down buttons).
  // If this queue is that same list, move it to match, keeping the current track
  // playing. Any other list's reorder leaves us alone.
  const reorderQueue = useCallback((source, ids) => {
    const q = qRef.current, s = queueSource.current;
    if (!q.length || !source || !s || s.type !== source.type || s.id !== source.id) return;
    if (shuffleRef.current) {
      // Playback is already random, so only the remembered order changes: turning
      // shuffle off will now restore the new order.
      if (origOrder.current) {
        const live = new Set(q.map((t) => t.id));
        origOrder.current = ids.filter((id) => live.has(id));
      }
      return;
    }
    const ordered = restoreOrder(ids, q); // same rule as turning shuffle off: new order, extras last
    if (!ordered.length) return;
    const at = ordered.findIndex((t) => t.id === q[iRef.current]?.id);
    setQueue(ordered);
    setIndex(at < 0 ? 0 : at);
  }, []);

  const cycleRepeat = useCallback(() => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")), []);

  // More of the browsing list arrived (a "Show more" on the folder tab). If this
  // queue came from that same list, append the new rows so Next keeps going.
  const extendQueue = useCallback((source, items) => {
    const s = queueSource.current;
    if (!source || !s || s.type !== source.type || s.id !== source.id) return;
    const q = qRef.current;
    const have = new Set(q.map((t) => t.id));
    const add = (items || []).filter((t) => t && !have.has(t.id));
    if (!add.length) return;
    if (origOrder.current) origOrder.current = [...origOrder.current, ...add.map((t) => t.id)];
    setQueue([...q, ...add]);
  }, []);

  // Put tracks at the end of whatever is playing. Unlike extendQueue this is not
  // tied to the list the queue came from: it is the user choosing, so there is no
  // source to match. The index is deliberately untouched -- adding to a queue that
  // has never been started leaves it unstarted, which is what the floating play
  // button watches for.
  const addToQueue = useCallback((items) => {
    const q = qRef.current;
    const { items: next, added, skipped } = appendUnique(q, items);
    if (added) {
      // Keep the remembered pre-shuffle order in step, or turning shuffle off
      // would drop everything added while it was on.
      if (origOrder.current) origOrder.current = [...origOrder.current, ...next.slice(q.length).map((t) => t.id)];
      setQueue(next);
    }
    return { added, skipped };
  }, []);

  const play = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    const targetVol = muted ? 0 : volume;
    const isBackground = typeof document !== "undefined" && document.hidden;
    if (a.paused) {
      if (isBackground) {
        a.volume = targetVol;
        try { await a.play(); } catch {}
      } else {
        a.volume = 0;
        try {
          await a.play();
          if (targetVol > 0) await rampVolume(a, 0, targetVol, FADE_PLAY);
        } catch {
          // ignore
        }
      }
    }
  }, [muted, volume]);

  const pause = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    const isBackground = typeof document !== "undefined" && document.hidden;
    if (!a.paused && a.volume > 0 && !isBackground) {
      const v = a.volume;
      await rampVolume(a, v, 0, FADE_PAUSE);
      a.pause();
      a.volume = v;
    } else {
      a.pause();
    }
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (a.paused) play(); else pause();
  }, [play, pause]);

  // Jump straight to a queue entry (the queue modal). Re-tapping the current row
  // replays it, the same way tapping it in a list does.
  const jumpTo = useCallback((i) => {
    const q = qRef.current;
    if (i < 0 || i >= q.length) return;
    failures.current = 0;
    if (i === iRef.current) restart(); else setIndex(i);
  }, [restart]);

  const seek = useCallback((t) => { audioRef.current.currentTime = t; setTime(t); }, []);
  // Volume is stored on the audio element's own 0..1 scale; dragging off zero unmutes.
  const setVolume = useCallback((v) => {
    const nv = Math.max(0, Math.min(1, v));
    setVolumeState(nv);
    if (nv > 0) setMuted(false);
  }, []);
  // Silence is mute or a slider at 0; unmuting from 0 restores the last audible level.
  const toggleMute = useCallback(() => {
    if (muted || volume === 0) {
      setMuted(false);
      if (volume === 0) setVolumeState(lastVolume.current || 1);
    } else {
      setMuted(true);
    }
  }, [muted, volume]);
  const dropTrack = useCallback((id) => {
    const q = qRef.current, ix = iRef.current, i = q.findIndex((t) => t.id === id);
    if (i < 0) return;
    if (origOrder.current) origOrder.current = origOrder.current.filter((x) => x !== id);
    const nq = q.filter((t) => t.id !== id);
    setQueue(nq);
    setIndex(i < ix ? ix - 1 : i === ix && ix >= nq.length ? -1 : ix);
  }, []);

  // Repeat counts as "there is a next" because it wraps back to the top.
  const canNext = canGoNext({ index, length: queue.length, repeat });
  const value = useMemo(() => ({
    track, queue, index, playing, open, setOpen, playTrack, toggle, play, pause, next, prev, seek, patchTrack, dropTrack, jumpTo,
    shuffle, repeat, toggleShuffle, cycleRepeat, canNext, reorderQueue, extendQueue, addToQueue, volume, muted, setVolume, toggleMute,
  }), [track, queue, index, playing, open, playTrack, toggle, play, pause, next, prev, seek, patchTrack, dropTrack, jumpTo,
       shuffle, repeat, toggleShuffle, cycleRepeat, canNext, reorderQueue, extendQueue, addToQueue, volume, muted, setVolume, toggleMute]);
  const timeValue = useMemo(() => ({ time, duration }), [time, duration]);

  return (
    <PlayerCtx.Provider value={value}>
      <TimeCtx.Provider value={timeValue}>{children}</TimeCtx.Provider>
    </PlayerCtx.Provider>
  );
}
