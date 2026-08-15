import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { connectionString } from './db-connect.mjs';

/**
 * できあがったもの（音声・書き出し）を `samples/` に取り出す。
 *
 * アプリを開かずに中身を確かめたいときのため。音声はブラウザでも
 * ファイラーからでも再生でき、台本は横に .txt で置くので
 * 「何を喋っているか」を目で追える。
 *
 * **`samples/` は .gitignore 済み。** 理由は2つ:
 *   - ダイジェストの Markdown には他サイトの記事本文が丸ごと入る。
 *     公開リポジトリに置くと再配布になる
 *   - 音声も書き出しも DB と Storage から何度でも作り直せる
 *
 * 音声は MP3 を単純に連結している。セグメントごとに独立した MP3 なので、
 * 繋げただけで通しで再生できる（再エンコードは要らない）。
 *
 *   node --env-file=.env.local scripts/export-samples.mjs
 */

const OUT = 'samples';
mkdirSync(OUT, { recursive: true });

const client = new pg.Client({
  connectionString: connectionString(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

/** Windows で使えない文字を落とす。長すぎるタイトルも切る。 */
const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

// ---- 音声 ----
const media = await client.query(
  `select id, title, duration_sec from media where status = 'ready' order by created_at`,
);

for (const m of media.rows) {
  const segments = await client.query(
    `select idx, slide_idx, speaker, audio_path, duration_sec, text
       from media_segments where media_id = $1 order by idx`,
    [m.id],
  );

  const parts = [];
  for (const s of segments.rows) {
    const { data, error } = await supabase.storage.from('media').download(s.audio_path);
    if (error) {
      console.log(`  取得できず #${s.idx}: ${error.message}`);
      continue;
    }
    parts.push(Buffer.from(await data.arrayBuffer()));
  }
  if (parts.length === 0) continue;

  const base = `${OUT}/音声_${safeName(m.title)}`;
  const audio = Buffer.concat(parts);
  writeFileSync(`${base}.mp3`, audio);
  writeFileSync(
    `${base}.txt`,
    `${m.title}\n（${m.duration_sec}秒 / ${segments.rowCount}セグメント）\n\n` +
      segments.rows.map((s) => `[${s.speaker || '話者'}] ${s.text}`).join('\n\n') +
      '\n',
  );
  console.log(`音声: ${base}.mp3  ${(audio.length / 1024).toFixed(0)}KB`);
}

// ---- 書き出し（NotebookLM に渡す Markdown） ----
const exports_ = await client.query(
  `select title, markdown, prompt from exports order by created_at`,
);

for (const e of exports_.rows) {
  const name = `${OUT}/書き出し_${safeName(e.title)}.md`;
  // 指示文も一緒に置く。NotebookLM ではこれを本文と別に貼るので、
  // 何を渡したのかが分かるようにコメントで頭に付けておく。
  const body = e.prompt ? `<!-- NotebookLM への指示文 -->\n${e.prompt}\n\n---\n\n${e.markdown}` : e.markdown;
  writeFileSync(name, body);
  console.log(`書き出し: ${name}  ${(e.markdown.length / 1024).toFixed(0)}KB`);
}

await client.end();
console.log(`\n${OUT}/ に出しました。git には入りません（.gitignore 済み）。`);
