import { useState } from "react";
import { LinkSimple } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import Field from "./Field";
import { Button } from "./Button";
import ImportResults from "./ImportResults";
import { api } from "../api";
import { useData } from "../state";

// The server fetches the link and adds the file to the signed-in user's library.
export default function LinkImport() {
  const { bump } = useData();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    const value = url.trim();
    if (!value || busy) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await api.post("/api/tracks/from-url", { url: value });
      setResult(r);
      if (r.status === "ok") { setUrl(""); bump(); }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassPanel className="mt-5 p-5 sm:p-6">
      <p className="text-heading font-semibold">Add from a link</p>
      <p className="mt-1 max-w-[68ch] text-body text-mute">
        Paste a direct link to an audio file. The server downloads it and adds it to your library.
        mp3, flac, m4a, ogg, opus and wav.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-start">
        <Field className="flex-1" type="url" inputMode="url" icon={LinkSimple} value={url}
          onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/song.mp3"
          aria-label="Link to an audio file" error={err} />
        <Button type="submit" variant="accent" disabled={busy || !url.trim()} className="shrink-0">
          {busy ? "Adding…" : "Add"}
        </Button>
      </form>
      <ImportResults items={result ? [result] : []} />
    </GlassPanel>
  );
}
