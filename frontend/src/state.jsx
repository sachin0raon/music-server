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
    const expired = () => setUser(null);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  const value = useMemo(() => ({
    user,
    login: async (username, password) => setUser(await api.post("/api/auth/login", { username, password })),
    register: async (username, password) => setUser(await api.post("/api/auth/register", { username, password })),
    logout: async () => { await api.post("/api/auth/logout").catch(() => {}); setUser(null); },
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

export function useFetch(url) {
  const { version } = useData();
  const [s, setS] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    setS((p) => ({ ...p, loading: p.data === null, error: null }));
    api.get(url)
      .then((data) => live && setS({ data, loading: false, error: null }))
      .catch((e) => live && setS({ data: null, loading: false, error: e.message }));
    return () => { live = false; };
  }, [url, version, tick]);
  return { ...s, reload: () => setTick((t) => t + 1) };
}

export function useTracks(scope, q = "") {
  const { version } = useData();
  const [s, setS] = useState({ items: [], total: 0, loading: true, error: null, busy: false });
  const [tick, setTick] = useState(0);
  const gen = useRef(0); // bumped on every reset, so a late 'Show more' response can be dropped
  const params = (offset) => {
    const p = new URLSearchParams({ scope, limit: "50", offset: String(offset) });
    if (q) p.set("q", q);
    return `/api/tracks?${p}`;
  };
  useEffect(() => {
    let live = true;
    gen.current += 1;
    setS((p) => ({ ...p, loading: p.items.length === 0, error: null, busy: false }));
    api.get(params(0))
      .then((d) => live && setS({ items: d.items, total: d.total, loading: false, error: null, busy: false }))
      .catch((e) => live && setS((p) => ({ ...p, loading: false, error: e.message })));
    return () => { live = false; };
  }, [scope, q, version, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMore = async () => {
    const g = gen.current;
    setS((p) => ({ ...p, busy: true }));
    try {
      const d = await api.get(params(s.items.length));
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

export function PlayerProvider({ children }) {
  const { user } = useAuth();
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
  const qRef = useRef(queue);
  const failures = useRef(0); // consecutive playback errors
  const iRef = useRef(index);
  const shuffleRef = useRef(shuffle);
  const repeatRef = useRef(repeat); // read inside `next`, which must keep a stable identity
  const origOrder = useRef(null); // track ids in the pre-shuffle order; null while shuffle is off
  qRef.current = queue;
  iRef.current = index;
  shuffleRef.current = shuffle;
  repeatRef.current = repeat;
  const track = queue[index] ?? null;

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
        const last = iRef.current + 1 >= qRef.current.length;
        if (a.error?.code === 2 /* MEDIA_ERR_NETWORK */ || failures.current >= 3 || last) { a.pause(); setPlaying(false); return; }
        next(false);
      },
    };
    Object.entries(on).forEach(([e, f]) => a.addEventListener(e, f));
    return () => Object.entries(on).forEach(([e, f]) => a.removeEventListener(e, f));
  }, [next]);

  useEffect(() => {
    const a = audioRef.current;
    if (!track) { a.pause(); a.removeAttribute("src"); setTime(0); setDuration(0); return; }
    a.src = `/api/tracks/${track.id}/stream`;
    setTime(0);
    setDuration(track.duration || 0);
    a.play().catch(() => setPlaying(false));
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!user) { setQueue([]); setIndex(-1); setOpen(false); setShuffle(false); setRepeat("off"); origOrder.current = null; } }, [user]);

  const playTrack = useCallback((t, list) => {
    failures.current = 0;
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

  const cycleRepeat = useCallback(() => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off")), []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  }, []);

  const play = useCallback(() => { audioRef.current.play().catch(() => {}); }, []);
  const pause = useCallback(() => audioRef.current.pause(), []);
  const seek = useCallback((t) => { audioRef.current.currentTime = t; setTime(t); }, []);
  const patchTrack = useCallback((id, patch) => setQueue((q) => q.map((t) => (t.id === id ? { ...t, ...patch } : t))), []);
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
    track, queue, index, playing, open, setOpen, playTrack, toggle, play, pause, next, prev, seek, patchTrack, dropTrack,
    shuffle, repeat, toggleShuffle, cycleRepeat, canNext,
  }), [track, queue, index, playing, open, playTrack, toggle, play, pause, next, prev, seek, patchTrack, dropTrack,
       shuffle, repeat, toggleShuffle, cycleRepeat, canNext]);
  const timeValue = useMemo(() => ({ time, duration }), [time, duration]);

  return (
    <PlayerCtx.Provider value={value}>
      <TimeCtx.Provider value={timeValue}>{children}</TimeCtx.Provider>
    </PlayerCtx.Provider>
  );
}
