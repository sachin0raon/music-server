import Cover from "./Cover";
import { Skeleton, ErrorBox } from "./States";
import { fmt, fmtBitrate, fmtChannels, fmtDate, fmtHz, fmtSize } from "../api";
import { useFetch } from "../state";

const MISSING = <span className="text-mute">—</span>;

// Track and disc are one row, but either can stand alone: a file can carry a
// disc number without a track number, and both must still be visible.
const trackLabel = (n, disc) => {
  const parts = [];
  if (n) parts.push(String(n));
  if (disc) parts.push(n ? `disc ${disc}` : `Disc ${disc}`);
  return parts.length ? parts.join(" · ") : null;
};

function Row({ label, children }) {
  return (
    <div className="min-w-0 border-b border-line py-2.5 last:border-0 sm:col-span-1">
      <dt className="text-micro font-medium uppercase tracking-wider text-mute">{label}</dt>
      <dd className="tnum mt-0.5 truncate text-body">{children ?? MISSING}</dd>
    </div>
  );
}

// The full metadata grid, given a detail object from GET /api/tracks/{id}.
// Missing values show a dash instead of an empty or hidden row.
export function TrackDetails({ track }) {
  const num = (n) => (n === null || n === undefined ? null : String(n));
  return (
    <div>
      <div className="mb-5 flex items-center gap-4">
        <Cover track={track} className="h-20 w-20" rounded="rounded-2xl" />
        <div className="min-w-0">
          <p className="truncate text-heading font-semibold">{track.title}</p>
          <p className="truncate text-small text-mute">{track.artist}</p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {track.owned
              ? <span className={`rounded-full px-2.5 py-0.5 text-micro font-medium ${track.is_shared ? "bg-accent-soft text-accent" : "bg-white/[0.08] text-mute"}`}>{track.is_shared ? "Shared" : "Private"}</span>
              : track.owner && <span className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-micro font-medium text-mute">Shared by {track.owner}</span>}
            {track.format && <span className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-micro font-medium text-mute">{track.format}</span>}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <Row label="Album">{track.album || null}</Row>
        <Row label="Artist">{track.artist}</Row>
        <Row label="Composer">{track.composer || null}</Row>
        <Row label="Genre">{track.genre || null}</Row>
        <Row label="Year">{num(track.year)}</Row>
        <Row label="Duration">{track.duration ? fmt(track.duration) : null}</Row>
        <Row label="Track">{trackLabel(track.track_number, track.disc_number)}</Row>
        <Row label="Bitrate">{fmtBitrate(track.bitrate)}</Row>
        <Row label="Sample rate">{fmtHz(track.sample_rate)}</Row>
        <Row label="Channels">{fmtChannels(track.channels)}</Row>
        <Row label="File size">{fmtSize(track.file_size)}</Row>
        <Row label="Added">{fmtDate(track.created_at)}</Row>
      </dl>
    </div>
  );
}

// Fetches the detail for one track id and renders the grid with loading/error states
export default function TrackDetailsLoader({ trackId }) {
  const { data, loading, error, reload } = useFetch(trackId ? `/api/tracks/${trackId}` : null);
  if (loading) return <Skeleton rows={4} />;
  if (error || !data) return <ErrorBox message={error || "Track not found"} onRetry={reload} />;
  return <TrackDetails track={data} />;
}
