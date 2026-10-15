import { useState } from "react";
import { useAuth } from "../state";

export default function Auth() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const isLogin = mode === "login";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try { await (isLogin ? login : register)(username.trim(), password); }
    catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#1e4f5c] opacity-70 blur-[90px]" />
        <div className="absolute -right-32 bottom-10 h-[320px] w-[320px] rounded-full bg-[#26407a] opacity-55 blur-[90px]" />
      </div>
      <main className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] py-10">
        <h1 className="text-[40px] font-medium leading-none tracking-tighter">{isLogin ? "Sign in" : "Create your account"}</h1>
        <p className="mt-3 text-[15px] text-mute">{isLogin ? "Your library and everything shared with you." : "Pick a username and password. No email needed."}</p>
        <form onSubmit={submit} className="glass mt-7 space-y-4 rounded-card p-5">
          <label className="block">
            <span className="mb-1.5 block text-sm text-mute">Username</span>
            <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" required minLength={isLogin ? 1 : 3} maxLength={32} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-mute">Password</span>
            <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isLogin ? "current-password" : "new-password"} required minLength={isLogin ? 1 : 8} maxLength={128} />
            {!isLogin && <span className="mt-1.5 block text-sm text-mute">At least 8 characters. Usernames can use letters, numbers, dots, dashes and underscores.</span>}
          </label>
          {err && <p role="alert" className="text-[15px] text-[#ff8a8a]">{err}</p>}
          <button className="btn btn-accent w-full" disabled={busy}>{busy ? "One moment" : isLogin ? "Sign in" : "Create account"}</button>
        </form>
        <button onClick={() => { setMode(isLogin ? "register" : "login"); setErr(""); }} className="mt-5 self-start text-[15px] text-mute underline underline-offset-4">
          {isLogin ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </main>
    </div>
  );
}
