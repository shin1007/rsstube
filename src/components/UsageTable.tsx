import type { UsageDay } from '@/lib/ai/usage';

/**
 * Gemini の使用量。設定画面に出す。
 *
 * 見たいのは「今日あと何回いけそうか」なので、日ごとの呼び出し回数を主にして、
 * トークンは補助として小さく出す。失敗が続いていれば上限に当たっている合図。
 */
export function UsageTable({ usage }: { usage: UsageDay[] }) {
  if (usage.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        まだ記録がありません。要約が走ると溜まります（記録は 0009 のマイグレーション以降のぶんだけです）。
      </p>
    );
  }

  // 同じ日に複数モデルが並ぶので、日でまとめて見せる。
  const byDay = new Map<string, UsageDay[]>();
  for (const row of usage) {
    if (!byDay.has(row.day)) byDay.set(row.day, []);
    byDay.get(row.day)!.push(row);
  }

  return (
    <div className="space-y-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="py-1 font-normal">日</th>
            <th className="py-1 font-normal">モデル</th>
            <th className="py-1 text-right font-normal">呼び出し</th>
            <th className="py-1 text-right font-normal">失敗</th>
            <th className="py-1 text-right font-normal">トークン(入/出)</th>
          </tr>
        </thead>
        <tbody>
          {[...byDay.entries()].map(([day, rows]) =>
            rows.map((r, i) => (
              <tr key={`${day}-${r.model}`} className="border-t border-zinc-900">
                <td className="py-1 text-zinc-400">{i === 0 ? formatDay(day) : ''}</td>
                <td className="py-1 text-zinc-500">{r.model}</td>
                <td className="py-1 text-right text-zinc-300">{r.calls}</td>
                <td className={`py-1 text-right ${r.failures > 0 ? 'text-amber-500' : 'text-zinc-600'}`}>
                  {r.failures}
                </td>
                <td className="py-1 text-right text-zinc-600">
                  {compact(r.inputTokens)} / {compact(r.outputTokens)}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>

      <p className="text-xs text-zinc-600">
        無料枠の上限はモデルごとの1日あたり回数（RPD）で決まります。失敗が並んでいるときは
        上限に当たっている可能性が高く、要約が遅れます。フィードを増やしたら
        ここが伸びていないか見てください。日付の区切りは日本時間なので、
        Google 側のリセット（太平洋時間）とは半日ほどずれます。
      </p>
    </div>
  );
}

function formatDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
