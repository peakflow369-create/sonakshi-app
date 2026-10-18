/* "Sonakshi Updates & Feed": store, drawer UI, live stream from the backend, notification switch. */
import { api } from "./api.js";
import * as N from "./notify.js";

const $ = (id) => document.getElementById(id);
const STORE = "sonakshi.feed.v1";
const SEQ_KEY = "sonakshi.feed.seq";
const ASKED = "sonakshi.notif.asked";
const MAX = 200;

const svg = (d) => `<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  speaker: svg('<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
};

/* Category → label, icon, filter group and colours. Class names are written out in full so Tailwind keeps them. */
const CATS = {
  bible_verse:      { label: "Bible verse",      icon: "📖", group: "verse",  rail: "border-bloom", text: "text-bloom" },
  morning_briefing: { label: "Morning briefing", icon: "📰", group: "news",   rail: "border-arc",   text: "text-arc" },
  news:             { label: "News",             icon: "📰", group: "news",   rail: "border-arc",   text: "text-arc" },
  notification:     { label: "Notification",     icon: "🔔", group: "alerts", rail: "border-ember", text: "text-ember" },
};
const ALIAS = {
  verse: "bible_verse", bible: "bible_verse", daily_verse: "bible_verse", verse_of_the_day: "bible_verse",
  briefing: "morning_briefing", news_briefing: "news", top_news: "news", headlines: "news",
  system: "notification", alert: "notification", alerts: "notification", assistant: "notification", reminder: "notification",
};
const cat = (c) => {
  const k = String(c || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  return CATS[ALIAS[k] || k] || CATS.notification;
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (ts) => new Date(ts).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function dayLabel(ts) {
  const now = Date.now();
  if (sameDay(ts, now)) return "Today";
  if (sameDay(ts, now - 864e5)) return "Yesterday";
  return new Date(ts).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
const spoken = (t) => t.replace(/\p{Extended_Pictographic}/gu, "").replace(/[*_#>`~]/g, "").replace(/\s+/g, " ").trim();

/* ───────── state ───────── */
let items = load();
let lastSeq = Number(localStorage.getItem(SEQ_KEY)) || 0;
let filter = "all";
let drawerOpen = false, opener = null;
let newIds = new Set();          // unread when the drawer was opened: keep their dot until it closes
const expanded = new Set();
let speakingId = null;
let opts = {};                   // { speak, stop, canStop } supplied by app.js

function load() {
  try { const a = JSON.parse(localStorage.getItem(STORE)); return Array.isArray(a) ? a : []; } catch { return []; }
}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(items.slice(0, MAX))); } catch { /* storage full */ } };

