/**
 * SERVICE WORKER PETTY CASH PRO PWA
 * Menangani Background Sync, Periodic Sync (08:00 & 20:00), Push Event, dan OS Notification
 */
const CONFIG_CACHE = 'pettycash-bg-config-v1';
const SHOWN_CACHE = 'pettycash-shown-notifs-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Menerima konfigurasi sesi user & URL GAS dari halaman utama
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SYNC_CONFIG') {
    event.waitUntil(saveBgConfig(event.data.payload));
  } else if (event.data && event.data.type === 'SHOW_LOCAL_NOTIF') {
    const p = event.data.payload || {};
    event.waitUntil(
      self.registration.showNotification(p.title || 'Petty Cash Pro', {
        body: p.body || '',
        tag: p.tag || ('local-' + Date.now()),
        renotify: true,
        vibrate: [200, 100, 200]
      })
    );
  }
});

function getScopedCacheUrl(path) {
  return new URL(path, self.registration.scope).href;
}

async function saveBgConfig(cfg) {
  const cache = await caches.open(CONFIG_CACHE);
  await cache.put(getScopedCacheUrl('bg-config.json'), new Response(JSON.stringify(cfg || {})));
}

async function readBgConfig() {
  try {
    const cache = await caches.open(CONFIG_CACHE);
    const res = await cache.match(getScopedCacheUrl('bg-config.json'));
    if (!res) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function pollNotificationsInBackground() {
  const cfg = await readBgConfig();
  if (!cfg || !cfg.apiUrl || !cfg.userId) return;

  try {
    const response = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'get_notifications',
        userId: cfg.userId,
        role: cfg.role || '',
        divisi: cfg.mode || ''
      })
    });
    const json = await response.json();
    if (!json || json.status !== 'success' || !json.data) return;

    const list = json.data.notifications || [];
    const shownCache = await caches.open(SHOWN_CACHE);

    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (item.is_read) continue;
      if (cfg.mode && item.divisi && item.divisi !== cfg.mode) continue;
      const key = getScopedCacheUrl('shown/' + encodeURIComponent(item.id_notif));
      const alreadyShown = await shownCache.match(key);
      if (!alreadyShown) {
        await shownCache.put(key, new Response('1'));
        await self.registration.showNotification((item.divisi ? '[' + item.divisi + '] ' : '') + item.title, {
          body: item.body,
          tag: item.id_notif,
          renotify: true,
          vibrate: [200, 100, 200],
          data: { url: cfg.appUrl || './' }
        });
      }
    }
  } catch (err) {}
}

// Background Sync & Periodic Background Sync (jalan meski aplikasi ditutup)
self.addEventListener('sync', (event) => {
  if (event.tag === 'pettycash-bg-sync') {
    event.waitUntil(pollNotificationsInBackground());
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'pettycash-bg-sync') {
    event.waitUntil(pollNotificationsInBackground());
  }
});

// Web Push Event
self.addEventListener('push', (event) => {
  let payload = { title: 'Petty Cash Pro', body: 'Ada pembaruan saldo atau transaksi baru.' };
  if (event.data) {
    try {
      payload = Object.assign(payload, event.data.json());
    } catch (e) {
      payload.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: 'push-' + Date.now(),
      renotify: true,
      vibrate: [200, 100, 200]
    })
  );
});

// Buka aplikasi saat notifikasi di HP di-tap
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
