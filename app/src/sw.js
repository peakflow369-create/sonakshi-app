/* Sonakshi service worker: Web Push + notification taps. No caching on purpose,
   so a new build is always picked up. Browser only (the Android app uses local notifications). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Server sends: { id, seq, title, body, category }  (full text is fetched by the page, payloads are size-limited)
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : "" }; }

  event.waitUntil((async () => {
    await self.registration.showNotification(d.title || "Sonakshi", {
      body: d.body || "",
      icon: "assets/icon-192.png",
      badge: "assets/icon-192.png",
      tag: d.id ? `sk-${d.id}` : "sonakshi",          // same tag as the page uses, so no duplicates
      data: { id: d.id, url: "./?feed=1" },
    });
    // if a window is open, tell it to pull the full item
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: "sync" }));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) { w.postMessage({ type: "open-feed" }); return w.focus(); }
    }
    return self.clients.openWindow((event.notification.data && event.notification.data.url) || "./?feed=1");
  })());
});
