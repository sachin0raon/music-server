import { useCallback, useEffect, useState } from "react";
import { PaperPlaneTiltIcon as PaperPlaneTilt } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import Field from "./Field";
import { Button } from "./Button";
import { api } from "../api";

// Chosen chat from the fetched list. Pulled out so both the "choose target"
// view and the connected-summary view render a row the same way.
function ChatRow({ chat, onPick, busy }) {
  return (
    <label className="interactive flex cursor-pointer items-center gap-3 rounded-tile px-2 py-2">
      <input type="radio" name="telegram-target" className="accent-accent"
        onChange={() => onPick(chat)} disabled={busy} />
      <span className="min-w-0 flex-1 truncate text-small">{chat.title}</span>
      <span className="shrink-0 text-micro text-mute">{chat.type}</span>
    </label>
  );
}

// Uploading a video to your own Telegram account.
//
// A multi-step login (phone -> code -> password if 2FA) rather than a
// paste-a-session-string box: Kurigram's interactive client.start() calls
// input(), which only works on a terminal, but the pieces underneath --
// connect, send the code, sign in, check the password -- are plain API calls
// this can drive instead. The session string that results is never shown back
// here, the same discipline CookieSettings uses for its own secret.
export default function TelegramSettings() {
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState("idle"); // idle | phone | code | password | chats
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(null);
  const [chats, setChats] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => {
    api.get("/api/telegram/account").then(setStatus).catch(() => setStatus({ is_connected: false }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const startLogin = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const d = await api.post("/api/telegram/login/start", {
        api_id: Number(apiId), api_hash: apiHash, phone_number: phone,
      });
      setToken(d.token);
      setStep("code");
    } catch (ex) {
      setMsg({ ok: false, text: ex.message });
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const d = await api.post("/api/telegram/login/code", { token, code });
      if (d.status === "password_required") {
        setStep("password");
      } else {
        finishedLogin(d.account);
      }
    } catch (ex) {
      setMsg({ ok: false, text: ex.message });
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const d = await api.post("/api/telegram/login/password", { token, password });
      finishedLogin(d.account);
    } catch (ex) {
      setMsg({ ok: false, text: ex.message });
    } finally {
      setBusy(false);
    }
  };

  const finishedLogin = (account) => {
    setStatus(account);
    setStep("idle");
    setApiId(""); setApiHash(""); setPhone(""); setCode(""); setPassword(""); setToken(null);
    setMsg({ ok: true, text: "Connected." });
  };

  const reconnect = async () => {
    setBusy(true); setMsg(null);
    try {
      setStatus(await api.post("/api/telegram/reconnect"));
      setMsg({ ok: true, text: "Reconnected." });
    } catch (ex) {
      // The stored login no longer works -- the only graceful way forward is
      // a fresh one, so the form opens rather than just showing red text.
      setMsg({ ok: false, text: ex.message });
      setStep("phone");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true); setMsg(null);
    try {
      setStatus(await api.post("/api/telegram/disconnect"));
    } catch (ex) {
      setMsg({ ok: false, text: ex.message });
    } finally {
      setBusy(false);
    }
  };

  const openChats = async () => {
    setStep("chats"); setChats(null); setMsg(null);
    try {
      const d = await api.get("/api/telegram/chats");
      setChats(d.chats);
    } catch (ex) {
      setMsg({ ok: false, text: ex.message });
      setStep("idle");
    }
  };

  const pickChat = async (chat) => {
    setBusy(true); setMsg(null);
    try {
      setStatus(await api.post("/api/telegram/target", { chat_id: chat.id, title: chat.title, type: chat.type }));
      setStep("idle");
      setMsg({ ok: true, text: `Uploading to ${chat.title}.` });
    } catch (ex) {
      setMsg({ ok: false, text: ex.message });
    } finally {
      setBusy(false);
    }
  };

  if (status === null) {
    return (
      <GlassPanel className="p-5">
        <h2 className="flex items-center gap-2 text-heading font-semibold">
          <PaperPlaneTilt size={20} weight="bold" className="text-mute" />Telegram upload
        </h2>
        <p className="mt-2 text-small text-mute" role="status">Checking…</p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="space-y-3 p-5">
      <h2 className="flex items-center gap-2 text-heading font-semibold">
        <PaperPlaneTilt size={20} weight="bold" className="text-mute" />Telegram upload
      </h2>
      <p className="max-w-[68ch] text-body text-mute">
        Logs in as you, through your own Telegram app credentials from{" "}
        <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer"
          className="text-accent underline underline-offset-2">my.telegram.org</a>, so a video on this server
        can be sent to a channel or group you choose.
      </p>
      <p className="max-w-[68ch] text-micro text-mute">
        This is full control of that Telegram account, not just one site&rsquo;s download access. Anyone who can
        read this server&rsquo;s database can read it.
      </p>

      <p className="text-small" role="status">
        {status.is_connected
          ? <span className="text-accent">Connected{status.phone_number ? ` as ${status.phone_number}` : ""}</span>
          : status.has_session
            ? <span className="text-mute">Disconnected (reconnect without logging in again)</span>
            : <span className="text-mute">Not connected</span>}
        {status.target_chat_title && ` · uploading to ${status.target_chat_title}`}
      </p>

      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-body ${msg.ok ? "text-accent" : "text-danger"}`}>
          {msg.text}
        </p>
      )}

      {step === "idle" && !status.is_connected && (
        <div className="flex flex-wrap gap-2">
          {status.has_session && (
            <Button variant="accent" onClick={reconnect} disabled={busy}>
              {busy ? "Reconnecting…" : "Reconnect"}
            </Button>
          )}
          <Button onClick={() => setStep("phone")} disabled={busy}>
            {status.has_session ? "Log in with a different account" : "Log in"}
          </Button>
        </div>
      )}

      {step === "idle" && status.is_connected && (
        <div className="flex flex-wrap gap-2">
          <Button variant="accent" onClick={openChats} disabled={busy}>
            {status.target_chat_title ? "Change target" : "Choose target"}
          </Button>
          <Button variant="danger" onClick={disconnect} disabled={busy}>Disconnect</Button>
        </div>
      )}

      {step === "phone" && (
        <form onSubmit={startLogin} className="space-y-2.5">
          <Field label="api_id" type="number" value={apiId} onChange={(e) => setApiId(e.target.value)} required />
          <Field label="api_hash" value={apiHash} onChange={(e) => setApiHash(e.target.value)} required />
          <Field label="Phone number" placeholder="+1 555 0100" value={phone}
            onChange={(e) => setPhone(e.target.value)} required />
          <div className="flex gap-2">
            <Button type="button" onClick={() => setStep("idle")} disabled={busy} className="flex-1">Cancel</Button>
            <Button type="submit" variant="accent" disabled={busy} className="flex-1">
              {busy ? "Sending…" : "Send code"}
            </Button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={submitCode} className="space-y-2.5">
          <Field label="Code" placeholder="12345" inputMode="numeric" value={code}
            onChange={(e) => setCode(e.target.value)} autoFocus required />
          <div className="flex gap-2">
            <Button type="button" onClick={() => setStep("idle")} disabled={busy} className="flex-1">Cancel</Button>
            <Button type="submit" variant="accent" disabled={busy} className="flex-1">
              {busy ? "Checking…" : "Verify"}
            </Button>
          </div>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={submitPassword} className="space-y-2.5">
          <Field label="Two-step verification password" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} autoFocus required />
          <div className="flex gap-2">
            <Button type="button" onClick={() => setStep("idle")} disabled={busy} className="flex-1">Cancel</Button>
            <Button type="submit" variant="accent" disabled={busy} className="flex-1">
              {busy ? "Checking…" : "Confirm"}
            </Button>
          </div>
        </form>
      )}

      {step === "chats" && (
        <div>
          {chats === null ? (
            <p className="text-small text-mute" role="status">Fetching chats…</p>
          ) : chats.length === 0 ? (
            <p className="text-small text-mute">No channels, groups, or Saved Messages found.</p>
          ) : (
            <div className="space-y-1">
              {chats.map((c) => <ChatRow key={c.id} chat={c} onPick={pickChat} busy={busy} />)}
            </div>
          )}
          <Button className="mt-3" onClick={() => setStep("idle")} disabled={busy}>Cancel</Button>
        </div>
      )}
    </GlassPanel>
  );
}
