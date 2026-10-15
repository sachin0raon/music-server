import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// Browsers fire this once, early. Keep it so the Account page can offer "Install" later.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.deferredInstall = e;
  window.dispatchEvent(new Event("install-available"));
});
window.addEventListener("appinstalled", () => {
  window.deferredInstall = null;
  window.dispatchEvent(new Event("install-available"));
});

// Service workers only run on HTTPS (or localhost), so this is quietly skipped on plain http
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
