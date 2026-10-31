import { useCallback, useEffect, useState } from "react";
import { CookieIcon as Cookie } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import { Button } from "./Button";
import { api } from "../api";

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

// Cookies for the sites that refuse anonymous downloads.
//
// Here rather than on the download form because a cookies.txt export runs to
// thousands of characters: pasting it per link is friction enough to stop the
// feature being used. This is a thing you set up once, which is what Account is
// for. The download form only asks whether to use it.
//
// Nothing ever reads the file back out -- the server returns whether one exists
// and when it was saved, never its contents -- so the textarea starts empty
// even when cookies are saved. Replacing means pasting a fresh export.
export default function CookieSettings() {
  const [status, setStatus] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let live = true;
    api.get("/api/media/cookies")
      .then((d) => { if (live) setStatus(d); })
      .catch(() => { if (live) setStatus({ saved: false }); });
    return () => { live = false; };
  }, []);

  const save = useCallback(async (e) => {
    e.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true); setMsg(null);
    try {
      setStatus(await api.put("/api/media/cookies", { text }));
      setText("");
      setMsg({ ok: true, text: "Cookies saved. Turn them on when you paste a link that needs them." });
    } catch (ex) {
      setMsg({ ok: false, text: ex.message });
    } finally {
      setBusy(false);
    }
  }, [text, busy]);

  const remove = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      setStatus(await api.del("/api/media/cookies"));
      setMsg({ ok: true, text: "Cookies removed." });
    } catch (ex) {
      setMsg({ ok: false, text: ex.message });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <GlassPanel as="form" onSubmit={save} className="space-y-3 p-5">
      <h2 className="flex items-center gap-2 text-heading font-semibold">
        <Cookie size={20} weight="bold" className="text-mute" />Download cookies
      </h2>
      <p className="max-w-[68ch] text-body text-mute">
        Some sites only serve audio to a signed-in visitor. Export a{" "}
        <code className="rounded bg-white/10 px-1 py-0.5 text-small">cookies.txt</code> file with a browser
        extension and paste it here, then switch cookies on when you paste a link that needs them.
      </p>

      {/* A saved file is a live session for whatever site it came from: worth
          saying plainly, once, rather than burying it in a tooltip. */}
      <p className="max-w-[68ch] text-micro text-mute">
        Anyone who can read this server&rsquo;s files can read these cookies, and they stay valid until the
        site expires them. Sign out of that site to revoke them.
      </p>

      <p className="text-small" role="status">
        {status === null ? "Checking…"
          : status.saved
            ? <span className="text-accent">Saved{status.saved_at ? ` on ${when(status.saved_at)}` : ""}</span>
            : <span className="text-mute">No cookies saved</span>}
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        spellCheck={false}
        autoComplete="off"
        className="field !h-auto resize-y py-3 font-mono text-small"
        aria-label="Paste the contents of a cookies.txt file"
        placeholder={status?.saved ? "Paste a new export to replace the saved one" : "# Netscape HTTP Cookie File…"}
        disabled={busy}
      />

      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-body ${msg.ok ? "text-accent" : "text-danger"}`}>
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="accent" disabled={busy || !text.trim()}>
          {status?.saved ? "Replace cookies" : "Save cookies"}
        </Button>
        {status?.saved && (
          <Button type="button" variant="danger" onClick={remove} disabled={busy}>Remove</Button>
        )}
      </div>
    </GlassPanel>
  );
}
