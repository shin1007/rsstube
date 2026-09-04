/**
 * サービスワーカー。
 *
 * 意図的に「ほとんど何もキャッシュしない」形にしてある。記事一覧も本文も
 * ログイン済みの動的なページで、しかも既読・スターの状態が刻々と変わるので、
 * HTML や API の応答を握ると「昨日の未読一覧」を見せる事故になる。
 *
 * ここでやるのは3つだけ:
 *   1. 画面遷移が通信できなかったときに offline.html を出す
 *      （ついでに、これがインストール要件の fetch ハンドラを兼ねる）
 *   2. ホーム画面からの起動を速くする（navigationPreload と、
 *      内容が変わらない静的ファイルのキャッシュ）
 *   3. ダイジェスト完成の Web Push を受けて通知を出す
 *
 * 中身を変えたら CACHE の版を上げること。古い版は activate で消える。
 */

const CACHE = 'rsstube-shell-v3';
/**
 * `/_next/static/` の中身だけを入れる置き場。
 *
 * **URL に build id とハッシュが入っていて、中身が変われば URL も変わる**ので、
 * 古いものを返してしまう事故が起きない（HTML と違ってここは握ってよい）。
 * 版を分けているのは、上の CACHE を上げるたびに JS ごと捨てると、
 * sw.js を1行直しただけで次の起動が遅くなるため。溜まったぶんは
 * 掃除する（下の sweep）。
 */
const STATIC = 'rsstube-static-v1';
/** 静的キャッシュに置く数の上限。デプロイのたびに古い build id が積み上がる。 */
const STATIC_MAX = 120;
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
    (async () => {
      /**
       * **画面遷移の取得を、このワーカーの起動と同時に始めさせる。**
       *
       * fetch ハンドラを1つでも持っていると、ホーム画面からの起動は
       * 「ワーカーを起こす → ハンドラが fetch() を呼ぶ」の順になり、
       * 起こすぶん（スマホでは数百ms）まるごと待ってから通信が始まる。
       * ここが遅さの正体で、しかも**サービスワーカーを入れたことで遅くなる**
       * という方向の遅さなので、コードを見ても原因に見えない。
       * navigationPreload を有効にすると、ブラウザが起動と並行して
       * 要求を出しておいてくれる（下の fetch で preloadResponse を使う）。
       */
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE && k !== STATIC).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/** 古い build id のぶんを捨てる。入れた順に消えるので、いま使うものは残る。 */
async function sweep(cache) {
  const keys = await cache.keys();
  if (keys.length <= STATIC_MAX) return;
  await Promise.all(keys.slice(0, keys.length - STATIC_MAX).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  /**
   * ビルド済みの JS と CSS はキャッシュから返す。
   *
   * 起動のたびに落としていたのは、ここが一番大きい（記事の中身より重い）。
   * HTTP のキャッシュがあるじゃないかと思うところだが、**iOS は容量が要ると
   * 黙って捨てる**ので、ホーム画面から久しぶりに開いた朝ほど遅くなる。
   * URL にハッシュが入っているので、古いものを返す心配は無い。
   */
  if (request.method === 'GET' && new URL(request.url).pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) {
          await cache.put(request, res.clone());
          event.waitUntil(sweep(cache));
        }
        return res;
      })(),
    );
    return;
  }

  // 残りは画面遷移だけ面倒を見る。API も素通しにする。
  if (request.mode !== 'navigate') return;

  event.respondWith(
    (async () => {
      try {
        // ブラウザが先に始めておいてくれた要求があれば、それを使う。
        const preloaded = await event.preloadResponse;
        return preloaded || (await fetch(request));
      } catch {
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? new Response('オフラインです', { status: 503 });
      }
    })(),
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
