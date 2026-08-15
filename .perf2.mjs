const U = process.env.NEXT_PUBLIC_SUPABASE_URL, S = process.env.SUPABASE_SECRET_KEY, P = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const EMAIL = 'perf-probe@example.com', PW = 'Probe-Passw0rd!';
const admin = (p, i = {}) => fetch(U + p, { ...i, headers: { apikey: S, authorization: 'Bearer ' + S, 'content-type': 'application/json', ...(i.headers || {}) } });

const l = await (await admin('/auth/v1/admin/users')).json();
for (const u of l.users ?? []) if (u.email === EMAIL) await admin('/auth/v1/admin/users/' + u.id, { method: 'DELETE' });
const u = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PW, email_confirm: true }) })).json();
const sess = await (await fetch(U + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: P, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PW }) })).json();
const ref = new URL(U).hostname.split('.')[0];
const jar = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(sess)).toString('base64url')}`;

// 認証まわりの素の往復を測る
const timeIt = async (label, fn, n = 7) => {
  await fn();
  const t = [];
  for (let i = 0; i < n; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s); }
  t.sort((a, b) => a - b);
  console.log(`${label.padEnd(46)} 中央値 ${t[Math.floor(n/2)].toFixed(0)}ms`);
};

await timeIt('Supabase /auth/v1/user（proxy が毎回やる検証）', () =>
  fetch(U + '/auth/v1/user', { headers: { apikey: P, authorization: 'Bearer ' + sess.access_token } }).then(r => r.text()));

const base = process.env.BASE ?? 'https://rsstube.vercel.app';
for (const p of ['/', '/settings', '/listen', '/exports']) {
  await timeIt(`${base.includes('localhost') ? '手元' : '本番'} ${p}`, () =>
    fetch(base + p, { headers: { cookie: jar } }).then(r => r.text()), 5);
}
console.log('削除:', (await admin('/auth/v1/admin/users/' + u.id, { method: 'DELETE' })).status);