function norm(r) {
  const ts = Date.parse(r.timestamp);
  return {
    id: String(r.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
    seq: Number.isFinite(Number(r.seq)) ? Number(r.seq) : 0,
    title: String(r.title || "Sonakshi").slice(0, 160),
    text: String(r.text || ""),
    category: String(r.category || "notification"),
    ts: Number.isNaN(ts) ? (Number(r.ts) || Date.now()) : ts,
    read: !!r.read,
  };
}

/* ───────── ingest ───────── */
let rafPending = false;
const scheduleRender = () => { if (!rafPending) { rafPending = true; requestAnimationFrame(render); } };

/** Add items to the feed. live=true means it just arrived, so it may raise a system notification. */
function ingest(raws, { live = false } = {}) {
  const fresh = [];
  for (const r of raws) {
    const it = norm(r);
    if (it.seq > lastSeq) lastSeq = it.seq;
    if (items.some((x) => x.id === it.id)) continue;
    if (drawerOpen) { it.read = true; newIds.add(it.id); }
    items.push(it); fresh.push(r);
  }
  localStorage.setItem(SEQ_KEY, String(lastSeq));
  if (!fresh.length) return;
  items.sort((a, b) => b.ts - a.ts);
  items = items.slice(0, MAX);
  save(); updateBadge(); scheduleRender();
  if (live) {
    $("fab").classList.remove("pulse"); void $("fab").offsetWidth; $("fab").classList.add("pulse");
    if (!(drawerOpen && document.visibilityState === "visible")) fresh.forEach((r) => N.show(r).catch(() => {}));
  }
}

/* ───────── render ───────── */
function cardHTML(it) {
  const c = cat(it.category), open = expanded.has(it.id), isNew = newIds.has(it.id);
  const label = speakingId === it.id ? (opts.canStop ? "Stop" : "Reading…") : "Read aloud";
  return `<article class="border-l-2 ${c.rail} py-3 pl-3" data-id="${esc(it.id)}">
    <div class="flex items-center gap-2 text-xs">
      <span class="${c.text}"><span aria-hidden="true">${c.icon}</span> ${c.label}</span>
      ${isNew ? '<span class="new-dot" role="img" aria-label="New"></span>' : ""}
      <time class="ml-auto text-haze/70" datetime="${new Date(it.ts).toISOString()}">${fmtTime(it.ts)}</time>
    </div>
    <h4 class="mt-1 font-semibold text-ink">${esc(it.title)}</h4>
    <p class="feed-text mt-1 whitespace-pre-line text-sm leading-relaxed text-ink/80 ${open ? "" : "line-clamp-6"}">${esc(it.text)}</p>
    <button class="mt-1 text-xs text-arc" type="button" data-act="more" ${open ? "" : "hidden"}>${open ? "Show less" : "Show more"}</button>
    <div class="mt-2 flex flex-wrap gap-2">
      <button class="chip-btn" type="button" data-act="speak" ${speakingId === it.id && !opts.canStop ? "disabled" : ""}>${ICON.speaker}<span>${label}</span></button>
      <button class="chip-btn" type="button" data-act="copy">${ICON.copy}<span>Copy</span></button>
    </div>
  </article>`;
}

function render() {
  rafPending = false;
  const list = $("feed-list"), top = list.scrollTop;
  const shown = items.filter((i) => filter === "all" || cat(i.category).group === filter);

  $("drawer-sub").textContent = newIds.size ? `${newIds.size} new` : items.length ? "You're up to date" : "Nothing yet";

  if (!shown.length) {
    list.innerHTML = items.length
      ? `<p class="py-10 text-center text-sm text-haze/80">Nothing in this filter yet.</p>`
      : `<div class="py-10 text-center"><p class="font-semibold text-ink">No updates yet</p>
         <p class="mx-auto mt-1 max-w-[16rem] text-sm text-haze/80">Your morning briefing, daily verse and alerts from Sonakshi will show up here.</p></div>`;
    return;
  }
  let html = "", day = "";
  for (const it of shown) {
    const d = dayLabel(it.ts);
    if (d !== day) { html += `<h3 class="sticky top-0 z-[1] bg-panel/95 pb-1 pt-3 text-sm text-haze/80">${d}</h3>`; day = d; }
    html += cardHTML(it);
  }
  list.innerHTML = html;
  list.scrollTop = top;
  measure();
}

/** Show "Show more" only for entries that actually overflow the 6-line clamp. */
function measure() {
  $("feed-list").querySelectorAll("article").forEach((a) => {
    const p = a.querySelector(".feed-text"), more = a.querySelector('[data-act="more"]');
    if (!p || !more) return;
    more.hidden = !expanded.has(a.dataset.id) && p.scrollHeight <= p.clientHeight + 1;
  });
}

function updateBadge() {
  const n = items.filter((i) => !i.read).length;
  document.querySelectorAll(".unread-badge").forEach((b) => { b.hidden = n === 0; b.textContent = n > 99 ? "99+" : String(n); });
  const label = n ? `Open updates feed, ${n} unread` : "Open updates feed";
  $("open-feed").setAttribute("aria-label", label); $("fab").setAttribute("aria-label", label);
}

/* ───────── drawer ───────── */
function openDrawer() {
  if (drawerOpen) return;
  drawerOpen = true; opener = document.activeElement;
  newIds = new Set(items.filter((i) => !i.read).map((i) => i.id));
  items.forEach((i) => { i.read = true; });
  save(); updateBadge(); render();
  $("drawer").inert = false;
  $("drawer").dataset.open = "true"; $("scrim").dataset.open = "true";
  $("open-feed").setAttribute("aria-expanded", "true");
  $("drawer-close").focus({ preventScroll: true });
  refreshNotifUI();
}

function closeDrawer() {
  if (!drawerOpen) return;
  drawerOpen = false; newIds = new Set();
  $("drawer").dataset.open = "false"; $("scrim").dataset.open = "false";
  $("drawer").inert = true;
  $("open-feed").setAttribute("aria-expanded", "false");
  opener?.focus?.({ preventScroll: true });
  render();
}

/* ───────── card actions ───────── */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } finally { ta.remove(); }
  }
}

