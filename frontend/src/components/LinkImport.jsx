import { useState } from "react";
import { FileAudioIcon as FileAudio, LinkSimpleIcon as LinkSimple } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import Field from "./Field";
import { Button } from "./Button";
import ImportResults from "./ImportResults";
import { api } from "../api";
import { useData } from "../state";

function deriveFilenameFromUrl(urlStr) {
  try {
    const parsed = new URL(urlStr.trim());
    for (const key of ["path", "file", "filename", "name", "song", "track"]) {
      const val = parsed.searchParams.get(key);
      if (val) {
        const decoded = decodeURIComponent(val);
        const name = decoded.split("/").filter(Boolean).pop()?.split("\\").filter(Boolean).pop();
        if (name && /\.(mp3|flac|m4a|ogg|opus|wav)$/i.test(name)) {
          return name;
        }
      }
    }
    const decodedPath = decodeURIComponent(parsed.pathname);
    const base = decodedPath.split("/").filter(Boolean).pop();
    if (base && /\.(mp3|flac|m4a|ogg|opus|wav)$/i.test(base)) {
      return base;
    }
  } catch {
    // ignore invalid URL
  }
  return "";
}

// The server fetches the link and adds the file to the signed-in user's library.
export default function LinkImport() {
  const { bump } = useData();
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const handleUrlChange = (e) => {
    const nextUrl = e.target.value;
    setUrl(nextUrl);
    const auto = deriveFilenameFromUrl(nextUrl);
    if (auto && (!filename || filename === deriveFilenameFromUrl(url))) {
      setFilename(auto);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const value = url.trim();
    if (!value || busy) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const payload = { url: value };
      if (filename.trim()) {
        payload.filename = filename.trim();
      }
      const r = await api.post("/api/tracks/from-url", payload);
      setResult(r);
      if (r.status === "ok") {
        setUrl("");
        setFilename("");
        bump();
      }
    } catch (err) {
      setErr(err.message);
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
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start">
          <Field className="flex-1" type="url" inputMode="url" icon={LinkSimple} value={url}
            onChange={handleUrlChange} placeholder="https://example.com/song.mp3"
            aria-label="Link to an audio file" error={err} />
          <Button type="submit" variant="accent" disabled={busy || !url.trim()} className="shrink-0">
            {busy ? "Adding…" : "Add"}
          </Button>
        </div>
        <Field
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="File name (optional, e.g. Song Title.mp3)"
          aria-label="File name"
          icon={FileAudio}
        />
      </form>
      <ImportResults items={result ? [result] : []} />
    </GlassPanel>
  );
}
