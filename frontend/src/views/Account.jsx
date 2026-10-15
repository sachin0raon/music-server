import { useEffect, useState } from "react";
import { SignOut } from "@phosphor-icons/react";
import PageHeader from "../components/PageHeader";
import GlassPanel from "../components/GlassPanel";
import Field from "../components/Field";
import { Button } from "../components/Button";
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
    <GlassPanel as="section" className="p-5">
      <h2 className="text-heading font-semibold">Install the app</h2>
      <p className="mt-1.5 text-body text-mute">
        {evt ? "Add it to your home screen to open it full screen and control playback from your lock screen."
          : "On iPhone or iPad, tap the Share button in Safari, then Add to Home Screen."}
      </p>
      {evt && <Button variant="accent" className="mt-4" onClick={async () => { evt.prompt(); await evt.userChoice; window.deferredInstall = null; setEvt(null); }}>Install</Button>}
    </GlassPanel>
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
    <GlassPanel as="form" onSubmit={submit} className="space-y-3 p-5">
      <h2 className="text-heading font-semibold">Change password</h2>
      <Field type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" autoComplete="current-password" aria-label="Current password" required />
      <Field type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (5+ characters)" autoComplete="new-password" aria-label="New password" required minLength={5} />
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-body ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>}
      <Button variant="accent">Save password</Button>
    </GlassPanel>
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
    <GlassPanel as="section" className="p-5">
      <h2 className="text-heading font-semibold">People on this server</h2>
      {loading ? <Skeleton rows={2} /> : error ? <ErrorBox message={error} onRetry={reload} /> : (
        <ul className="mt-2">
          {data.map((u) => (
            <li key={u.id} className="flex min-h-14 items-center gap-3 border-b border-line last:border-0">
              <span className="flex-1 truncate text-body">{u.username}{u.is_admin ? <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-micro text-accent">admin</span> : null}</span>
              <Button small onClick={() => { setTarget(u); setPw(""); setMsg(null); }}>Reset password</Button>
            </li>
          ))}
        </ul>
      )}
      {target && (
        <form onSubmit={reset} className="mt-4 flex gap-2">
          <Field className="flex-1" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`New password for ${target.username} (5+ chars)`} aria-label={`New password for ${target.username}`} minLength={5} required autoFocus />
          <Button variant="accent" className="!min-h-12">Reset</Button>
        </form>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-body ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>}
    </GlassPanel>
  );
}

export default function Account() {
  const { user, logout } = useAuth();
  return (
    <>
      <PageHeader title="Account" subtitle={user.is_admin ? `Signed in as ${user.username} (administrator)` : `Signed in as ${user.username}`} />
      <div className="space-y-4">
        <InstallApp />
        <ChangePassword />
        {user.is_admin && <Admin />}
        <Button onClick={logout}><SignOut size={18} />Sign out</Button>
      </div>
    </>
  );
}
