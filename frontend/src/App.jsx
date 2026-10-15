import { useEffect } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence } from "motion/react";
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
      <div className="absolute -left-28 -top-24 h-[420px] w-[420px] rounded-full opacity-60 blur-[90px] transition-colors duration-1000" style={{ background: track ? color : "#1e4f5c" }} />
      <div className="absolute -right-36 top-[45%] h-[320px] w-[320px] rounded-full bg-[#26407a] opacity-45 blur-[90px]" />
    </div>
  );
}

function Shell() {
  const { open, track } = usePlayer();
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="min-h-[100dvh]">
      <Ambient />
      <MediaSessionBridge />
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-1 p-5 lg:flex">
        <p className="mb-5 px-3 text-xl font-medium tracking-tight">Music</p>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-full px-3 text-[16px] ${isActive ? "bg-white/10 text-ink" : "text-mute"}`}>
            {({ isActive }) => <><Icon size={22} weight={isActive ? "fill" : "regular"} />{label}</>}
          </NavLink>
        ))}
      </aside>

      <div className="lg:pl-60">
        <main className="mx-auto max-w-2xl pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-48 pt-[calc(1.75rem+env(safe-area-inset-top))]">
          <Routes>
            <Route path="/" element={<Library />} />
            <Route path="/search" element={<Search />} />
            <Route path="/playlists" element={<PlaylistsIndex />} />
            <Route path="/playlists/:id" element={<PlaylistDetailKeyed />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<Library />} />
          </Routes>
        </main>
      </div>

      <PlayerBar />
      <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-30 flex justify-around rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[12px] ${isActive ? "text-ink" : "text-mute"}`}>
            {({ isActive }) => <><Icon size={24} weight={isActive ? "fill" : "regular"} />{label}</>}
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
  if (user === undefined) return <div className="grid min-h-[100dvh] place-items-center text-mute" role="status">Loading</div>;
  return user ? <Shell /> : <Auth />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DataProvider>
          <PlayerProvider>
            <Gate />
          </PlayerProvider>
        </DataProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