async function onCopy(btn, it) {
  const span = btn.querySelector("span");
  await copyText(`${it.title}\n\n${it.text}`);
  span.textContent = "Copied";
  setTimeout(() => { span.textContent = "Copy"; }, 1500);
}

async function onSpeak(btn, it) {
  const span = btn.querySelector("span");
  if (speakingId && opts.canStop) { const same = speakingId === it.id; opts.stop(); if (same) return; }
  else if (speakingId) return;                       // native TTS can't be interrupted
  speakingId = it.id;
  span.textContent = opts.canStop ? "Stop" : "Reading…"; btn.disabled = !opts.canStop;
  try { await opts.speak(spoken(`${it.title}. ${it.text}`)); }
  finally {
    if (speakingId === it.id) speakingId = null;
    span.textContent = "Read aloud"; btn.disabled = false;
  }
}

function toggleMore(id) { expanded.has(id) ? expanded.delete(id) : expanded.add(id); render(); }

/* ───────── notification switch + first-run prompt ───────── */
async function refreshNotifUI() {
  const perm = await N.permission(), on = await N.enabled(), sup = N.supported();
  const sw = $("notif-switch");
  sw.setAttribute("aria-checked", String(on));
  sw.disabled = !sup || perm === "denied";
  $("test-btn").hidden = !on;
  $("notif-hint").textContent = !sup
    ? (N.isIOSBrowser() ? "On iPhone, add Sonakshi to your Home Screen first, then turn this on." : "This browser can't show notifications.")
    : perm === "denied" ? "Blocked. Allow notifications for this site in your browser settings."
    : on ? "On. New updates arrive as notifications." : "Off. Turn on to get updates as notifications.";
}

async function setNotifications(on) {
  if (on) {
    if ((await N.request()) === "granted") { N.setPref(true); await N.subscribePush(); }
  } else {
    N.setPref(false); await N.unsubscribePush();
  }
  refreshNotifUI();
}

async function maybePrompt() {
  const d = $("notif-modal");
  if (!N.supported() || localStorage.getItem(ASKED) || typeof d.showModal !== "function") return;
  if ((await N.permission()) !== "default") return;
  setTimeout(() => { if (!d.open) { localStorage.setItem(ASKED, "1"); d.showModal(); } }, 2500);
}

/* ───────── live stream (SSE over fetch so the key stays in a header) ───────── */
const CONN = {
  connecting: ["Connecting…", "bg-haze/50"],
  live:       ["Live. New updates appear instantly.", "bg-arc"],
  retry:      ["Can't reach Sonakshi. Retrying…", "bg-ember"],
  paused:     ["Paused. Syncs when you reopen the app.", "bg-haze/50"],
  auth:       ["Rejected by the server. Check API_KEY in config.js.", "bg-ember"],
};
function setConn(k) {
  $("conn-text").textContent = CONN[k][0];
  $("conn-dot").className = `h-2 w-2 shrink-0 rounded-full ${CONN[k][1]}`;
}

let ctrl = null, retry = 0, retryTimer = 0, wanted = false;

