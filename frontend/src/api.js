export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function messageFrom(data) {
  const d = data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e.msg).join(", ");
  return "Something went wrong. Try again.";
}

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/api/auth/")) window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(res.status, messageFrom(data));
  }
  return data;
}

export const api = {
  get: (url) => request("GET", url),
  post: (url, body) => request("POST", url, body),
  put: (url, body) => request("PUT", url, body),
  patch: (url, body) => request("PATCH", url, body),
  del: (url) => request("DELETE", url),
};

// One file per request, so each gets its own progress and result
export function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/tracks");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, "Can't reach the server"));
    xhr.onload = () => {
      if (xhr.status === 401) window.dispatchEvent(new Event("session-expired"));
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data.results[0]);
        else reject(new ApiError(xhr.status, messageFrom(data)));
      } catch {
        reject(new ApiError(xhr.status, xhr.status === 413 ? "Larger than the server allows" : "Upload failed"));
      }
    };
    const form = new FormData();
    form.append("files", file);
    xhr.send(form);
  });
}

export const fmt = (s) => {
  if (!s || !Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

// ---- people-friendly metadata formatting (used by TrackDetails and the player) ----

export const fmtSize = (bytes) => {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

export const fmtBitrate = (bps) => (bps && Number.isFinite(bps) && bps > 0 ? `${Math.round(bps / 1000)} kbps` : null);

export const fmtHz = (hz) => {
  if (!hz || !Number.isFinite(hz) || hz <= 0) return null;
  const k = hz / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)} kHz`;  // 44.1 kHz must not read as 44 kHz
};

export const fmtChannels = (n) => (n === 1 ? "Mono" : n === 2 ? "Stereo" : n ? `${n} channels` : null);

export const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
