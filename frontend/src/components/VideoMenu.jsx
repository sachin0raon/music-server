import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowSquareOutIcon as ArrowSquareOut, DownloadSimpleIcon as DownloadSimple, FilmSlateIcon as FilmSlate, LinkSimpleIcon as LinkSimple, PaperPlaneTiltIcon as PaperPlaneTilt, TrashIcon as Trash } from "@phosphor-icons/react";
import Modal from "./Modal";
import Item from "./MenuItem";
import { Button } from "./Button";
import useFocusTrap from "./useFocusTrap";
import useCopyLink from "./useCopyLink";
import { api, fmt, fmtDateTime, fmtSize as size } from "../api";
import { useToast } from "../state";

const RUNNING = new Set(["queued", "uploading"]);

// Inside the dialog rather than stacked on it: two modals both listen for
// Escape on the window, so one press would answer the prompt and close the
// menu behind it. The track menu's discard prompt sits this way for the same
// reason.
function DeletePrompt({ video, busy, onKeep, onDelete }) {
  const ref = useRef(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="alertdialog" aria-modal="true" aria-label="Delete this video?"
      className="w-full max-w-xs rounded-2xl border border-line bg-surface-2 p-4 shadow-float">
      <p className="text-body font-medium">Delete this video?</p>
      <p className="mt-1 text-small text-mute">
        It is removed from the server{video.file_size ? `, freeing ${size(video.file_size)}` : ""}.
        Getting it back means downloading the whole file again.
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="glass" className="flex-1" onClick={onKeep} disabled={busy} data-autofocus>Keep it</Button>
        <Button variant="danger" className="flex-1" onClick={onDelete} disabled={busy}>
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </div>
  );
}

// A second chance was the point of asking: sending it again replaces nothing
// on Telegram's side, it just lands as a new message, so confirming first
// stops an idle tap from quietly doubling up a video someone already has.
function ReuploadPrompt({ video, busy, onKeep, onUpload }) {
  const ref = useRef(null);
  useFocusTrap(ref);
  const when = fmtDateTime(video.telegram_uploaded_at);
  return (
    <div ref={ref} role="alertdialog" aria-modal="true" aria-label="Upload again?"
      className="w-full max-w-xs rounded-2xl border border-line bg-surface-2 p-4 shadow-float">
      <p className="text-body font-medium">Upload again?</p>
      <p className="mt-1 text-small text-mute">
        This was already sent to {video.telegram_chat_title}{when ? ` on ${when}` : ""}.
        Uploading again sends a second copy; it does not replace the first.
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="glass" className="flex-1" onClick={onKeep} disabled={busy} data-autofocus>Keep as is</Button>
        <Button variant="accent" className="flex-1" onClick={onUpload} disabled={busy}>
          {busy ? "Starting…" : "Upload again"}
        </Button>
      </div>
    </div>
  );
}

