import { useCallback, useEffect, useState } from "react";
import { HardDrivesIcon as HardDrives, ArrowsClockwiseIcon as ArrowsClockwise, CaretDownIcon as CaretDown } from "@phosphor-icons/react";
import GlassPanel from "./GlassPanel";
import { Button, IconButton } from "./Button";
import { Skeleton, ErrorBox } from "./States";
import { api, fmtSize } from "../api";
import { useAuth } from "../state";

const size = (n) => fmtSize(n) || "0 KB";

// "a moment ago" beats a timestamp here: the only question is whether the
// number in front of you is current, not when precisely it was taken.
function ago(iso) {
  const then = new Date(iso);
  if (Number.isNaN(+then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "a minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? "an hour ago" : `${hrs} hours ago`;
}

function Row({ label, bytes, note }) {
  return (
    <li className="flex min-h-10 items-center gap-3 border-b border-line last:border-0">
      <span className="flex-1 truncate text-body">
        {label}
        {note && <span className="ml-2 text-micro text-mute">{note}</span>}
      </span>
      <span className="tnum shrink-0 text-small text-mute">{size(bytes)}</span>
    </li>
  );
}

// Fetched only when opened. An admin glancing at free space should not pay for
// a query, and other people's figures should not be on screen unasked.
function PerUser() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, error: null, data: null });

  const load = useCallback(async (refresh = false) => {
    setState((p) => ({ ...p, loading: true, error: null }));
    try {
      setState({ loading: false, error: null, data: await api.get(`/api/storage/users${refresh ? "?refresh=true" : ""}`) });
    } catch (e) {
      setState({ loading: false, error: e.message, data: null });
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !state.data && !state.loading) load();
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="interactive flex min-h-10 w-full items-center gap-2 rounded-tile px-1 text-left text-body">
        <CaretDown size={16} weight="bold" className={`text-mute transition-transform ${open ? "" : "-rotate-90"}`} />
        Per-user usage
      </button>
      {open && (
        state.loading ? <Skeleton rows={2} />
          : state.error ? <ErrorBox message={state.error} onRetry={load} />
            : state.data ? (
              <>
                <ul className="mt-1">
                  {state.data.users.map((u) => (
                    <Row key={u.id ?? u.username} bytes={u.bytes}
                      label={u.username || `user ${u.id}`}
                      note={u.orphan ? "deleted account — reclaimable" : null} />
                  ))}
                </ul>
                {/* Its own timestamp: this was fetched separately and can be
                    older or newer than the panel above it. */}
                <p className="mt-2 text-micro text-mute">Updated {ago(state.data.computed_at)}</p>
              </>
            ) : null
      )}
    </div>
  );
}

// How full the server is, and what is using it.
export default function StorageSettings() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async (refresh = false) => {
    setState((p) => ({ ...p, loading: !p.data, error: null }));
    try {
      setState({ loading: false, error: null, data: await api.get(`/api/storage${refresh ? "?refresh=true" : ""}`) });
    } catch (e) {
      setState({ loading: false, error: e.message, data: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { loading, error, data } = state;
  const vol = data?.volume;
  // Filled from free, not from `used`: on ext4 a slice is reserved for root, so
  // used + free is short of total and a bar drawn from `used` stops before the
  // point the text calls full.
  const pct = vol?.total ? Math.min(100, Math.max(0, ((vol.total - vol.free) / vol.total) * 100)) : 0;
  const low = vol && vol.free < vol.reserve;

  return (
    <GlassPanel as="section" className="p-5">
      <div className="flex items-center gap-2">
        <h2 className="flex flex-1 items-center gap-2 text-heading font-semibold">
          <HardDrives size={20} weight="bold" className="text-mute" />Storage
        </h2>
        <IconButton size="sm" label="Recheck storage" onClick={() => load(true)} disabled={loading}
          className="text-mute hover:text-ink">
          <ArrowsClockwise size={18} weight="bold" />
        </IconButton>
      </div>

      {loading && !data ? <Skeleton rows={2} />
        : error ? <ErrorBox message={error} onRetry={load} />
          : !vol ? (
            <p className="mt-2 text-body text-danger" role="alert">
              The storage volume could not be read. It may not be mounted.
            </p>
          ) : (
            <>
              <p className="mt-2 text-body">
                <span className={low ? "text-danger" : "text-accent"}>{size(vol.free)} free</span>
                <span className="text-mute"> of {size(vol.total)}</span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div className={`h-full rounded-full ${low ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 text-micro text-mute">
                {size(vol.reserve)} is kept in reserve, so downloads stop before the disk is full.
                {low && " Free space is below that reserve now."}
              </p>

              {data.library && (
                <>
                  <ul className="mt-4">
                    <Row label="Your library" bytes={data.you.bytes} />
                    <Row label="Shared" bytes={data.library.shared} />
                    <Row label="Temporary" bytes={data.library.tmp} note="from interrupted transfers" />
                    <Row label="Other" bytes={data.library.other} />
                  </ul>
                  <p className="mt-2 text-micro text-mute">
                    {size(data.library.total)} counted · updated {ago(data.computed_at)}
                  </p>
                </>
              )}

              {user.is_admin && <PerUser />}
            </>
          )}
    </GlassPanel>
  );
}
