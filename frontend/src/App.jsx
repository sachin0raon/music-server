import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { PlaylistIcon as Playlist, MagnifyingGlassIcon as MagnifyingGlass, MusicNotesIcon as MusicNotes, UserCircleIcon as UserCircle, WarningCircleIcon as WarningCircle, XIcon as X } from "@phosphor-icons/react";
import { AuthProvider, DataProvider, PlayerProvider, ToastProvider, useAuth, usePlayer, useToast } from "./state";
import Ambient from "./components/Ambient";
import PlayerBar from "./components/PlayerBar";
import QueueFab from "./components/QueueFab";
import MediaSessionBridge from "./components/MediaSessionBridge";
import { transition } from "./motion";

// Dynamic imports for routes and heavy dialogs to optimize bundle size (bundle-dynamic-imports)
const Auth = lazy(() => import("./views/Auth"));
const Library = lazy(() => import("./views/Library"));
const Search = lazy(() => import("./views/Search"));
const Upload = lazy(() => import("./views/Upload"));
const Account = lazy(() => import("./views/Account"));
const PlaylistsIndex = lazy(() => import("./views/Playlists").then((m) => ({ default: m.PlaylistsIndex })));
const PlaylistDetail = lazy(() => import("./views/Playlists").then((m) => ({ default: m.PlaylistDetail })));
const NowPlaying = lazy(() => import("./components/NowPlaying"));

const NAV = [
  { to: "/", label: "Library", icon: MusicNotes, end: true },
  { to: "/search", label: "Search", icon: MagnifyingGlass },
  { to: "/playlists", label: "Playlists", icon: Playlist },
  { to: "/account", label: "Account", icon: UserCircle },
];

function PageGlow() {
  const { track } = usePlayer();
  // Kept mounted even while the full-screen player is open. Skipping it there
  // looks like an obvious saving, but the player slides up over a few hundred
  // milliseconds and only covers the viewport once it arrives, so unmounting on
  // open left bare ground showing behind the sheet for the whole journey.
  return <Ambient track={track} className="fixed inset-0 -z-10" />;
}

// Scrolls the new page to the top once it actually mounts. With AnimatePresence
// mode="wait" that is after the outgoing page has left, so the old page is never
// seen jumping to the top mid-fade.
function Page({ children }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return children;
}


