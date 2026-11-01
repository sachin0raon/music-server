import { useCallback } from "react";
import { api } from "../api";
import { useToast } from "../state";

// Copies a link that downloads without signing in.
//
// The toast says so deliberately. A link that works anywhere is the only kind
// worth copying -- a download manager has no session to present -- but it also
// means anyone holding it can fetch the file, and that is not obvious from a
// URL. Saying it at the moment of copying is the only place it can be read.
export default function useCopyLink() {
  const { showToast } = useToast();

  return useCallback(async (body) => {
    let link;
    try {
      const d = await api.post("/api/downloads/link", body);
      link = `${window.location.origin}/api/downloads/open?token=${encodeURIComponent(d.token)}`;
      await navigator.clipboard.writeText(link);
      showToast(`Link copied — anyone with it can download for ${d.days} days`);
    } catch (e) {
      // The clipboard needs a secure context and a recent gesture, so it can
      // refuse for reasons that have nothing to do with the link. Showing the
      // URL keeps it usable rather than losing it to a failed copy.
      if (link) window.prompt("Copy this link", link);
      else showToast(e.message);
    }
  }, [showToast]);
}
