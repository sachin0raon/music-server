import { useCallback, useEffect, useRef, useState } from "react";
import { LinkSimpleIcon as LinkSimple, DownloadSimpleIcon as DownloadSimple } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import Field from "./Field";
import { Button } from "./Button";
import ImportResults from "./ImportResults";
import { api, fmt } from "../api";
import { useData } from "../state";

const MP3_BITRATES = [128, 192, 256, 320];
const POLL_MS = 1000;
const RUNNING = new Set(["queued", "downloading", "converting", "importing"]);

const LABEL = {
  queued: "Waiting for a slot",
  downloading: "Downloading",
  converting: "Converting",
  importing: "Adding to your library",
};

const size = (bytes) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "");

// Describes a stream the site actually serves, so the numbers are real rather
// than a target we would transcode to.
function formatLabel(f) {
  const parts = [f.codec || f.ext];
  if (f.abr) parts.push(`${f.abr} kbps`);
  if (f.size) parts.push(size(f.size));
  if (f.note) parts.push(f.note);
  return parts.filter(Boolean).join(" · ");
}

// Add a track from a page rather than a direct file link: the server probes it,
// you pick from what is on offer, and the download runs as a job.
export default function MediaLinkImport() {
  const { bump } = useData();
  const [url, setUrl] = useState("");
  const [item, setItem] = useState(null);      // probe result
  const [formatId, setFormatId] = useState("");
  const [asMp3, setAsMp3] = useState(false);
  const [bitrate, setBitrate] = useState(320);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [err, setErr] = useState("");

  // Read inside the poll loop but never a reason to restart it.
  const bumpRef = useRef(bump);
  bumpRef.current = bump;

  const jobId = job?.id ?? null;
  const jobState = job?.state ?? null;
  const running = jobState !== null && RUNNING.has(jobState);

  // Adopt anything already running. The id otherwise lives only in the tab that
  // started it, so a reload halfway through would leave the download going with
  // nothing watching it.
  useEffect(() => {
    let live = true;
    api.get("/api/tracks/media-jobs")
      .then((d) => {
        if (!live) return;
        const active = (d.jobs || []).find((j) => RUNNING.has(j.state));
        if (active) setJob(active);
      })
      .catch(() => { /* nothing running is the normal case */ });
    return () => { live = false; };
  }, []);

  // Keyed on the id and on whether it is still going, not on the job object:
  // every poll returns a new object and would otherwise restart the timer.
  useEffect(() => {
    if (!jobId || !running) return undefined;
    let live = true;
    let timer = 0;
    const tick = async () => {
      try {
        const next = await api.get(`/api/tracks/media-jobs/${jobId}`);
        if (!live) return;
        setJob(next);
        if (next.state === "done" && next.result?.status === "ok") bumpRef.current();
        if (RUNNING.has(next.state)) timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (live) setErr(e.message);
      }
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [jobId, running]);

  const probe = useCallback(async (e) => {
    e.preventDefault();
    const value = url.trim();
    if (!value || busy) return;
    setBusy(true); setErr(""); setItem(null); setJob(null);
    try {
      const d = await api.post("/api/tracks/probe-link", { url: value });
      setItem(d);
      setFormatId(d.formats[0]?.id ?? "");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }, [url, busy]);

  const start = useCallback(async () => {
    if (!item || !formatId || busy) return;
    setBusy(true); setErr("");
    try {
      const body = { url: url.trim(), format_id: formatId };
      if (asMp3) { body.convert = "mp3"; body.bitrate = bitrate; }
      setJob(await api.post("/api/tracks/from-media-link", body));
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }, [item, formatId, asMp3, bitrate, url, busy]);

  const reset = useCallback(() => {
    setUrl(""); setItem(null); setFormatId(""); setJob(null); setErr("");
  }, []);

  return (
    <GlassPanel className="mt-5 p-5 sm:p-6">
      <p className="text-heading font-semibold">Add from a page</p>
      <p className="mt-1 max-w-[68ch] text-body text-mute">
        Paste a link to a page with audio on it. The server reads what is available, you choose,
        and it downloads in the background.
      </p>

      <form onSubmit={probe} className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-start">
        <Field className="flex-1" type="url" inputMode="url" icon={LinkSimple} value={url}
          onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
          aria-label="Link to a page with audio" error={err} disabled={running} />
        <Button type="submit" variant="accent" disabled={busy || running || !url.trim()} className="shrink-0">
          {busy && !item ? "Checking…" : "Check link"}
        </Button>
      </form>

      {item && !job && (
        <div className="mt-5">
          <div className="flex items-start gap-3">
            {item.thumbnail && (
              <img src={item.thumbnail} alt="" loading="lazy" decoding="async"
                className="h-16 w-16 shrink-0 rounded-xl object-cover" />
            )}
            <div className="min-w-0">
              <p className="truncate text-body font-medium">{item.title}</p>
              <p className="truncate text-small text-mute">
                {[item.uploader, item.duration ? fmt(item.duration) : ""].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          <fieldset className="mt-4">
            <legend className="text-small text-mute">Audio to download</legend>
            <div className="mt-2 space-y-1.5">
              {item.formats.map((f) => (
                <label key={f.id} className="interactive flex cursor-pointer items-center gap-3 rounded-tile px-2 py-2">
                  <input type="radio" name="media-format" value={f.id} checked={formatId === f.id}
                    onChange={() => setFormatId(f.id)} className="accent-accent" />
                  <span className="min-w-0 flex-1 truncate text-small">{formatLabel(f)}</span>
                  <span className="shrink-0 text-micro text-mute">{f.ext}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-4 flex items-center gap-2.5 text-small">
            <input type="checkbox" checked={asMp3} onChange={(e) => setAsMp3(e.target.checked)}
              className="accent-accent" />
            Convert to MP3
          </label>
          {asMp3 ? (
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor="mp3-bitrate" className="text-small text-mute">Bitrate</label>
              <select id="mp3-bitrate" value={bitrate} onChange={(e) => setBitrate(+e.target.value)}
                className="field !min-h-9 w-auto px-2 text-small">
                {MP3_BITRATES.map((b) => <option key={b} value={b}>{b} kbps</option>)}
              </select>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button variant="accent" onClick={start} disabled={busy || !formatId}>
              <DownloadSimple size={16} weight="bold" />Download
            </Button>
            <Button onClick={reset} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}

      {job && running && (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-small">{job.title || "Working"}</p>
            <p className="shrink-0 text-small text-mute" role="status">
              {LABEL[job.state] ?? job.state}
              {job.state === "downloading" ? ` ${Math.round(job.percent)}%` : ""}
            </p>
          </div>
          {/* Only downloading reports bytes. The other steps get a label rather
              than a bar inching along on nothing. */}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full bg-accent transition-[width] duration-300 ${job.state === "downloading" ? "" : "animate-pulse"}`}
              style={{ width: job.state === "downloading" ? `${job.percent}%` : "100%" }}
            />
          </div>
        </div>
      )}

      {job && !running && job.result ? <ImportResults items={[job.result]} /> : null}
      {job && !running && (
        <div className="mt-3">
          <Button onClick={reset}>Add another</Button>
        </div>
      )}
    </GlassPanel>
  );
}
