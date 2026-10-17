import { motion } from "motion/react";
import Cover from "./Cover";
import Chip from "./Chip";
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

// The full metadata grid, given a detail object from GET /api/tracks/{id} or /api/library/file/{token}.
// Missing values show a dash instead of an empty or hidden row.
export function TrackDetails({ track }) {
  const num = (n) => (n === null || n === undefined ? null : String(n));
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: "easeOut" }}>
      <div className="mb-5 flex items-center gap-4">
        <Cover track={track} className="h-20 w-20" rounded="rounded-2xl" />
        <div className="min-w-0">
          <p className="truncate text-heading font-semibold">{track.title}</p>
          <p className="truncate text-small text-mute">{track.artist}</p>
          <p className="mt-1.5 flex flex-wrap gap-1.5">
            {track.source === "folder" ? (
              <Chip variant="soft">{track.in_library ? "In your library" : "Server file"}</Chip>
            ) : track.owned ? (
              <Chip variant={track.is_shared ? "accent" : "soft"}>{track.is_shared ? "Shared" : "Private"}</Chip>
            ) : track.owner && (
              <Chip variant="soft">Shared by {track.owner}</Chip>
            )}
            {track.format && <Chip variant="soft">{track.format}</Chip>}
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
    </motion.div>
  );
}

// Fetches the detail for one track id and renders the grid with loading/error states
export default function TrackDetailsLoader({ trackId, track: initialTrack }) {
  const isFolder = initialTrack?.source === "folder";
  const url = isFolder ? `/api/library/file/${trackId}` : (trackId ? `/api/tracks/${trackId}` : null);
  const ready = initialTrack && (initialTrack.bitrate !== undefined || initialTrack.format !== undefined);
  const { data, loading, error, reload } = useFetch(!ready ? url : null);
  const track = ready ? initialTrack : data;
  if (loading && !track) return <Skeleton rows={4} />;
  if (error && !track) return <ErrorBox message={error || "Track not found"} onRetry={reload} />;
  if (!track) return null;
  return <TrackDetails track={track} />;
}
