/// <reference lib="webworker" />
declare let self: ServiceWorkerGlobalScope;

import { precacheAndRoute } from 'workbox-precaching';

// @ts-ignore: __WB_MANIFEST is injected by vite-plugin-pwa
precacheAndRoute(self.__WB_MANIFEST || []);

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload: {
    title?: string;
    body?: string;
    icon?: string;
    url?: string;
    category?: string;
    targetTab?: string;
  } = {};

  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: 'PHANTOMS — الإدارة',
      body: event.data.text(),
      url: '/portal',
    };
  }

  const title = payload.title || 'PHANTOMS — إشعار جديد';
  const body = payload.body || 'وصلك تحديث جديد على بوابة الفريق';
  const targetUrl = payload.url || '/portal';
  const tag = `wasla-push-${Date.now()}`;

  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body,
    icon: payload.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag,
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    vibrate: [200, 100, 200, 100, 220],
    data: {
      url: targetUrl,
      category: payload.category || 'announcement',
      targetTab: payload.targetTab || 'ALL',
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({
            type: 'WASLA_PUSH_RECEIVED',
            payload: {
              id: tag,
              title,
              body,
              url: targetUrl,
              category: payload.category || 'announcement',
              targetTab: payload.targetTab || 'ALL',
            },
          });
        }
      }),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || '/portal';
  const urlToOpen = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.postMessage({
            type: 'WASLA_NOTIFICATION_CLICKED',
            payload: event.notification.data || {},
          });
          return client.focus();
        }
      }
      return self.clients.openWindow(urlToOpen);
    }),
  );
});
