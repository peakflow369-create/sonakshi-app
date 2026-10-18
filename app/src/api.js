import { CFG } from "./config.js";

// Backend root. Falls back to API_URL minus "/ask" so existing config.js files keep working.
export const BASE = (CFG.API_BASE ?? CFG.API_URL.replace(/\/ask\/?$/, "")).replace(/\/+$/, "");

export const api = (path, init = {}) =>
  fetch(BASE + path, { ...init, headers: { "X-Sonakshi-Key": CFG.API_KEY, ...(init.headers || {}) } });
