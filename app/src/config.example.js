// Copy to config.js (gitignored). Never commit real keys.
export const CFG = {
  API_URL: "https://YOUR-BACKEND.example.com/ask",
  API_KEY: "same-value-as-SONAKSHI_KEY-on-backend",   // client key: ask + read feed. It is NOT the notify key.
  IDLE_MS: 8000,        // silence window before sleep

  // Optional. Defaults to API_URL without the trailing "/ask".
  // Use "" when the FastAPI backend serves this web build itself (same origin).
  // API_BASE: "https://YOUR-BACKEND.example.com",
};
