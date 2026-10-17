import { useState } from "react";
import { Eye, EyeSlash, MusicNotes } from "@phosphor-icons/react";
import GlassPanel from "../components/GlassPanel";
import Tabs from "../components/Tabs";
import Field from "../components/Field";
import { Button, IconButton } from "../components/Button";
import { useAuth } from "../state";

export default function Auth() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const isLogin = mode === "login";

  const switchTab = (nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setErr("");
    setConfirmPassword("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");

    if (!isLogin) {
      if (password.length < 5) {
        setErr("Password must be at least 5 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setErr("Passwords do not match.");
        return;
      }
    }

    setBusy(true);
    try {
      await (isLogin ? login : register)(username.trim(), password);
    } catch (e2) {
      setErr(e2.message || "An error occurred");
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-glow-a opacity-70 blur-[90px]" />
        <div className="absolute -right-32 bottom-10 h-[320px] w-[320px] rounded-full bg-glow-b opacity-55 blur-[90px]" />
      </div>
      {/* Phones: one column. Desktop: the intro sits beside the form instead of floating above it. */}
      <main className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-7 px-[max(1.25rem,env(safe-area-inset-left))] py-10 lg:max-w-4xl lg:grid lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <span className="mb-6 grid h-12 w-12 place-items-center rounded-tile bg-accent text-accent-ink shadow-glow"><MusicNotes size={24} weight="fill" /></span>
          <h1 className="text-display font-semibold">{isLogin ? "Sign in" : "Create account"}</h1>
          <p className="mt-3 max-w-[36ch] text-body text-mute">
            {isLogin ? "Your library and everything shared with you." : "Pick a username and password. No email needed."}
          </p>
        </div>

        <GlassPanel level="raised" className="p-5 shadow-float">
          <Tabs label="Authentication mode" fullWidth tabs={[["login", "Sign in"], ["register", "Create account"]]} value={mode} onChange={switchTab} className="mb-5" />

          <form onSubmit={submit} className="space-y-4">
            <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off"
              required minLength={isLogin ? 1 : 3} maxLength={32} placeholder="Username" />

            <Field label="Password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={isLogin ? "current-password" : "new-password"} required minLength={isLogin ? 1 : 5} maxLength={128}
              placeholder={isLogin ? "Password" : "At least 5 characters"}
              hint={isLogin ? undefined : "At least 5 characters. Letters, numbers, dots, dashes and underscores."}
              trailing={<IconButton size="sm" label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}</IconButton>} />

            {!isLogin && (
              <Field label="Confirm password" type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password" required minLength={5} maxLength={128} placeholder="Repeat password"
                trailing={<IconButton size="sm" label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                  {showConfirmPassword ? <EyeSlash size={20} /> : <Eye size={20} />}</IconButton>} />
            )}

            {err && <p role="alert" className="text-body text-danger">{err}</p>}

            <Button variant="accent" className="mt-2 w-full" disabled={busy}>
              {busy ? "One moment…" : isLogin ? "Sign in" : "Create account"}
            </Button>
          </form>
        </GlassPanel>
      </main>
    </div>
  );
}
