const U = process.env.NEXT_PUBLIC_SUPABASE_URL, S = process.env.SUPABASE_SECRET_KEY, P = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const EMAIL = 'ui-probe@example.com', PW = 'Probe-Passw0rd!';
const admin = (p, i = {}) => fetch(U + p, { ...i, headers: { apikey: S, authorization: 'Bearer ' + S, 'content-type': 'application/json', ...(i.headers || {}) } });
const l = await (await admin('/auth/v1/admin/users')).json();
for (const u of l.users ?? []) if (u.email === EMAIL) await admin('/auth/v1/admin/users/' + u.id, { method: 'DELETE' });
const u = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PW, email_confirm: true }) })).json();
const sess = await (await fetch(U + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: P, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json();

// 既存フィードのうち何本かを購読して、現実に近いサイドバーにする
const feeds = await (await admin('/rest/v1/feeds?select=url,title&limit=8')).json();
const asUser = (p, b) => fetch(U + p, { method: 'POST', headers: { apikey: P, authorization: 'Bearer ' + sess.access_token, 'content-type': 'application/json' }, body: JSON.stringify(b) });
for (const f of feeds) {
  const r = await asUser('/rest/v1/rpc/subscribe_feed', { feed_url: f.url, feed_title: f.title ?? '' });
  if (!r.ok) console.log('購読失敗', f.title, r.status, (await r.text()).slice(0, 100));
}
const ref = new URL(U).hostname.split('.')[0];
console.log(JSON.stringify({ id: u.id, cookie: `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(sess)).toString('base64url')}` }));
