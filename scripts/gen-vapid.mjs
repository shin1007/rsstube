/**
 * Web Push の VAPID 鍵を作る。
 *
 *   npm run vapid
 *
 * 出てきた3行を .env.local に貼る（本番は Vercel の環境変数にも同じものを入れる）。
 * 鍵を作り直すと、既に登録済みの端末には二度と届かなくなる（購読は公開鍵に
 * 紐づいているため）。作り直したら push_subscriptions を空にして登録し直すこと。
 */

import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
# Web Push（npm run vapid で生成）。公開鍵はブラウザの購読時に要るので NEXT_PUBLIC_。
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
# 送信元の連絡先。push サービスが問題のあるときに使う。mailto: か https: で。
VAPID_SUBJECT=mailto:you@example.com
`);
