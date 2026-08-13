/**
 * サービスワーカー。
 *
 * 意図的に「ほとんど何もキャッシュしない」形にしてある。記事一覧も本文も
 * ログイン済みの動的なページで、しかも既読・スターの状態が刻々と変わるので、
 * HTML や API の応答を握ると「昨日の未読一覧」を見せる事故になる。
 *
 * ここでやるのは2つだけ:
 *   1. 画面遷移が通信できなかったときに offline.html を出す
 *      （ついでに、これがインストール要件の fetch ハンドラを兼ねる）
 *   2. ダイジェスト完成の Web Push を受けて通知を出す
 *
 * 中身を変えたら CACHE の版を上げること。古い版は activate で消える。
 */

const CACHE = 'rsstube-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL])),
  );
  // 新しい版をすぐ有効にする。個人用なので、複数タブでの版ズレより
  // 「直したものがすぐ反映される」ほうが大事。
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // 画面遷移だけ面倒を見る。API も静的ファイルも素通しにする。
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached ?? new Response('オフラインです', { status: 503 });
    }),
  );
});

/**
 * ダイジェストができたときの通知。
 * payload は { title, body, url } の JSON（lib/push/send.ts が組み立てる）。
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // 想定外の形式で来ても通知そのものは出す。黙って消えるほうが困る。
  }

  const title = data.title || 'RSSTube';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '新しいダイジェストができました',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // 同じタグの通知は積み重ならず置き換わる。朝の通知が溜まらないように。
      tag: data.tag || 'rsstube-digest',
      data: { url: data.url || '/exports' },
    }),
  );
});

/** 通知をタップしたら、既に開いているタブがあればそれを使う。 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/exports';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
