import { AppShell } from '@/components/AppShell';
import { ExportList, type ExportSummary } from '@/components/ExportList';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

/**
 * 書き出しの履歴。毎朝のダイジェストもここに並ぶ。
 *
 * NotebookLM に渡すのは人の手なので、「作ってあるものをすぐ取り出せる場所」が要る。
 * 書き出した瞬間のダイアログを閉じてしまっても、ここから開き直せる。
 */

export const dynamic = 'force-dynamic';

/** 一覧に出す件数。溜まっても遡って使うのは直近だけ。 */
const LIMIT = 50;

export default async function ExportsPage() {
  const supabase = await createClient();

  const [{ data }, { data: digests }] = await Promise.all([
    supabase
      .from('exports')
      .select('id, kind, title, created_at, article_ids')
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    // 朝のぶんは音声にもできる。どの書き出しがダイジェストなのかを引き当てる。
    supabase.from('digests').select('id, export_id'),
  ]);

  const digestByExport = new Map(
    (digests ?? []).map((d) => [d.export_id as string, d.id as string]),
  );

  const exports: ExportSummary[] = (
    (data ?? []) as { id: string; kind: 'manual' | 'digest'; title: string; created_at: string; article_ids: string[] }[]
  ).map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    created_at: e.created_at,
    article_count: e.article_ids?.length ?? 0,
    digest_id: digestByExport.get(e.id) ?? null,
  }));

  return (
    <AppShell>
      <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-4 pb-24">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-zinc-400">
            ← 一覧
          </Link>
          <h1 className="text-xl font-bold">書き出し</h1>
          {/* スマホには下部タブしか無いので、二次画面どうしを相互に張っておく。 */}
          <Link href="/library" className="ml-auto text-xs text-zinc-500 hover:text-zinc-200">
            アーカイブ
          </Link>
          <Link href="/settings" className="text-xs text-zinc-500 hover:text-zinc-200">
            設定
          </Link>
        </div>

        <p className="text-xs text-zinc-500">
          毎朝のダイジェストは設定した時刻に自動で作られます（設定 → 生成時刻）。
          前日24時間ぶんの未読から、重要度の高いものをフォルダが偏らないように選びます。
        </p>

          <ExportList exports={exports} />
        </div>
      </main>
    </AppShell>
  );
}
