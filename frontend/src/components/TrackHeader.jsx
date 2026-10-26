import Cover from "./Cover";
import Chip from "./Chip";

// The shared track summary at the top of every view in the track modal.
// It stays mounted across view changes, so the panel never loses its context.
export default function TrackHeader({ track }) {
  return (
    <div className="mb-5 flex items-start gap-4">
      <Cover track={track} className="h-20 w-20 shrink-0" rounded="rounded-2xl" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-heading font-semibold leading-snug">{track.title}</p>
        <p className="break-words text-small text-mute">{track.artist}</p>
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
  );
}
