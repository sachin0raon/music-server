import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CaretLeft, Check, UploadSimple, WarningCircle } from "@phosphor-icons/react";
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
      <Link to="/" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[15px] text-mute"><CaretLeft size={16} />Library</Link>
      <h1 className="text-[40px] font-medium leading-tight tracking-tighter">Upload</h1>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        className={`glass mt-4 rounded-card border-dashed p-6 text-left ${over ? "!border-accent" : ""}`}>
        <UploadSimple size={28} className="text-mute" />
        <p className="mt-3 text-lg font-medium">Add music to your library</p>
        <p className="mt-1 text-[15px] text-mute">Drop files here or choose them. mp3, flac, m4a, ogg, opus and wav. Uploads are private until you share them.</p>
        <button className="btn btn-accent mt-4" onClick={() => input.current.click()}>Choose files</button>
        <input ref={input} type="file" multiple accept=".mp3,.flac,.m4a,.ogg,.opus,.wav,audio/*" className="hidden"
          onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <ul className="glass mt-5 rounded-card px-4" aria-live="polite">
          {files.map((f) => (
            <li key={f.id} className="border-b border-line py-3.5 last:border-0">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[15px]">{f.file.name}</span>
                {f.status === "ok" && <Check size={18} weight="bold" className="text-accent" />}
                {(f.status === "error" || f.status === "duplicate") && <WarningCircle size={18} className={f.status === "error" ? "text-[#ff8a8a]" : "text-mute"} />}
              </div>
              <p className={`mt-0.5 text-sm ${f.status === "error" ? "text-[#ff8a8a]" : "text-mute"}`}>
                {f.status === "error" || f.status === "duplicate" ? (f.detail || LABEL[f.status]) : LABEL[f.status]}
              </p>
              {f.status === "uploading" && (
                <div className="mt-2 h-1 rounded-full bg-white/15" role="progressbar" aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-1 rounded-full bg-accent" style={{ width: `${f.progress * 100}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {done && (
        <div className="mt-5 flex items-center gap-3">
          <Link to="/" className="btn btn-accent">{added ? `View ${added} new ${added === 1 ? "track" : "tracks"}` : "Back to library"}</Link>
          <button className="btn glass" onClick={() => setFiles([])}>Clear list</button>
        </div>
      )}
    </>
  );
}
