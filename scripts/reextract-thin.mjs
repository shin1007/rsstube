import pg from 'pg';
import { connectionString } from './db-connect.mjs';

/**
 * 「本体が別にある」記事を、もう一度取り直させる。
 *
 * PDFや別ページを本体として読めるようにしたのは取り込みの経路なので、
 * **これから入る記事には何もしなくても効く**。効かないのは既にある記事で、
 * `extracted_at` が入っているものは二度と取りに行かない作りになっている（0028）。
 * 厚労省だけで50件近くが、フッターや「言語切替」の案内を本文として持ったまま残る。
 *
 * ここでやるのは extract ジョブを積むところまで。取得も要約もワーカーがやる
 * （画面の「AI要約を生成する」と同じ経路）。**全記事は浚わない**——短いものだけ、
 * しかも手で走らせたときだけ。
 *
 *   node --env-file=.env.local scripts/reextract-thin.mjs            # 対象を数えるだけ
 *   node --env-file=.env.local scripts/reextract-thin.mjs --run      # 積む
 *   node --env-file=.env.local scripts/reextract-thin.mjs --run --limit 20
 *   node --env-file=.env.local scripts/reextract-thin.mjs --run --all       # 望みの薄いフィードも含める
 *
 * 積んだあとはワーカーが回るのを待つ（本番は pg_cron が5分おき）。
 * 要約は無料枠を使うので、まずは --limit を小さくして出来を確かめること。
 */

const RUN = process.argv.includes('--run');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 50;

/** ここを下回る本文は「入口ページを掴んでいる」疑い（extract.ts の FOLLOW_BELOW_CHARS と同じ）。 */
const THIN_CHARS = 600;

/**
 * 取り直しても何も変わらないフィード。
 *
 * 東洋経済はペイウォールで本文がHTMLに無く、Hacker News はリンク先が第三者のサイトで
 * 403 か JS 描画（`docs/site-compat.md`。どちらも「直せない」と分かっている）。
 * 実データでは対象100件のうち**53件がこの2つ**で、積めばそのぶん Gemini の
 * 無料枠だけが減る。`--all` を付けたときだけ含める。
 */
const HOPELESS = ['東洋経済オンライン', 'Hacker News'];
const ALL = process.argv.includes('--all');

const client = new pg.Client({ connectionString: connectionString(), ssl: { rejectUnauthorized: false } });
await client.connect();

const owner = process.env.OWNER_USER_ID;
if (!owner) throw new Error('OWNER_USER_ID がありません（jobs は user_id を要求する）');

/**
 * 既に順番待ちのジョブがある記事は外す。jobs の一意索引は部分索引なので、
 * ぶつかると insert が丸ごと落ちる（requestSummaries と同じ理由）。
 */
const targets = (
  await client.query(
    `select a.id, a.url, f.title as feed, length(a.content_text) as len
       from articles a
       join feeds f on f.id = a.feed_id
      where a.extracted_at is not null
        and (a.content_ok = false or coalesce(length(a.content_text), 0) < $1)
        and ($3::boolean or not (f.title = any($4::text[])))
        and not exists (
          select 1 from jobs j
           where j.status in ('queued', 'running')
             and j.payload ->> 'article_id' = a.id::text
        )
      order by a.published_at desc nulls last
      limit $2`,
    [THIN_CHARS, LIMIT, ALL, HOPELESS],
  )
).rows;

const byFeed = new Map();
for (const row of targets) byFeed.set(row.feed, (byFeed.get(row.feed) ?? 0) + 1);

console.log(`対象: ${targets.length}件（上限 ${LIMIT}）`);
for (const [feed, count] of [...byFeed].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}件  ${feed}`);
}

if (!RUN) {
  console.log('\n--run を付けると extract ジョブを積みます。');
  await client.end();
  process.exit(0);
}

for (const row of targets) {
  await client.query(
    `insert into jobs (user_id, type, payload) values ($1, 'extract', jsonb_build_object('article_id', $2::text))`,
    [owner, row.id],
  );
}

console.log(`\n${targets.length}件のジョブを積みました。ワーカーが取りに来るのを待ってください。`);
await client.end();
