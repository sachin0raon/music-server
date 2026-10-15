import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import PageHeader from "../components/PageHeader";
import GlassPanel from "../components/GlassPanel";
import { Button } from "../components/Button";
import { uploadFile } from "../api";
import { useData } from "../state";

const LABEL = { queued: "Waiting", uploading: "Uploading", ok: "Added", duplicate: "Already in your library", error: "Failed" };

export default function Upload() {
  const { bump } = useData();
  const [files, setFiles] = useState([]);
  const [over, setOver] = useState(false);
  const input = useRef(null);
  const nextId = useRef(0);
  const running = useRef(false);

  const patch = (id, p) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const add = (list) => {
    const added = [...list].map((file) => ({ id: nextId.current++, file, status: "queued", progress: 0, detail: "" }));
    if (added.length) setFiles((fs) => [...fs, ...added]);
  };

  // Upload one file at a time so each has its own progress and result
  useEffect(() => {
    if (running.current) return;
    const item = files.find((f) => f.status === "queued");
    if (!item) return;
    running.current = true;
    patch(item.id, { status: "uploading" });
    uploadFile(item.file, (p) => patch(item.id, { progress: p }))
      .then((r) => patch(item.id, { status: r.status, detail: r.detail ?? "", progress: 1 }))
      .catch((e) => patch(item.id, { status: "error", detail: e.message }))
      .finally(() => { running.current = false; bump(); setFiles((fs) => [...fs]); });
  }, [files]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = files.length > 0 && files.every((f) => !["queued", "uploading"].includes(f.status));
  const added = files.filter((f) => f.status === "ok").length;

  return (
    <>
      <PageHeader title="Upload" back={{ to: "/", label: "Library" }} className="mb-4" />
      <GlassPanel onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        className={`flex flex-col items-start border-dashed p-6 text-left transition-colors duration-200 sm:p-8 ${over ? "!border-accent !bg-accent-soft" : ""}`}>
        <span className="grid h-14 w-14 place-items-center rounded-tile bg-accent-soft text-accent ring-1 ring-inset ring-accent/20"><UploadSimple size={28} /></span>
        <p className="mt-4 text-heading font-semibold">Add music to your library</p>
        <p className="mt-1 max-w-[52ch] text-body text-mute">Drop files here or choose them. mp3, flac, m4a, ogg, opus and wav. Uploads are private until you share them.</p>
        <Button variant="accent" className="mt-5" onClick={() => input.current.click()}>Choose files</Button>
        <input ref={input} type="file" multiple accept=".mp3,.flac,.m4a,.ogg,.opus,.wav,audio/*" className="hidden"
          onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </GlassPanel>

      {files.length > 0 && (
        <GlassPanel as="ul" className="mt-5 px-4" aria-live="polite">
          {files.map((f) => (
            <li key={f.id} className="border-b border-line py-3.5 last:border-0">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-body">{f.file.name}</span>
                {f.status === "ok" && <Check size={18} weight="bold" className="text-accent" />}
                {(f.status === "error" || f.status === "duplicate") && <WarningCircle size={18} className={f.status === "error" ? "text-danger" : "text-mute"} />}
              </div>
              <p className={`mt-0.5 text-small ${f.status === "error" ? "text-danger" : "text-mute"}`}>
                {f.status === "error" || f.status === "duplicate" ? (f.detail || LABEL[f.status]) : LABEL[f.status]}
              </p>
              {f.status === "uploading" && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label={`Uploading ${f.file.name}`} aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${f.progress * 100}%` }} />
                </div>
              )}
            </li>
          ))}
        </GlassPanel>
      )}
      {done && (
        <div className="mt-5 flex items-center gap-3">
          <Button as={Link} to="/" variant="accent">{added ? `View ${added} new ${added === 1 ? "track" : "tracks"}` : "Back to library"}</Button>
          <Button onClick={() => setFiles([])}>Clear list</Button>
        </div>
      )}
    </>
  );
}
