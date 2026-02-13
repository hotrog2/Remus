const AUTH_BASE = (import.meta.env.VITE_AUTH_BASE || import.meta.env.VITE_API_BASE || "http://localhost:3001").replace(/\/$/, "");
const DEFAULT_COMMUNITY_BASE = (import.meta.env.VITE_DEFAULT_COMMUNITY_BASE || "").replace(/\/$/, "");
let runtimeAuthBase = "";

function normalizeBase(base) {
  return (base || "").trim().replace(/\/$/, "");
}

async function request(base, path, { token, method = "GET", body, formData } = {}) {
  const normalizedBase = normalizeBase(base);
  if (!normalizedBase) {
    throw new Error("Community server URL is required");
  }

  const headers = {};
  let requestBody;

  if (formData) {
    requestBody = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${normalizedBase}${path}`, {
    method,
    headers,
    body: requestBody
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }

  return payload;
}

export function apiAuth(path, options = {}) {
  return request(runtimeAuthBase || AUTH_BASE, path, options);
}

export function apiCommunity(base, path, options = {}) {
  return request(base, path, options);
}

export function toAbsoluteUrl(url, base) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${normalizeBase(base || AUTH_BASE)}${url}`;
}

export function getAuthBase() {
  return runtimeAuthBase || AUTH_BASE;
}

export function getConfiguredAuthBase() {
  return AUTH_BASE;
}

export function setAuthBase(base) {
  runtimeAuthBase = normalizeBase(base);
}

export function getDefaultCommunityBase() {
  return DEFAULT_COMMUNITY_BASE;
}

export function sanitizeCommunityBase(value) {
  return normalizeBase(value);
}
