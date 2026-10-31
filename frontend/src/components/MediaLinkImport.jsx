import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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

// Resolution first: it is what people choose by. The size is deliberately
// marked approximate -- a video-only stream has its audio merged in afterwards,
// so the real download is larger than the number the site reports.
function videoLabel(f) {
  const parts = [f.height ? `${f.height}p` : f.note, f.fps && f.fps > 30 ? `${f.fps}fps` : "", f.codec];
  if (f.size) parts.push(`~${size(f.size)}`);
  return parts.filter(Boolean).join(" · ");
}

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
  const [choice, setChoice] = useState("");   // "src:<format id>" | "mp3:<bitrate>"
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [err, setErr] = useState("");
  // Off every time, even with cookies saved. They are a live credential, and
  // most links do not need them: sending them by default would spend the risk
  // on every download to save a tick on the few that need it.
  const [useCookies, setUseCookies] = useState(false);
  const [hasCookies, setHasCookies] = useState(false);

  // Read inside the poll loop but never a reason to restart it.
  const bumpRef = useRef(bump);
  bumpRef.current = bump;

  const jobId = job?.id ?? null;
  const jobState = job?.state ?? null;
  const running = jobState !== null && RUNNING.has(jobState);

  // Decides between a toggle and a pointer to Account -- offering to use
  // cookies that do not exist would be a switch that silently does nothing.
  useEffect(() => {
    let live = true;
    api.get("/api/media/cookies")
      .then((d) => { if (live) setHasCookies(!!d.saved); })
      .catch(() => { /* treated as none saved */ });
    return () => { live = false; };
  }, []);

  // Adopt anything already running. The id otherwise lives only in the tab that
  // started it, so a reload halfway through would leave the download going with
  // nothing watching it.
  useEffect(() => {
    let live = true;
    api.get("/api/media/jobs")
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
        const next = await api.get(`/api/media/jobs/${jobId}`);
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
      const d = await api.post("/api/media/probe-link", { url: value, use_cookies: useCookies });
      setItem(d);
      setChoice(d.formats[0] ? `src:${d.formats[0].id}`
        : d.video_formats?.[0] ? `vid:${d.video_formats[0].id}` : "");
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }, [url, busy, useCookies]);

  const start = useCallback(async () => {
    if (!item || !choice || busy) return;
    const [kind, value] = choice.split(":");
    setBusy(true); setErr("");
    try {
      // An MP3 choice is a conversion target, not a stream the site has, so it
      // converts from the best one on offer.
      const body = kind === "mp3"
        ? { url: url.trim(), format_id: item.formats[0].id, convert: "mp3", bitrate: +value }
        : kind === "vid"
          ? { url: url.trim(), format_id: value, kind: "video" }
          : { url: url.trim(), format_id: value };
      body.use_cookies = useCookies;
      setJob(await api.post("/api/media/fetch", body));
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }, [item, choice, url, busy, useCookies]);

  const reset = useCallback(() => {
    setUrl(""); setItem(null); setChoice(""); setJob(null); setErr(""); setUseCookies(false);
  }, []);

  // The formats on screen were what the site offered under the old setting, and
  // signing in can change them. Dropping the result forces a fresh check rather
  // than downloading against a list that no longer applies.
  const toggleCookies = useCallback((on) => {
    setUseCookies(on);
    setItem(null); setChoice(""); setErr("");
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

      {hasCookies ? (
        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2.5 text-small">
          <input type="checkbox" checked={useCookies} onChange={(e) => toggleCookies(e.target.checked)}
            disabled={running} className="h-4 w-4 accent-accent" />
          Use my saved cookies for this link
        </label>
      ) : (
        <p className="mt-3 text-micro text-mute">
          Some sites only serve audio to a signed-in visitor.{" "}
          <Link to="/account" className="text-accent underline underline-offset-2">Save cookies in Account</Link>{" "}
          to use them here.
        </p>
      )}

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
            <legend className="text-small text-mute">What to download</legend>
            {/* Only shown when the page has no audio-only stream: these carry a
                picture that gets discarded, so the download is larger than the
                track. Worth saying rather than quietly spending the bandwidth. */}
            {item.formats.some((f) => f.muxed) ? (
              <p className="mt-1 max-w-[68ch] text-micro text-mute">
                This page has no audio-only stream. These include video and only the audio is kept,
                so the download is larger than the track.
              </p>
            ) : null}
            <div className="mt-2 space-y-1.5">
              {item.formats.map((f) => (
                <label key={f.id} className="interactive flex cursor-pointer items-center gap-3 rounded-tile px-2 py-2">
                  <input type="radio" name="media-format" value={`src:${f.id}`}
                    checked={choice === `src:${f.id}`} onChange={() => setChoice(`src:${f.id}`)}
                    className="accent-accent" />
                  <span className="min-w-0 flex-1 truncate text-small">{formatLabel(f)}</span>
                  <span className="shrink-0 text-micro text-mute">{f.ext}</span>
                </label>
              ))}

              {/* In the same group because it is the same decision: what ends up
                  in the library. These are not streams the site offers, so they
                  are converted from the best one that it does -- so they are
                  offered only when there is one. */}
              {item.formats.length > 0 && (
                <p className="pt-2 text-micro text-mute">Converted from the best stream</p>
              )}
              {item.formats.length > 0 && MP3_BITRATES.map((b) => (
                <label key={b} className="interactive flex cursor-pointer items-center gap-3 rounded-tile px-2 py-2">
                  <input type="radio" name="media-format" value={`mp3:${b}`}
                    checked={choice === `mp3:${b}`} onChange={() => setChoice(`mp3:${b}`)}
                    className="accent-accent" />
                  <span className="min-w-0 flex-1 truncate text-small">{`MP3 · ${b} kbps`}</span>
                  <span className="shrink-0 text-micro text-mute">mp3</span>
                </label>
              ))}

              {/* Same list, because it is the same decision -- what to keep.
                  Where it lands differs, so the heading says so. */}
              {item.video_formats?.length > 0 && (
                <>
                  <p className="pt-3 text-micro text-mute">
                    Keep the video instead. Goes to your Videos page: private, and not playable here.
                    Sizes are approximate &mdash; the audio track is merged in afterwards.
                  </p>
                  {item.video_formats.map((f) => (
                    <label key={`v${f.id}`} className="interactive flex cursor-pointer items-center gap-3 rounded-tile px-2 py-2">
                      <input type="radio" name="media-format" value={`vid:${f.id}`}
                        checked={choice === `vid:${f.id}`} onChange={() => setChoice(`vid:${f.id}`)}
                        className="accent-accent" />
                      <span className="min-w-0 flex-1 truncate text-small">{videoLabel(f)}</span>
                      <span className="shrink-0 text-micro text-mute">{f.ext}</span>
                    </label>
                  ))}
                </>
              )}
            </div>
          </fieldset>

          <div className="mt-4 flex gap-2">
            <Button variant="accent" onClick={start} disabled={busy || !choice}>
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
