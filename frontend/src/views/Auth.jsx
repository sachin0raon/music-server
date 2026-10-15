import { useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
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
        <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#1e4f5c] opacity-70 blur-[90px]" />
        <div className="absolute -right-32 bottom-10 h-[320px] w-[320px] rounded-full bg-[#26407a] opacity-55 blur-[90px]" />
      </div>
      <main className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-[max(1.25rem,env(safe-area-inset-left))] py-10">
        <h1 className="text-[40px] font-medium leading-none tracking-tighter">
          {isLogin ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-3 text-[15px] text-mute">
          {isLogin
            ? "Your library and everything shared with you."
            : "Pick a username and password. No email needed."}
        </p>

        <div className="glass mt-7 rounded-card p-5">
          {/* Segmented Tab Switcher */}
          <div role="tablist" aria-label="Authentication mode" className="mb-5 grid grid-cols-2 rounded-2xl bg-white/5 p-1 border border-line">
            <button
              type="button"
              role="tab"
              aria-selected={isLogin}
              onClick={() => switchTab("login")}
              className={`min-h-10 rounded-xl text-sm font-medium transition-all ${
                isLogin
                  ? "bg-white/15 text-ink shadow-sm"
                  : "text-mute hover:text-ink"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isLogin}
              onClick={() => switchTab("register")}
              className={`min-h-10 rounded-xl text-sm font-medium transition-all ${
                !isLogin
                  ? "bg-white/15 text-ink shadow-sm"
                  : "text-mute hover:text-ink"
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm text-mute">Username</span>
              <input
                className="field"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
                minLength={isLogin ? 1 : 3}
                maxLength={32}
                placeholder="Username"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm text-mute">Password</span>
              <div className="relative">
                <input
                  className="field pr-12"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                  minLength={isLogin ? 1 : 5}
                  maxLength={128}
                  placeholder={isLogin ? "Password" : "At least 5 characters"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-mute hover:text-ink p-1 transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeSlash size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {!isLogin && (
                <span className="mt-1.5 block text-xs text-mute">
                  At least 5 characters. Letters, numbers, dots, dashes and underscores.
                </span>
              )}
            </label>

            {!isLogin && (
              <label className="block">
                <span className="mb-1.5 block text-sm text-mute">Confirm password</span>
                <div className="relative">
                  <input
                    className="field pr-12"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={5}
                    maxLength={128}
                    placeholder="Repeat password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-mute hover:text-ink p-1 transition-colors"
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? <EyeSlash size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </label>
            )}

            {err && (
              <p role="alert" className="text-[15px] text-[#ff8a8a]">
                {err}
              </p>
            )}

            <button className="btn btn-accent w-full mt-2" disabled={busy}>
              {busy ? "One moment…" : isLogin ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={() => switchTab(isLogin ? "register" : "login")}
          className="mt-5 self-start text-[15px] text-mute underline underline-offset-4 hover:text-ink transition-colors"
        >
          {isLogin ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
      </main>
    </div>
  );
}