function Shell() {
  const { open, track, queue, index } = usePlayer();
  const location = useLocation();
  const { pathname } = location;
  return (
    <div className="isolate min-h-[100dvh]">
      <a href="#main" className="glass-raised fixed left-3 top-3 z-[60] -translate-y-20 rounded-full px-4 py-2 text-small font-medium focus:translate-y-0">Skip to content</a>
      <PageGlow />
      <MediaSessionBridge />
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-1 p-5 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <span className="grid h-8 w-8 place-items-center rounded-control bg-accent text-accent-ink shadow-glow"><MusicNotes size={18} weight="fill" /></span>
          <p className="text-heading font-semibold">Music</p>
        </div>
        <nav aria-label="Sidebar" className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `relative flex min-h-11 items-center gap-3 rounded-full px-3 text-body transition-colors duration-[160ms] hover:bg-white/[0.06] hover:text-ink ${isActive ? "bg-white/10 font-medium text-ink" : "text-mute"}`}>
              {({ isActive }) => <>
                {isActive && <motion.span layoutId="sidebar-active" aria-hidden="true" className="absolute -left-2 h-5 w-[3px] rounded-full bg-accent" transition={transition.pill} />}
                <Icon size={22} weight={isActive ? "fill" : "regular"} className={isActive ? "text-accent" : ""} />{label}
              </>}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="lg:pl-60">
        <main id="main" tabIndex={-1} className="outline-none mx-auto max-w-[calc(42rem+2.5rem)] md:max-w-[calc(48rem+2.5rem)] xl:max-w-[calc(60rem+2.5rem)] 2xl:max-w-[calc(68rem+2.5rem)] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-48 pt-[calc(1.75rem+env(safe-area-inset-top))]">
          {/* mode="wait" so the old page finishes leaving before the new one arrives;
              the exiting copy keeps its own `location`, so it never flashes the new route */}
          <AnimatePresence mode="wait">
            <motion.div key={pathname}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={transition.base}>
              <Suspense fallback={null}>
                <Routes location={location}>
                  <Route path="/" element={<Page><Library /></Page>} />
                  <Route path="/search" element={<Page><Search /></Page>} />
                  <Route path="/playlists" element={<Page><PlaylistsIndex /></Page>} />
                  <Route path="/playlists/:id" element={<Page><PlaylistDetailKeyed /></Page>} />
                  <Route path="/upload" element={<Page><Upload /></Page>} />
                  <Route path="/account" element={<Page><Account /></Page>} />
                  <Route path="*" element={<Page><Library /></Page>} />
                </Routes>
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>{track && <PlayerBar key="player-bar" track={track} />}</AnimatePresence>
      {/* Stands in for the player bar while a hand-built queue waits to be started */}
      <AnimatePresence>{queue.length > 0 && index < 0 && <QueueFab key="queue-fab" />}</AnimatePresence>
      <nav aria-label="Main" className="glass-bar fixed inset-x-0 bottom-0 z-30 flex justify-around rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-micro font-medium transition-colors duration-[160ms] ${isActive ? "text-ink" : "text-mute"}`}>
            {({ isActive }) => <>
              <span className={`relative grid h-8 w-14 place-items-center rounded-full ${isActive ? "text-accent" : ""}`}>
                {isActive && <motion.span layoutId="nav-active" aria-hidden="true" className="absolute inset-0 rounded-full bg-accent-soft" transition={transition.pill} />}
                <Icon size={24} weight={isActive ? "fill" : "regular"} className="relative" />
              </span>
              {label}
            </>}
          </NavLink>
        ))}
      </nav>
      <AnimatePresence>{open && track && <Suspense fallback={null}><NowPlaying key="np" /></Suspense>}</AnimatePresence>
    </div>
  );
}

// Remount per playlist so one playlist's data never shows under another's name
function PlaylistDetailKeyed() {
  const { pathname } = useLocation();
  return <PlaylistDetail key={pathname} />;
}

function Gate() {
  const { user } = useAuth();
  if (user === undefined) return (
    <div className="grid min-h-[100dvh] place-items-center" role="status" aria-label="Loading">
      <span className="grid h-14 w-14 animate-pulse place-items-center rounded-tile bg-accent text-accent-ink shadow-glow"><MusicNotes size={28} weight="fill" /></span>
    </div>
  );
  return user ? <Shell /> : <Suspense fallback={null}><Auth /></Suspense>;
}

function ToastContainer() {
  const { toasts, dismiss } = useToast();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed top-[calc(1rem+env(safe-area-inset-top))] inset-x-0 z-[70] flex flex-col items-center gap-2 px-4"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.95 }}
            transition={transition.base}
            role="alert"
            className="glass-raised pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-line-strong px-4 py-3 shadow-2xl"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-danger-soft text-danger">
              <WarningCircle size={18} weight="bold" />
            </span>
            <p className="min-w-0 flex-1 text-small font-medium text-ink">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-mute hover:text-ink -mr-1 p-1 transition-colors"
              aria-label="Dismiss notification"
            >
              <X size={16} weight="bold" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* reducedMotion="user" honours the OS "reduce motion" setting for every
          animation below, without each component checking for it */}
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <DataProvider>
            <ToastProvider>
              <PlayerProvider>
                <Gate />
                <ToastContainer />
              </PlayerProvider>
            </ToastProvider>
          </DataProvider>
        </AuthProvider>
      </MotionConfig>
    </BrowserRouter>
  );
}
