import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { canGoNext, nextStep, restoreOrder, shuffledQueue } from "./playqueue";

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

export function useTracks(scope, q = "", sort = "added_desc") {
  const { version } = useData();
  const [s, setS] = useState({ items: [], total: 0, loading: true, error: null, busy: false });
  const [tick, setTick] = useState(0);
  const gen = useRef(0); // bumped on every reset, so a late 'Show more' response can be dropped
  const countRef = useRef(50);
  countRef.current = Math.max(50, s.items.length);
  const prevFilter = useRef(scope + q + sort);
  if (prevFilter.current !== scope + q + sort) {
    prevFilter.current = scope + q + sort;
    countRef.current = 50;
  }

  const params = (offset, limit = 50) => {
    const p = new URLSearchParams({ scope, sort, limit: String(limit), offset: String(offset) });
    if (q) p.set("q", q);
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
  }, [scope, q, sort, version, tick]); // eslint-disable-line react-hooks/exhaustive-deps
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

export function PlayerProvider({ children }) {
  const { user } = useAuth();
  const { bump } = useData();
  const { showToast } = useToast();
  const audioRef = useRef(null);
  if (audioRef.current === null) audioRef.current = new Audio();
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

  useEffect(() => {
    const a = audioRef.current;
    const on = {
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      timeupdate: () => setTime(a.currentTime),
      loadedmetadata: () => isFinite(a.duration) && setDuration(a.duration),
      ended: () => next(true),
      playing: () => { failures.current = 0; },
      error: () => {
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
    Object.entries(on).forEach(([e, f]) => a.addEventListener(e, f));
    return () => Object.entries(on).forEach(([e, f]) => a.removeEventListener(e, f));
  }, [next, showToast]);

  useEffect(() => {
    const a = audioRef.current;
    if (!track) { a.pause(); a.removeAttribute("src"); setTime(0); setDuration(0); return; }
    a.src = track.stream_url ?? `/api/tracks/${track.id}/stream`;
    setTime(0);
    setDuration(track.duration || 0);
    a.play().catch(() => setPlaying(false));
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  }, []);

  // Jump straight to a queue entry (the queue sheet). Re-tapping the current row
  // replays it, the same way tapping it in a list does.
  const jumpTo = useCallback((i) => {
    const q = qRef.current;
    if (i < 0 || i >= q.length) return;
    failures.current = 0;
    if (i === iRef.current) restart(); else setIndex(i);
  }, [restart]);

  const play = useCallback(() => { audioRef.current.play().catch(() => {}); }, []);
  const pause = useCallback(() => audioRef.current.pause(), []);
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
    shuffle, repeat, toggleShuffle, cycleRepeat, canNext, reorderQueue, extendQueue, volume, muted, setVolume, toggleMute,
  }), [track, queue, index, playing, open, playTrack, toggle, play, pause, next, prev, seek, patchTrack, dropTrack, jumpTo,
       shuffle, repeat, toggleShuffle, cycleRepeat, canNext, reorderQueue, extendQueue, volume, muted, setVolume, toggleMute]);
  const timeValue = useMemo(() => ({ time, duration }), [time, duration]);

  return (
    <PlayerCtx.Provider value={value}>
      <TimeCtx.Provider value={timeValue}>{children}</TimeCtx.Provider>
    </PlayerCtx.Provider>
  );
}
