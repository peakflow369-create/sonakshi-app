const KEY = "sonakshi.theme";
const root = document.documentElement;
const subs = new Set();

export const currentTheme = () => (root.dataset.theme === "light" ? "light" : "dark");

function apply(t, save) {
  root.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#eef3f6" : "#04080d");
  document.getElementById("theme-toggle")?.setAttribute("aria-label", t === "light" ? "Switch to dark theme" : "Switch to light theme");
  if (save) localStorage.setItem(KEY, t);
  subs.forEach((f) => f(t));
}

/** Subscribe to theme changes; the callback also fires once immediately. */
export function onTheme(f) { subs.add(f); f(currentTheme()); }

export function initTheme() {
  apply(currentTheme(), false);   // index.html already set data-theme before first paint
  document.getElementById("theme-toggle")?.addEventListener("click", () => apply(currentTheme() === "light" ? "dark" : "light", true));
  // follow the OS until the user picks a theme themselves
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", (e) => {
    if (!localStorage.getItem(KEY)) apply(e.matches ? "light" : "dark", false);
  });
}