// What you can do with a downloaded video, in the same shape the track menu
// uses. On a phone three icon buttons per card left almost no room for the
// title, and an icon is a guess until you tap it.
export default function VideoMenu({ video, onClose, onDeleted, fullScreen = false, telegram, job, onUpload }) {
  const { showToast } = useToast();
  const copyLink = useCopyLink();
  const [confirming, setConfirming] = useState(false);
  const [confirmingReupload, setConfirmingReupload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const startUpload = async () => {
    setUploading(true);
    try {
      await onUpload(video);
    } catch (e) {
      showToast(e.message);
    } finally {
      setUploading(false);
    }
  };

  const confirmReupload = async () => {
    setConfirmingReupload(false);
    await startUpload();
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/videos/${video.id}`);
      showToast("Video deleted");
      onDeleted();
      onClose();
    } catch (e) {
      showToast(e.message);
      setBusy(false);
      setConfirming(false);
    }
  };

  const detail = [
    video.height ? `${video.height}p` : "",
    video.duration ? fmt(video.duration) : "",
    size(video.file_size),
    video.container,
  ].filter(Boolean).join(" · ");

  return (
    <Modal
      label={`${video.title} options`}
      title={null}
      onClose={onClose}
      onEscape={() => (confirming ? setConfirming(false) : confirmingReupload ? setConfirmingReupload(false) : onClose())}
      fullScreen={fullScreen}
      overlay={confirming ? (
        <DeletePrompt video={video} busy={busy}
          onKeep={() => setConfirming(false)} onDelete={remove} />
      ) : confirmingReupload ? (
        <ReuploadPrompt video={video} busy={uploading}
          onKeep={() => setConfirmingReupload(false)} onUpload={confirmReupload} />
      ) : null}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-xl bg-white/5">
          {video.has_thumb ? (
            <img src={`/api/videos/${video.id}/thumb`} alt="" loading="lazy" decoding="async"
              className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-mute"><FilmSlate size={20} /></span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-body font-medium">{video.title}</p>
          {video.uploader && <p className="truncate text-small text-mute">{video.uploader}</p>}
          <p className="truncate text-micro text-mute">{detail}</p>
        </div>
      </div>

      {/* A real link: the session cookie already authorises it, so the browser
          transfers it with its own progress rather than the page holding
          gigabytes in memory. */}
      <Item as="a" icon={DownloadSimple} download initialFocus
        href={`/api/videos/${video.id}/file`}
        label={`Download ${video.title}`}>Download</Item>

      <Item icon={LinkSimple} onClick={() => copyLink({ kind: "video", id: video.id })}
        label={`Copy download link for ${video.title}`}>Copy download link</Item>

      {video.source_url && (
        // noreferrer as well as noopener: the page it opens has no business
        // knowing which server sent it.
        <Item as="a" icon={ArrowSquareOut} href={video.source_url}
          target="_blank" rel="noopener noreferrer"
          label={`Open the page ${video.title} came from`}>Open source page</Item>
      )}

      {/* A job actually running wins over the persisted badge: it is the one
          case a re-upload the user just started should not be hidden behind
          "Sent to ...". A job that is NOT running (done, errored, or simply
          absent after a reload) never overrides the badge, since that is a
          stale snapshot of the upload that already finished. */}
      {job && RUNNING.has(job.state) ? (
        <Item icon={PaperPlaneTilt} disabled label={`Uploading ${video.title} to Telegram`}>
          {job.state === "queued" ? "Waiting to upload…" : `Uploading… ${Math.round(job.percent)}%`}
        </Item>
      ) : video.telegram_uploaded_at ? (
        <>
          <p className="flex min-h-12 items-center gap-3.5 rounded-tile px-2 text-body text-mute">
            <PaperPlaneTilt size={22} />
            <span className="min-w-0 flex-1 truncate">
              Sent to {video.telegram_chat_title}
              {video.telegram_link && (
                <> &middot; <a href={video.telegram_link} target="_blank" rel="noopener noreferrer"
                    className="text-accent underline underline-offset-2">View</a></>
              )}
            </span>
          </p>
          {telegram?.is_connected && telegram?.target_chat_title && (
            <Item icon={PaperPlaneTilt} onClick={() => setConfirmingReupload(true)} disabled={uploading}
              label={`Upload ${video.title} to Telegram again`}>
              {uploading ? "Starting…" : "Upload again"}
            </Item>
          )}
          {job?.state === "error" && <p className="px-2 pb-1 text-micro text-danger">{job.error}</p>}
        </>
      ) : telegram?.is_connected && telegram?.target_chat_title ? (
        <>
          <Item icon={PaperPlaneTilt} onClick={startUpload} disabled={uploading}
            label={`Upload ${video.title} to Telegram`}>
            {uploading ? "Starting…" : job?.state === "error" ? "Retry Telegram upload" : "Upload to Telegram"}
          </Item>
          {job?.state === "error" && <p className="px-2 pb-1 text-micro text-danger">{job.error}</p>}
        </>
      ) : (
        <p className="px-2 py-2 text-micro text-mute">
          <Link to="/account" className="text-accent underline underline-offset-2">Set up Telegram in Account</Link>{" "}
          to upload videos there.
        </p>
      )}

      <Item icon={Trash} danger onClick={() => setConfirming(true)}
        label={`Delete ${video.title}`}>Delete video</Item>

      {video.apple_ok === false && (
        <p className="mt-3 text-micro text-mute">
          Encoded as {[video.vcodec, video.acodec].filter(Boolean).join(" / ") || "an unusual codec"},
          which an iPhone or Safari may refuse to play.
        </p>
      )}
    </Modal>
  );
}
