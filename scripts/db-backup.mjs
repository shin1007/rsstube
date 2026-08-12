import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from './db-connect.mjs';
import { TABLES } from './db-tables.mjs';

/**
 * データのバックアップ。
 *
 * Supabase の無料プランには自動バックアップも PITR も無い。
 * 記事と要約は消えても巡回し直せるが、購読一覧・フォルダ構成・スター・あとで・
 * NotebookLM への書き出し履歴は作り直しが効かない。
 *
 * スキーマは supabase/migrations/ が git にあるので取らない。
 * 再現できないのはデータだけなので、そこだけを JSON で落とす。
 * SQL の INSERT 文を組み立てないのは、jsonb・text[]・timestamptz の
 * リテラルを自前で正しく書くのが面倒で壊れやすいため。復元側は
 * パラメータ付きクエリで戻すので、引用符の心配が要らない。
 *
 * 戻し方: npm run db:restore -- backups/<ファイル名>
 */

const DIR = 'backups';
const KEEP = 10;

const client = await connect();

try {
  mkdirSync(DIR, { recursive: true });

  const dump = {
    takenAt: new Date().toISOString(),
    tables: {},
  };

  for (const table of TABLES) {
    const { rows } = await client.query(`select * from ${table}`);
    dump.tables[table] = rows;
    console.log(`  ${table}: ${rows.length}行`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = join(DIR, `${stamp}.json`);
  writeFileSync(path, JSON.stringify(dump, null, 2), 'utf8');

  const total = Object.values(dump.tables).reduce((n, rows) => n + rows.length, 0);
  console.log('');
  console.log(`保存しました: ${path}（${total}行, ${statSync(path).size}バイト）`);

  // 古い世代を増やし続けても意味が無いので、新しい方から KEEP 世代だけ残す。
  const old = readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(KEEP);

  if (old.length > 0) {
    console.log('');
    console.log('古い世代を削除:');
    for (const f of old) {
      unlinkSync(join(DIR, f));
      console.log(`  ${f}`);
    }
  }
} finally {
  await client.end().catch(() => {});
}
