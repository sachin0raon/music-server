import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import { Button } from "./Button";
import ImportResults from "./ImportResults";
import { api } from "../api";
import { useData } from "../state";

const summary = (job) => {
  const parts = [];
  if (job.added) parts.push(`${job.added} added`);
  if (job.skipped) parts.push(`${job.skipped} already in your library`);
  if (job.failed) parts.push(`${job.failed} failed`);
  return parts.join(", ") || "No new tracks";
};

// Scans MUSIC_DIR on the server and copies new files into the signed-in user's library.
// The scan runs in the background, so the page polls while it works.
export default function FolderScan() {
  const { bump } = useData();
  const [source, setSource] = useState(null);
  const [job, setJob] = useState(null);
  const [err, setErr] = useState("");
  const [starting, setStarting] = useState(false);
  const prev = useRef(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.get("/api/library/source"), api.get("/api/library/scan")])
      .then(([s, j]) => { if (live) { setSource(s); setJob(j.job); } })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, []);

  // Poll while a scan runs, so the counts and the list fill in live
  useEffect(() => {
    if (job?.state !== "running") return;
    const id = setInterval(() => {
      api.get("/api/library/scan").then((j) => setJob(j.job)).catch(() => {});
    }, 1000);
    return () => clearInterval(id);
  }, [job?.state]);

  // Refresh the library once when a scan finishes
  useEffect(() => {
    if (prev.current === "running" && job?.state && job.state !== "running") bump();
    prev.current = job?.state ?? null;
  }, [job?.state, bump]);

  const start = async () => {
    if (starting) return;
    setStarting(true); setErr("");
    try {
      const j = await api.post("/api/library/scan");
      setJob(j.job);
    } catch (e) {
      setErr(e.message);
    } finally {
      setStarting(false);
    }
  };

  const running = job?.state === "running";
  const configured = source?.configured;
  const usable = configured && source.exists && source.readable;

  return (
    <GlassPanel className="mt-5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-tile bg-accent-soft text-accent ring-1 ring-inset ring-accent/20"><FolderOpen size={22} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-heading font-semibold">Scan the server's music folder</p>
          <p className="mt-1 text-body text-mute">
            Adds any file in the folder that is not already in your library. Files are copied in, so the
            original folder is never changed. Tracks are private to you until you share them.
          </p>
          {source && (
            <p className="mt-2 text-small text-mute">
              Folder:{" "}
              <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-micro text-ink">{source.path ?? "not set"}</code>
            </p>
          )}
          {configured && !source.exists && (
            <p className="mt-2 text-small text-danger">The folder is not mounted inside the container, so there is nothing to scan.</p>
          )}
          {configured && source.exists && !source.readable && (
            <p className="mt-2 text-small text-danger">The folder cannot be read.</p>
          )}
          {source && !configured && (
            <p className="mt-2 text-small text-mute">
              No folder is set up yet. Whoever runs the server can set <code>MUSIC_DIR</code> and mount it.
            </p>
          )}
          {err && <p role="alert" className="mt-2 text-small text-danger">{err}</p>}

          {usable && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="accent" onClick={start} disabled={running || starting}>
                {running ? "Scanning…" : "Scan for new music"}
              </Button>
              {running && (
                <p className="text-small text-mute" role="status">
                  {job.found ? `Adding ${job.processed} of ${job.found}…` : "Looking through the folder…"}
                </p>
              )}
              {!running && job?.state === "done" && <p className="text-small text-mute">{summary(job)}</p>}
            </div>
          )}
          {job?.state === "error" && job.error && <p role="alert" className="mt-2 text-small text-danger">{job.error}</p>}
        </div>
      </div>
      {job?.state === "done" && <ImportResults items={job.results} />}
    </GlassPanel>
  );
}
