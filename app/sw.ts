import { defaultCache } from "@serwist/next/worker";
import { initializeApp, getApps } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";
import { firebasePublicConfig } from "./lib/firebase-public-config";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();

/** FCM: show system notifications when a push has only `data` (foreground routing still uses client). */
try {
  const fbApp =
    getApps().length === 0 ? initializeApp(firebasePublicConfig) : getApps()[0]!;
  const messaging = getMessaging(fbApp);
  onBackgroundMessage(messaging, (payload) => {
    if (payload.notification?.title) return;
    const title =
      (typeof payload.data?.title === "string" && payload.data.title) || "Roommates";
    const body = (typeof payload.data?.body === "string" && payload.data.body) || "";
    const url =
      (typeof payload.data?.click_action === "string" && payload.data.click_action) || "/dashboard";
    void self.registration.showNotification(title, {
      body: body || undefined,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
    });
  });
} catch (err) {
  console.warn("[roommates sw] FCM init skipped:", err);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data as { url?: string } | undefined)?.url || "/dashboard";
  const fullUrl = raw.startsWith("http") ? raw : new URL(raw, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin)) {
          const wc = client as WindowClient;
          await wc.focus();
          if (typeof wc.navigate === "function") await wc.navigate(fullUrl);
          return;
        }
      }
      await self.clients.openWindow(fullUrl);
    })
  );
});