function handleBlock(block) {
  let ev = "message", data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) ev = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return;
  try { ingest([JSON.parse(data)], { live: ev === "item" }); } catch { /* ignore malformed event */ }
}

async function connect() {
  const mine = new AbortController();
  ctrl = mine; setConn("connecting");
  try {
    const r = await api(`/api/stream?after=${lastSeq}`, { signal: mine.signal });
    if (r.status === 401 || r.status === 403) { ctrl = null; wanted = false; setConn("auth"); return; }
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    retry = 0; setConn("live");
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) { handleBlock(buf.slice(0, i)); buf = buf.slice(i + 2); }
    }
  } catch { /* aborted or offline: fall through to the retry logic */ }
  if (ctrl !== mine) return;                 // stopped or replaced on purpose
  ctrl = null;
  if (!wanted) return;
  setConn("retry");
  retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
}

function start() { wanted = true; if (!ctrl) { clearTimeout(retryTimer); retry = 0; connect(); } }
function stop() {
  wanted = false; clearTimeout(retryTimer);
  const c = ctrl; ctrl = null; c?.abort();
  setConn("paused");
}

/** Pull anything newer than what we have (used when the service worker says a push arrived). */
async function sync() {
  try {
    const r = await api(`/api/feed?after=${lastSeq}`);
    if (r.ok) ingest((await r.json()).items || []);
  } catch { /* offline */ }
}

/* ───────── wiring ───────── */
export function initFeed(o) {
  opts = o;

  $("open-feed").addEventListener("click", openDrawer);
  $("fab").addEventListener("click", openDrawer);
  $("drawer-close").addEventListener("click", closeDrawer);
  $("scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawerOpen) closeDrawer(); });

  // swipe right to dismiss
  let sx = 0, sy = 0;
  $("drawer").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $("drawer").addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    if (t.clientX - sx > 80 && Math.abs(t.clientY - sy) < 50) closeDrawer();
  }, { passive: true });

  $("filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]"); if (!b) return;
    filter = b.dataset.filter;
    $("filters").querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });

  $("feed-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const it = items.find((x) => x.id === btn.closest("article")?.dataset.id); if (!it) return;
    ({ speak: () => onSpeak(btn, it), copy: () => onCopy(btn, it), more: () => toggleMore(it.id) })[btn.dataset.act]?.();
  });

  let clearTimer = 0;
  $("clear-btn").addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (!clearTimer) {                         // two taps so a stray touch can't wipe the feed
      b.textContent = "Tap again to clear";
      clearTimer = setTimeout(() => { b.textContent = "Clear feed"; clearTimer = 0; }, 3000);
      return;
    }
    clearTimeout(clearTimer); clearTimer = 0; b.textContent = "Clear feed";
    items = []; expanded.clear(); newIds.clear(); save(); updateBadge(); render();
  });

  $("notif-switch").addEventListener("click", async () => setNotifications(!(await N.enabled())));
  $("test-btn").addEventListener("click", () => {
    const t = { id: `test-${Date.now()}`, title: "Test from Sonakshi", category: "notification", timestamp: new Date().toISOString(),
      text: "Notifications are working. Your morning briefing and daily verse will arrive like this." };
    ingest([t]); N.show(t);
  });
  $("notif-yes").addEventListener("click", async () => { $("notif-modal").close(); await setNotifications(true); });
  $("notif-no").addEventListener("click", () => $("notif-modal").close());

  N.listen({ onOpen: openDrawer, onSync: sync });
  N.registerSW().then(async () => { if (await N.enabled()) N.subscribePush(); });

  document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? start() : stop()));
  addEventListener("online", () => { if (document.visibilityState === "visible") start(); });

  render(); updateBadge(); refreshNotifUI(); maybePrompt();
  if (document.visibilityState === "visible") start(); else setConn("paused");

  if (new URLSearchParams(location.search).has("feed")) { history.replaceState(null, "", location.pathname); openDrawer(); }

  return { open: openDrawer, close: closeDrawer, setActive: (a) => (a ? start() : stop()), sync };
}
