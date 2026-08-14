import { readFileSync } from 'node:fs';
import { connect } from './db-connect.mjs';
import { TABLES } from './db-tables.mjs';

/**
 * db:backup が作った JSON を戻す。
 *
 *   npm run db:restore -- backups/2026-08-12T11-00-00.json
 *
 * 先に npm run db:migrate でスキーマを作っておくこと（スキーマは JSON に無い）。
 *
 * 既にある行は on conflict do nothing で飛ばす。つまり「消えたものを埋め戻す」
 * 用であって、「今の状態を捨てて戻す」用ではない。まるごと戻したいときは
 * --replace を付ける（外部キーの逆順で消してから入れる）。
 */

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const file = args.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('使い方: npm run db:restore -- backups/<ファイル名>.json [--replace]');
  process.exit(1);
}

const dump = JSON.parse(readFileSync(file, 'utf8'));
console.log(`${file}（取得日時 ${dump.takenAt}）`);
if (replace) console.log('--replace: 既存の行を消してから入れ直します。');
console.log('');

const client = await connect();

try {
  await client.query('begin');

  if (replace) {
    // 外部キーの逆順で消す。
    for (const table of [...TABLES].reverse()) {
      const { rowCount } = await client.query(`delete from ${table}`);
      console.log(`  ${table}: ${rowCount}行を削除`);
    }
    console.log('');
  }

  for (const table of TABLES) {
    const rows = dump.tables[table] ?? [];
    if (rows.length === 0) {
      console.log(`  ${table}: 0行`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    const columnList = columns.map((c) => `"${c}"`).join(', ');
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `insert into ${table} (${columnList}) values (${placeholders}) on conflict do nothing`;

    /*
     * jsonb の列だけは、値を JSON の文字列にしてから渡す。
     *
     * jsonb に配列が入っていると（summaries.bullets や media.script がそう）、
     * 取り出したときは JS の配列になる。それをそのままパラメータに渡すと、
     * pg は「Postgres の配列」として {a,b} の形に直してしまい、
     * invalid input syntax for type json で落ちる。
     *
     * text[] の列（summaries.tags）も JS の配列で来るが、そちらは配列のままで正しい。
     * つまり値の形だけでは区別できないので、列の型を DB に聞く。
     */
    const { rows: types } = await client.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = $1 and data_type in ('json', 'jsonb')`,
      [table],
    );
    const jsonColumns = new Set(types.map((t) => t.column_name));

    let inserted = 0;
    for (const row of rows) {
      const { rowCount } = await client.query(
        sql,
        columns.map((c) => {
          const value = row[c];
          if (value === null || value === undefined) return null;
          return jsonColumns.has(c) ? JSON.stringify(value) : value;
        }),
      );
      inserted += rowCount;
    }
    console.log(`  ${table}: ${inserted}行を挿入（${rows.length}行中）`);
  }

  await client.query('commit');
  console.log('');
  console.log('戻し終えました。');
} catch (err) {
  await client.query('rollback').catch(() => {});
  console.error(`失敗したので何も変更していません: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
