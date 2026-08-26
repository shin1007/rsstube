import pg from 'pg';
import { connectionString } from './scripts/db-connect.mjs';
const c = new pg.Client({ connectionString: connectionString(), ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`
  insert into jobs (type, payload)
  select 'extract', jsonb_build_object('article_id', a.id)
    from articles a join subscriptions s on s.feed_id=a.feed_id
   where a.content_html ~ 'src="/[^"]'
     and not exists (select 1 from jobs j where j.type='extract' and j.status in ('queued','running')
                       and (j.payload->>'article_id')::uuid = a.id)
  returning 1`);
console.log('取り直しを積んだ記事:', r.rowCount);
await c.end();
