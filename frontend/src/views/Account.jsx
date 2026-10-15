import { useEffect, useState } from "react";
import { SignOut } from "@phosphor-icons/react";
import { Skeleton, ErrorBox } from "../components/States";
import { api } from "../api";
import { useAuth, useFetch } from "../state";

function InstallApp() {
  const [evt, setEvt] = useState(() => window.deferredInstall || null);
  useEffect(() => {
    const sync = () => setEvt(window.deferredInstall || null);
    window.addEventListener("install-available", sync);
    return () => window.removeEventListener("install-available", sync);
  }, []);
  const installed = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
  if (installed) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!evt && !ios) return null;
  return (
    <section className="glass rounded-card p-5">
      <h2 className="text-lg font-medium">Install the app</h2>
      <p className="mt-1.5 text-[15px] text-mute">
        {evt ? "Add it to your home screen to open it full screen and control playback from your lock screen."
          : "On iPhone or iPad, tap the Share button in Safari, then Add to Home Screen."}
      </p>
      {evt && <button className="btn btn-accent mt-4" onClick={async () => { evt.prompt(); await evt.userChoice; window.deferredInstall = null; setEvt(null); }}>Install</button>}
    </section>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api.post("/api/auth/change-password", { current_password: current, new_password: next });
      setCurrent(""); setNext("");
      setMsg({ ok: true, text: "Password changed. Your other devices were signed out." });
    } catch (e2) { setMsg({ ok: false, text: e2.message }); }
  };
  return (
    <form onSubmit={submit} className="glass space-y-3 rounded-card p-5">
      <h2 className="text-lg font-medium">Change password</h2>
      <input className="field" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" autoComplete="current-password" aria-label="Current password" required />
      <input className="field" type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (5+ characters)" autoComplete="new-password" aria-label="New password" required minLength={5} />
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[15px] ${msg.ok ? "text-accent" : "text-[#ff8a8a]"}`}>{msg.text}</p>}
      <button className="btn btn-accent">Save password</button>
    </form>
  );
}

function Admin() {
  const { data, loading, error, reload } = useFetch("/api/admin/users");
  const [target, setTarget] = useState(null);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState(null);
  const reset = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/api/admin/users/${target.id}/reset-password`, { new_password: pw });
      setMsg({ ok: true, text: `Password reset for ${target.username}. They're signed out everywhere.` });
      setTarget(null); setPw("");
    } catch (e2) { setMsg({ ok: false, text: e2.message }); }
  };
  return (
    <section className="glass rounded-card p-5">
      <h2 className="text-lg font-medium">People on this server</h2>
      {loading ? <Skeleton rows={2} /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <ul className="mt-2">
          {data.map((u) => (
            <li key={u.id} className="flex min-h-12 items-center gap-3 border-b border-line last:border-0">
              <span className="flex-1 truncate text-[16px]">{u.username}{u.is_admin ? <span className="ml-2 text-sm text-mute">admin</span> : null}</span>
              <button className="btn glass !min-h-9 !px-3.5 text-sm" onClick={() => { setTarget(u); setPw(""); setMsg(null); }}>Reset password</button>
            </li>
          ))}
        </ul>
      )}
      {target && (
        <form onSubmit={reset} className="mt-4 flex gap-2">
          <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`New password for ${target.username} (5+ chars)`} aria-label={`New password for ${target.username}`} minLength={5} required autoFocus />
          <button className="btn btn-accent">Reset</button>
        </form>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-[15px] ${msg.ok ? "text-accent" : "text-[#ff8a8a]"}`}>{msg.text}</p>}
    </section>
  );
}

export default function Account() {
  const { user, logout } = useAuth();
  return (
    <>
      <h1 className="text-[40px] font-medium leading-tight tracking-tighter">Account</h1>
      <p className="mb-5 mt-1 text-[15px] text-mute">Signed in as {user.username}{user.is_admin ? ", admin" : ""}.</p>
      <div className="space-y-4">
        <InstallApp />
        <ChangePassword />
        {user.is_admin && <Admin />}
        <button onClick={logout} className="btn glass"><SignOut size={18} />Sign out</button>
      </div>
    </>
  );
}
