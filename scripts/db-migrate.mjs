import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from './db-connect.mjs';

/**
 * supabase/migrations/ の SQL を番号順にリモートDBへ流す。
 *
 * supabase db query は複数文のファイルを扱えない（プリペアドステートメントとして
 * 送るので "cannot insert multiple commands" になる）。node-postgres に
 * パラメータ無しの文字列を渡すと simple query protocol になり、複数文をまとめて
 * 1往復で流せる。
 *
 * supabase db push を使わないのは、あちらが <timestamp>_name.sql という命名を
 * 前提にしていて 0001_ 形式と噛み合わないため。
 *
 * 適用済みは schema_migrations に記録するので、二度流しても飛ばされる。
 */

const DIR = 'supabase/migrations';

const client = await connect();
let failed = false;

try {
  await client.query(`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await client.query('select version from schema_migrations');
  const applied = new Set(rows.map((r) => r.version));

  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`── ${file}  (適用済み・飛ばす)`);
      continue;
    }

    console.log(`── ${file}`);
    const sql = readFileSync(join(DIR, file), 'utf8');

    // 1ファイル1トランザクション。途中で落ちたら中途半端に残さない。
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations (version) values ($1)', [file]);
      await client.query('commit');
      console.log('   OK');
      ran++;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      console.error(`   失敗: ${err.message}`);
      if (err.hint) console.error(`   ヒント: ${err.hint}`);
      // 順番に依存しているので、落ちたらそこで止める。
      failed = true;
      break;
    }
  }

  if (!failed) {
    console.log('');
    console.log(ran === 0 ? '適用するものはありませんでした。' : `${ran}件を適用しました。`);
  }
} finally {
  await client.end().catch(() => {});
}

if (failed) {
  console.error('');
  console.error('途中で止まりました。適用済みのぶんは記録してあるので、直して流し直せば続きから走ります。');
  process.exit(1);
}
