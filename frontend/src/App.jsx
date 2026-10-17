import { useEffect } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Playlist, MagnifyingGlass, MusicNotes, UserCircle } from "@phosphor-icons/react";
import { AuthProvider, DataProvider, PlayerProvider, useAuth, usePlayer } from "./state";
import { useDominantColor } from "./components/Cover";
import PlayerBar from "./components/PlayerBar";
import NowPlaying from "./components/NowPlaying";
import MediaSessionBridge from "./components/MediaSessionBridge";
import Auth from "./views/Auth";
import Library from "./views/Library";
import Search from "./views/Search";
import { PlaylistDetail, PlaylistsIndex } from "./views/Playlists";
import Upload from "./views/Upload";
import Account from "./views/Account";

const NAV = [
  { to: "/", label: "Library", icon: MusicNotes, end: true },
  { to: "/search", label: "Search", icon: MagnifyingGlass },
  { to: "/playlists", label: "Playlists", icon: Playlist },
  { to: "/account", label: "Account", icon: UserCircle },
];

// Soft colour glow behind everything; it takes its tone from the playing cover
function Ambient() {
  const { track } = usePlayer();
  const color = useDominantColor(track);
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="absolute -left-10 -top-20 h-[460px] w-[460px] rounded-full opacity-75 blur-[90px] transition-colors duration-1000" style={{ background: track ? color : "var(--color-glow-a)" }} />
      <div className="absolute -right-36 bottom-0 h-[340px] w-[340px] rounded-full bg-glow-b opacity-55 blur-[90px]" />
    </div>
  );
}

// Scrolls the new page to the top once it actually mounts. With AnimatePresence
// mode="wait" that is after the outgoing page has left, so the old page is never
// seen jumping to the top mid-fade.
function Page({ children }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return children;
}

// Faint noise film over the page. Dark gradients quantise into visible bands on an
// 8-bit display; this dithers them away. It sits above page content and the now
// playing view (both have big dark gradients) but below sheets, which are opaque.
function Grain() {
  return <div aria-hidden="true" className="grain pointer-events-none fixed inset-0 z-[45]" />;
}

function Shell() {
  const { open, track } = usePlayer();
  const location = useLocation();
  const { pathname } = location;
  return (
    <div className="isolate min-h-[100dvh]">
      <a href="#main" className="glass-raised fixed left-3 top-3 z-[60] -translate-y-20 rounded-full px-4 py-2 text-small font-medium focus:translate-y-0">Skip to content</a>
      <Ambient />
      <Grain />
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
                {isActive && <motion.span layoutId="sidebar-active" aria-hidden="true" className="absolute -left-2 h-5 w-[3px] rounded-full bg-accent" transition={{ type: "spring", damping: 30, stiffness: 400 }} />}
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
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              <Routes location={location}>
                <Route path="/" element={<Page><Library /></Page>} />
                <Route path="/search" element={<Page><Search /></Page>} />
                <Route path="/playlists" element={<Page><PlaylistsIndex /></Page>} />
                <Route path="/playlists/:id" element={<Page><PlaylistDetailKeyed /></Page>} />
                <Route path="/upload" element={<Page><Upload /></Page>} />
                <Route path="/account" element={<Page><Account /></Page>} />
                <Route path="*" element={<Page><Library /></Page>} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>{track && <PlayerBar key="player-bar" track={track} />}</AnimatePresence>
      <nav aria-label="Main" className="glass-bar fixed inset-x-0 bottom-0 z-30 flex justify-around rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-micro font-medium transition-colors duration-[160ms] ${isActive ? "text-ink" : "text-mute"}`}>
            {({ isActive }) => <>
              <span className={`relative grid h-8 w-14 place-items-center rounded-full ${isActive ? "text-accent" : ""}`}>
                {isActive && <motion.span layoutId="nav-active" aria-hidden="true" className="absolute inset-0 rounded-full bg-accent-soft" transition={{ type: "spring", damping: 30, stiffness: 400 }} />}
                <Icon size={24} weight={isActive ? "fill" : "regular"} className="relative" />
              </span>
              {label}
            </>}
          </NavLink>
        ))}
      </nav>
      <AnimatePresence>{open && track && <NowPlaying key="np" />}</AnimatePresence>
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
  return user ? <Shell /> : <Auth />;
}

export default function App() {
  return (
    <BrowserRouter>
      {/* reducedMotion="user" honours the OS "reduce motion" setting for every
          animation below, without each component checking for it */}
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <DataProvider>
            <PlayerProvider>
              <Gate />
            </PlayerProvider>
          </DataProvider>
        </AuthProvider>
      </MotionConfig>
    </BrowserRouter>
  );
}
