/* Notifications, one API for two worlds:
 *  - Android app (Capacitor): @capacitor/local-notifications. The WebView has no Notification API / Web Push.
 *  - Browser / installed PWA: service worker showNotification + (optional) Web Push through the backend. */
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { api } from "./api.js";

export const isNative = Capacitor.isNativePlatform();

const PREF = "sonakshi.notif.pref";          // "on" | "off": the in-app switch (browsers can't revoke permission from JS)
const CHANNEL = "sonakshi-feed";
let swReg = null;

export const isIOSBrowser = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone && !matchMedia("(display-mode: standalone)").matches;

export const supported = () => isNative || ("Notification" in window && "serviceWorker" in navigator);

/* ───────── service worker (browser only) ───────── */
export async function registerSW() {
  if (isNative || !("serviceWorker" in navigator)) return null;
  try {
    await navigator.serviceWorker.register("sw.js");
    swReg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 5000))]);
  } catch { swReg = null; }
  return swReg;
}

/** Hooks for taps on a notification and for "pull the full item" messages from the service worker. */
export function listen({ onOpen, onSync }) {
  if (isNative) {
    LocalNotifications.addListener("localNotificationActionPerformed", () => onOpen?.());
  } else if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "open-feed") onOpen?.();
      if (e.data?.type === "sync") onSync?.();
    });
  }
}

/* ───────── permission ───────── */
export async function permission() {          // "granted" | "denied" | "default" | "unsupported"
  if (isNative) {
    const { display } = await LocalNotifications.checkPermissions();
    return display === "granted" ? "granted" : display === "denied" ? "denied" : "default";
  }
  return "Notification" in window ? Notification.permission : "unsupported";
}

export async function request() {             // must be called from a tap/click in browsers
  if (isNative) {
    const { display } = await LocalNotifications.requestPermissions();
    if (display === "granted") await ensureChannel();
    return display === "granted" ? "granted" : "denied";
  }
  if (!("Notification" in window)) return "unsupported";
  return Notification.requestPermission();
}

export const setPref = (on) => localStorage.setItem(PREF, on ? "on" : "off");
export const enabled = async () => (await permission()) === "granted" && localStorage.getItem(PREF) !== "off";

/* ───────── show ───────── */
async function ensureChannel() {
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL, name: "Sonakshi updates", description: "Morning briefing, daily verse and alerts", importance: 4, visibility: 1,
    });
  } catch { /* channels only exist on Android 8+ */ }
}

const snippet = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 180);
const nid = (it) => (Number(it.seq) || Math.floor(Math.random() * 1e9)) % 2147483647;

/** Show a native/system notification for a feed item. Resolves false if notifications are off. */
export async function show(item) {
  if (!(await enabled())) return false;
  const body = snippet(item.text);
  if (isNative) {
    await ensureChannel();
    await LocalNotifications.schedule({
      notifications: [{ id: nid(item), title: item.title, body, channelId: CHANNEL, extra: { id: item.id } }],
    });
    return true;
  }
  const opts = {
    body, icon: "assets/icon-192.png", badge: "assets/icon-192.png",
    tag: `sk-${item.id}`, data: { id: item.id, url: "./?feed=1" },
  };
  try {
    if (swReg) await swReg.showNotification(item.title, opts);
    else new Notification(item.title, opts);   // desktop fallback when no service worker
    return true;
  } catch { return false; }
}

/* ───────── Web Push (browser only; needs VAPID keys on the backend) ───────── */
const b64 = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
};
const json = { "Content-Type": "application/json" };

export async function subscribePush() {
  if (isNative || !swReg || !("PushManager" in window)) return false;
  try {
    const k = await api("/api/push/key");
    if (!k.ok) return false;                    // backend has no VAPID keys: in-page notifications still work
    const key = b64((await k.json()).publicKey);
    let sub = await swReg.pushManager.getSubscription();
    if (!sub) {
      try { sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
      catch { await (await swReg.pushManager.getSubscription())?.unsubscribe(); sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
    }
    return (await api("/api/push/subscribe", { method: "POST", headers: json, body: JSON.stringify(sub) })).ok;
  } catch { return false; }
}

export async function unsubscribePush() {
  if (isNative || !swReg) return;
  try {
    const sub = await swReg.pushManager.getSubscription();
    if (!sub) return;
    await api("/api/push/unsubscribe", { method: "POST", headers: json, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  } catch { /* offline: the server drops dead endpoints on its own */ }
}
