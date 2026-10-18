import { CFG } from "./config.js";

// Backend root. Falls back to API_URL or directly uses the Render backend URL.
export const BASE = (CFG?.API_BASE ?? CFG?.API_URL ?? "https://sonakshi-feed-router.onrender.com").replace(/\/ask\/?$/, "").replace(/\/+$/, "");

export const api = (path, init = {}) =>
  fetch(BASE + path, { 
    ...init, 
    headers: { 
      "X-Sonakshi-Key": CFG?.API_KEY || "", 
      ...(init.headers || {}) 
    } 
  });
