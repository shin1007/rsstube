/**
 * サイドバーが届くまでの枠。
 *
 * **中身のふりをさせない。** 灰色の短冊を並べて「フィードが並んでいる」ように
 * 見せると、読める状態になったのかどうかが分からなくなる（押しても何も
 * 起きない偽の行になる）。ここでは**幅と枠線だけ**を先に置いて、
 * レイアウトが後からずれないようにする——出したいのは「ここに何か来る」
 * ではなく「画面はもう始まっている」ということ。
 *
 * 幅・枠線・`hidden md:flex` は `Sidebar` と揃えること。ずれると、中身が
 * 届いた瞬間に横幅が飛ぶ。
 */
export function SidebarFallback() {
  return (
    <nav
      aria-hidden
      className="hidden md:flex md:w-60 md:shrink-0 flex-col border-r border-zinc-800 min-h-0"
    >
      <div className="shrink-0 p-3 border-b border-zinc-800">
        <span className="font-bold text-zinc-100">RSSTube</span>
      </div>
    </nav>
  );
}
