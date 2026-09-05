const offlineCache = "hqbot-offline-v1";
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(offlineCache);
      await cache.add(new Request("/offline.html", { credentials: "omit" }));
      await self.skipWaiting();
    })()
  )
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("hqbot-offline-") && name !== offlineCache) await caches.delete(name);
      await self.clients.claim();
    })()
  )
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.mode !== "navigate" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request).catch(
      async () => (await caches.match("/offline.html")) || Response.error()
    )
  );
});
self.addEventListener("push", (event) =>
  event.waitUntil(
    (async () => {
      let value = {};
      try {
        value = event.data?.json() || {};
      } catch {
        /* Generic fallback only. */
      }
      const titles = {
        completed: "Your task is complete",
        reply: "A reply is ready",
        failed: "Work needs attention",
        input: "Your input is needed",
        approval: "An action needs your approval",
        test: "Notifications are working"
      };
      const id = typeof value.id === "string" ? value.id.slice(0, 250) : "hqbot-update";
      const botId = typeof value.botId === "string" ? value.botId.slice(0, 200) : "";
      await self.registration.showNotification("HQBot", {
        body: Object.hasOwn(titles, value.kind)
          ? titles[value.kind]
          : "A workspace update is ready",
        tag: id,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { path: botId ? `/?botId=${encodeURIComponent(botId)}` : "/?page=inbox" }
      });
    })()
  )
);
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const path = event.notification.data?.path;
      const url = new URL(
        typeof path === "string" && path.startsWith("/?") ? path : "/",
        self.location.origin
      );
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const current = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (current) {
        await current.navigate(url.href);
        await current.focus();
      } else await self.clients.openWindow(url.href);
    })()
  );
});
