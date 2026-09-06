/**
 * 一覧が出るまでのあいだ、枠だけを先に見せる。
 *
 * **これはただの飾りではなく、起動を速くするための部品。** `/` は
 * `force-dynamic` で、以前はページ本体が DB を待ってから初めて HTML を
 * 1バイト目から流していた。実測（本番・東京）で `</head>` が届くのが 472ms
 * ——**そこまで CSS も JS も1バイトも落とし始められない**。ホーム画面から
 * 起動したときの「真っ暗な数秒」がこれ。
 *
 * ページ本体を `<Suspense>` に入れて、その fallback をここに置くと、React は
 * `<head>` とこの枠だけを先に流せる。ブラウザは DB を待っているあいだに
 * CSS と JS を落とし始められる（＝直列だったものが並列になる）。
 *
 * **中身は「まだ何も無い」と分かる形にすること。** 実在する値と同じ見た目に
 * すると、読む人は必ず意味を探す（docs/traps/ui.md）。ここに出るのは
 * 灰色の帯だけで、数字も記事名もタブの文字も出さない。
 */
export function ReaderSkeleton() {
  return (
    <div
      className="flex-1 flex min-h-0 overflow-hidden"
      aria-busy="true"
      aria-label="読み込み中"
    >
      {/* サイドバー（PCのみ）。実物と同じ幅にしておかないと、
          中身が届いた瞬間に一覧が横へ飛ぶ。 */}
      <nav className="hidden md:flex md:w-60 md:shrink-0 flex-col border-r border-zinc-800 min-h-0">
        <div className="shrink-0 p-3 border-b border-zinc-800 font-bold text-zinc-100">
          RSSTube
        </div>
        <div className="p-2 space-y-1.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Bar key={i} className="h-4 w-2/3" />
          ))}
        </div>
        <div className="border-t border-zinc-800 p-2 space-y-1.5">
          {Array.from({ length: 8 }, (_, i) => (
            <Bar key={i} className="h-3.5 w-11/12" />
          ))}
        </div>
      </nav>

      {/* 一覧。スマホではこれが画面いっぱいになる。 */}
      <div className="w-full md:w-96 md:shrink-0 border-r border-zinc-800 flex flex-col min-h-0">
        <div className="shrink-0 border-b border-zinc-800 p-3">
          <div className="flex items-center gap-2">
            <Bar className="h-5 w-24" />
            <Bar className="h-4 w-16" />
          </div>
          <div className="mt-2">
            <Bar className="h-8 w-full" />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="border-b border-zinc-900 px-3 py-2.5">
              <Bar className="h-4 w-11/12" />
              <Bar className="mt-1.5 h-4 w-3/5" />
              <Bar className="mt-2 h-3 w-2/5" />
            </div>
          ))}
        </div>
      </div>

      {/* 本文の側（PCのみ）。スマホでは記事を開くまで出ないので何も置かない。 */}
      <div className="hidden md:block flex-1 min-w-0" />

      {/* 下部タブの場所取り。文字は出さない——押せない文字を出すと、
          反応しないアプリに見える。 */}
      <div
        aria-hidden
        className="md:hidden fixed inset-x-0 bottom-0 z-10 flex border-t border-zinc-800 bg-zinc-950"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex min-h-12 flex-1 items-center justify-center">
            <Bar className="h-3 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 灰色の帯1本。`animate-pulse` は Tailwind の既定にある。 */
function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-zinc-800/70 ${className}`} />;
}
