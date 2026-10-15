import { useEffect } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
// Open traps, innermost last: a sheet on top of Now Playing is the only one that handles Tab
const stack = [];

// Keeps Tab inside `ref` while mounted, moves focus in on open and restores it on close
export default function useFocusTrap(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement;
    const items = () => [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
    const onKey = (e) => {
      if (e.key !== "Tab" || stack[stack.length - 1] !== el) return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1], now = document.activeElement;
      if (!el.contains(now) || (e.shiftKey && now === first)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (!e.shiftKey && now === last) { e.preventDefault(); first.focus(); }
    };
    stack.push(el);
    document.addEventListener("keydown", onKey);
    if (!el.contains(document.activeElement)) (items()[0] || el).focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(el), 1);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref]);
}
