/**
 * 待っているあいだに出す枠。**飾りではなく、起動を速くするための部品。**
 *
 * どのページも `force-dynamic` で、ページ全体を1つの `async` 関数で書くと、
 * **問い合わせが全部終わるまで `<head>` が1バイトも出ない**——ブラウザは
 * そこまで CSS も JS も落とし始められない（docs/traps/perf.md）。
 * ページ本体を `<Suspense>` に入れ、その fallback をここに置くと、
 * `<head>` と枠が先に出て、サーバーを待つ時間とファイルの取得が重なる。
 *
 * **中身は「まだ何も無い」と分かる形にすること。** 実在する値と同じ見た目に
 * すると、読む人は必ず意味を探す（docs/traps/ui.md）。ここに出るのは灰色の
 * 帯だけで、数字も記事名もタブの文字も出さない——押せない文字が出ていると、
 * 反応しないアプリに見える。
 *
 * **幅と高さは実物に合わせる。** ずれていると、中身が届いた瞬間に画面が跳ねる。
 */

/** 灰色の帯1本。`animate-pulse` は Tailwind の既定。 */
export function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-zinc-800/70 ${className}`} />;
}

/** サイドバー（PCのみ）。`Sidebar` と同じ `md:w-60`。 */
function SidebarSkeleton() {
  return (
    <nav className="hidden md:flex md:w-60 md:shrink-0 flex-col border-r border-zinc-800 min-h-0">
      <div className="shrink-0 p-3 border-b border-zinc-800 font-bold text-zinc-100">RSSTube</div>
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
  );
}

/** 下部タブ（スマホのみ）の場所取り。文字は出さない。 */
function TabsSkeleton() {
  return (
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
  );
}

/** 二次画面（聴く・書き出し・アーカイブ・設定）の外枠。`AppShell` と同じ形。 */
export function AppShellSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex min-h-0 overflow-hidden" aria-busy="true" aria-label="読み込み中">
      <SidebarSkeleton />
      {children}
      <TabsSkeleton />
    </div>
  );
}

/**
 * 二次画面の本文側。行の高さだけ違うので `lines` で渡す。
 *
 * 見出しの帯を1本置いてあるのは、実物のどのページも「← 一覧／見出し／脇のリンク」で
 * 始まるため。ここが無いと、届いた瞬間に一段ぶん下へずれる。
 */
export function PageSkeleton({ rows = 6, tall = false }: { rows?: number; tall?: boolean }) {
  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-4 pb-24">
        <div className="flex items-center gap-3">
          <Bar className="h-4 w-14" />
          <Bar className="h-6 w-24" />
          <Bar className="ml-auto h-3 w-16" />
        </div>
        <Bar className="h-3 w-full" />
        <Bar className="h-3 w-4/5" />
        <div className="space-y-3 pt-2">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 p-3">
              <Bar className="h-4 w-3/4" />
              <Bar className="mt-2 h-3 w-1/2" />
              {tall && <Bar className="mt-2 h-3 w-2/3" />}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

/** リーダー（`/`）。一覧と、PCでは本文側の空きまで。 */
export function ReaderSkeleton() {
  return (
    <div className="flex-1 flex min-h-0 overflow-hidden" aria-busy="true" aria-label="読み込み中">
      <SidebarSkeleton />

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

      <TabsSkeleton />
    </div>
  );
}

/** 再生画面（`/watch/:id`）。外枠を持たない単独ページなので別に持つ。 */
export function WatchSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="読み込み中">
      <header className="flex items-center gap-3 border-b border-zinc-800 p-3">
        <Bar className="h-4 w-14" />
        <Bar className="h-4 w-1/2" />
      </header>
      <div className="flex-1 min-h-0 p-4">
        {/* スライドの場所。実物は 16:9。 */}
        <Bar className="aspect-video w-full" />
        <Bar className="mt-4 h-2 w-full" />
        <div className="mt-4 flex items-center justify-center gap-4">
          <Bar className="h-10 w-10 rounded-full" />
          <Bar className="h-12 w-12 rounded-full" />
          <Bar className="h-10 w-10 rounded-full" />
        </div>
      </div>
    </div>
  );
}
