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
 *   node --env-file=.env.local scripts/reextract-thin.mjs --framed          # 枠を掴んでいる記事を探す
 *   node --env-file=.env.local scripts/reextract-thin.mjs --framed --run
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
const FRAMED = process.argv.includes('--framed');

/**
 * 枠を掴んでいる記事の見つけ方（--framed）。
 *
 * 薄いかどうかでは見つからない種類の壊れ方がある。Readability が本文ではなく
 * **ページの枠を掴む**と、グローバルメニューのぶんだけ長さがあるので
 * `THIN_CHARS` に引っかからず、`content_ok` も true のまま残る。
 * 実例は厚労省の記者会見の案内（本文250字に対して2006字のメニューが保存されていた）。
 *
 * 見分け方は「同じフィードの記事が全部同じ文字で始まっている」こと。
 * メニューは記事ごとに変わらないので、先頭が長く一致する。実データでは
 * NHK の501件が `ニュース 新着・注目 社会 政治 …` から始まっていた。
 *
 * **一致するだけでは決めない。** ダイヤモンドの連載は定型のリード文で始まるので
 * 同じ形に見えるが、中身は本物（実データで約90件）。積んでしまうと、同じ要約を
 * もう一度作るために Gemini の無料枠だけが減る。なので組ごとに1本だけ
 * 実際に取り直してみて、**結果が変わるものだけ**積む。
 */
const PREFIX_CHARS = 60;
const MIN_GROUP = 3;

/** 取り直しの判定に使うアプリ。check:url と同じ窓口（/api/debug/extract）を通す。 */
const BASE = process.env.CHECK_URL_BASE ?? 'http://localhost:3000';

const client = new pg.Client({ connectionString: connectionString(), ssl: { rejectUnauthorized: false } });
await client.connect();

const owner = process.env.OWNER_USER_ID;
if (!owner) throw new Error('OWNER_USER_ID がありません（jobs は user_id を要求する）');

/**
 * 既に順番待ちのジョブがある記事は外す。jobs の一意索引は部分索引なので、
 * ぶつかると insert が丸ごと落ちる（requestSummaries と同じ理由）。
 */
const NO_PENDING_JOB = `not exists (
          select 1 from jobs j
           where j.status in ('queued', 'running')
             and j.payload ->> 'article_id' = a.id::text
        )`;

const targets = FRAMED ? await framedTargets() : await thinTargets();

/** 本文が短い記事。「本体は別にある」型（PDF・別ページ）を拾う。 */
async function thinTargets() {
  return (
    await client.query(
      `select a.id, a.url, f.title as feed, length(a.content_text) as len
         from articles a
         join feeds f on f.id = a.feed_id
        where a.extracted_at is not null
          and (a.content_ok = false or coalesce(length(a.content_text), 0) < $1)
          and ($3::boolean or not (f.title = any($4::text[])))
          and ${NO_PENDING_JOB}
        order by a.published_at desc nulls last
        limit $2`,
      [THIN_CHARS, LIMIT, ALL, HOPELESS],
    )
  ).rows;
}

/**
 * 枠を掴んでいる記事。長さがあるので thinTargets には出てこない。
 *
 * 先頭が長く一致する組を作り、**組ごとに1本だけ取り直して確かめてから**積む。
 * 確かめずに積むと、定型のリード文で始まる連載（本物）まで巻き込む。
 */
async function framedTargets() {
  const groups = (
    await client.query(
      `with head as (
         select a.id, a.url, a.feed_id, f.title as feed, a.published_at,
                -- 空白の詰め方は /api/debug/extract の preview に合わせる。
                -- SQL に渡す文字列なので、テンプレートリテラルの中では  を重ねて書く。
                left(btrim(regexp_replace(a.content_text, '\\s+', ' ', 'g')), $1) as prefix
           from articles a
           join feeds f on f.id = a.feed_id
          where a.content_ok
            and length(a.content_text) >= $2
            and ${NO_PENDING_JOB}
       )
       select feed, prefix, count(*)::int as n,
              (array_agg(url order by published_at desc nulls last))[1] as sample_url,
              array_agg(id order by published_at desc nulls last) as ids
         from head
        group by feed_id, feed, prefix
       having count(*) >= $3
        order by count(*) desc`,
      [PREFIX_CHARS, THIN_CHARS, MIN_GROUP],
    )
  ).rows;

  if (groups.length === 0) return [];
  console.log(`先頭が一致する組: ${groups.length}件。1本ずつ取り直して確かめます（${BASE}）。
`);

  const rows = [];
  for (const g of groups) {
    const now = await reextract(g.sample_url);
    // 取れなかったときは判断できない。触らない（次に巡回が拾う）。
    if (now === null) {
      console.log(`  ?  ${g.n}件  ${g.feed}  取り直せませんでした`);
      continue;
    }
    // いま取り直すと違うものが返る＝保存されているのは古い掴み方の結果。
    const changed = now.trim().slice(0, PREFIX_CHARS) !== g.prefix.slice(0, PREFIX_CHARS);
    console.log(`  ${changed ? "×" : "○"}  ${g.n}件  ${g.feed}  ${g.prefix.slice(0, 34)}…`);
    if (!changed) continue;
    console.log(`        いまなら: ${now.slice(0, 34)}…`);
    for (const id of g.ids) rows.push({ id, feed: g.feed, url: g.sample_url, len: null });
  }
  console.log("");
  return rows.slice(0, LIMIT);
}

/** いまのコードで取り直したら何が返るか。保存はしない（check:url と同じ窓口）。 */
async function reextract(url) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET がありません（--env-file=.env.local を付けてください）');
  try {
    const res = await fetch(`${BASE}/api/debug/extract?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    // 抽出に失敗したときも「変わった」とは言えない（RSS の抜粋に落ちるだけ）。
    return body.ok ? body.preview : null;
  } catch {
    return null;
  }
}

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
