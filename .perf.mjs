import pg from 'pg';
import { connectionString } from './scripts/db-connect.mjs';

const client = new pg.Client({ connectionString: connectionString(), ssl: { rejectUnauthorized: false } });
await client.connect();

const owner = (await client.query(`select id from auth.users order by created_at limit 1`)).rows[0].id;
console.log('owner:', owner.slice(0, 8));

const counts = await client.query(`
  select
    (select count(*) from articles) as 記事,
    (select count(*) from article_states where user_id = $1) as 状態,
    (select count(*) from summaries) as 要約,
    (select count(*) from feeds) as フィード,
    pg_size_pretty(pg_total_relation_size('articles')) as articles容量`, [owner]);
console.log(counts.rows[0]);

const queries = {
  '未読一覧(60件)': `
    select a.id, a.title, a.url, a.author, a.published_at, a.excerpt, a.content_ok, a.extracted_at
      from articles a
      join article_states s on s.article_id = a.id and s.user_id = $1
     where s.is_read = false
     order by a.published_at desc nulls last
     limit 60`,
  '未読件数の集計(現行: 5000行を取得)': `
    select a.feed_id from articles a
      join article_states s on s.article_id = a.id and s.user_id = $1
     where s.is_read = false limit 5000`,
  '未読件数の集計(SQLでcount)': `
    select a.feed_id, count(*) from articles a
      join article_states s on s.article_id = a.id and s.user_id = $1
     where s.is_read = false group by a.feed_id`,
  '重要度順': `
    select a.id from articles a
      join article_states s on s.article_id = a.id and s.user_id = $1
     where s.is_read = false
     order by a.importance desc nulls last, a.published_at desc nulls last
     limit 60`,
};

for (const [name, sql] of Object.entries(queries)) {
  await client.query(sql, [owner]); // 温める
  const t = [];
  for (let i = 0; i < 5; i++) {
    const s = performance.now();
    const r = await client.query(sql, [owner]);
    t.push(performance.now() - s);
    if (i === 0) var rows = r.rowCount;
  }
  t.sort((a, b) => a - b);
  console.log(`${name.padEnd(34)} 中央値 ${t[2].toFixed(1)}ms  (${rows}行)`);
}

console.log('\n--- 未読一覧の実行計画');
const plan = await client.query(`explain (analyze, buffers) ${queries['未読一覧(60件)']}`, [owner]);
for (const r of plan.rows) console.log('  ' + r['QUERY PLAN']);

await client.end();
