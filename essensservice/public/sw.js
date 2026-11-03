// Service Worker: Push-Nachrichten anzeigen und beim Antippen die richtige Seite öffnen.
// Bewusst ohne Offline-Cache, damit nie veraltete Bestell- oder Lieferdaten angezeigt werden.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Agrarlohn Essensservice", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Agrarlohn Essensservice";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "essen",
      renotify: true,
      data: { url: data.url || "/" },
    }),
  );
});

// Die persönliche Seite meldet ihre Adresse hierher. Sie bleibt nur auf diesem Gerät gespeichert
// (der Server kennt das Token nicht im Klartext und kann es nicht in die Nachricht schreiben).
const META = "essen-meta";
self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type === "home" && typeof d.url === "string" && d.url.startsWith("/")) {
    event.waitUntil(caches.open(META).then((c) => c.put("/__home", new Response(d.url))));
  }
});

async function homeUrl() {
  try {
    const r = await (await caches.open(META)).match("/__home");
    if (r) return await r.text();
  } catch {}
  return "/";
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const path = event.notification.data?.url && event.notification.data.url !== "/" ? event.notification.data.url : await homeUrl();
      const url = new URL(path, self.location.origin).href;
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (w.url.startsWith(url) && "focus" in w) {
          w.navigate?.(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
