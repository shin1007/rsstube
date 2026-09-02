'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useNeighbours } from '@/lib/trail';

/**
 * 画面の下に据える「前の記事 / 次の記事」。
 *
 * **本文の末尾ではなく、画面の下に据える。**末尾に置いていたときは、長い記事だと
 * そこへ辿り着くのが仕事になっていた（読み終える前に次へ行きたいときには、
 * 無いのと同じだった）。
 *
 * `fixed` にはしない。プレイヤーが出ているときは body の padding が全体を
 * 持ち上げてくれるので（Playback.tsx）、流れの中に置くだけでプレイヤーの上に乗る。
 * fixed にすると自分で避ける必要が出る。
 *
 * 行き先が無い側も**押せる**ままにして、押したら「もうありません」と出す。
 * 以前は押せない見た目の span を置いていたが、スマホでは hover が無いので
 * 「淡い文字」と「押せない」が結び付かず、**押しても何も起きない**にしか
 * 見えなかった（そして端まで来たことも分からない）。場所は空けたままにする
 * ——端に来たときにボタンの位置がずれると、隣を押してしまう。
 *
 * client なのは**来た道を見るため**（lib/trail.ts）。未読ビューでは読んだ記事が
 * 一覧から抜けるので、サーバーが出す「前」は来た道と違う記事になる。
 * ← → キーとスワイプも同じものを見ているので、3つの行き先は必ず一致する。
 */

/** 「もうありません」を出しておく長さ。読み切れて、次の操作の邪魔にならない程度。 */
const NOTICE_MS = 2500;

export function ArticleNav({
  articleId,
  prevHref: serverPrev,
  nextHref: serverNext,
  remaining,
}: {
  articleId: string;
  prevHref?: string;
  nextHref?: string;
  /**
   * この記事より後ろに残っている件数。**「まだ続くのか」を出すため。**
   * 分からないときは undefined（0 とは違う。0 は「ここで終わり」）。
   */
  remaining?: number;
}) {
  const { prevHref, nextHref } = useNeighbours(articleId, serverPrev, serverNext);
  /**
   * どの記事で出した知らせなのかも一緒に持つ。
   *
   * 記事が変われば端かどうかも変わるので、持ち越さずに消す必要がある。
   * ただし effect で消しにいくと描画がもう1回増えるので、**表示のときに
   * 突き合わせて捨てる**（記事が変わった時点で下の text は null になる）。
   */
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const text = notice && notice.id === articleId ? notice.text : null;

  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  /**
   * 残りの件数。**「次の記事」の隣に添える。**
   *
   * 押す前に「まだ続くのか、もう終わりか」が分かる場所はここしかない
   * ——一覧に戻れば件数は出ているが、それを見るために戻るなら意味がない。
   * 0 のときは出さない（そのときは次のボタン自体が押せなくなっている）。
   */
  const rest =
    typeof remaining === 'number' && remaining > 0 ? (
      <span className="ml-1.5 text-zinc-600">あと{remaining}</span>
    ) : null;

  /**
   * **ホームバーのぶんは「バーの土台」として見せる。**
   *
   * 以前はボタンの padding を 0.5rem ＋ ホームバーぶん にしていた。当たり判定は
   * 正しく下端まであるのだが、**文字は上に寄ったままで、その下に40px近い
   * 何も無い帯ができる**——押せないように見えるし、iPhone はいちばん下の数十pxを
   * ホームバーの操作に使うので、実際そこを叩いても反応しないことがある。
   *
   * ボタンの中身は 44px の枠に入れて上下中央に置き、ホームバーぶんはその下に
   * 素の padding として残す。iOS のタブバーと同じ組み方で、下の帯は
   * 「バーの下端」に見える（空白ではなく地の色）。nav に色を敷くのはそのため
   * ——透明のままだと、そこだけ本文の背景が覗いて「余った隙間」に見える。
   */
  const cell = 'flex min-h-11 flex-1 items-center justify-center text-center';
  const pad = { paddingBottom: 'env(safe-area-inset-bottom)' };

  return (
    // order-3 はスマホ用。上から 本文 → 操作の帯 → ここ の順にする。
    <nav className="relative order-3 flex shrink-0 items-stretch border-t border-zinc-800 bg-zinc-900/50 text-xs md:order-none md:bg-transparent">
      {/*
        端に来たことを伝える。押しても何も起きないのと、端であることは別物。

        **画面の真ん中に出す。** ボタンのすぐ上に出していたときは、押した指が
        そのまま覆いかぶさる位置で、しかも画面の下端は目が向いていない場所
        だった（読んでいるのは上）。真ん中なら、目を動かさずに気づける。
        `fixed` なのは、この nav が画面の下に固定された細い帯だから
        ——その中に absolute で置くと、真ん中に出しようがない。
        `pointer-events-none` で、出ている間も下のボタンを押せるままにする。
      */}
      {text && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-0 z-30 grid place-items-center p-6"
        >
          <span className="rounded-lg border border-zinc-700 bg-zinc-800/95 px-4 py-3 text-center text-sm shadow-xl">
            {text}
          </span>
        </div>
      )}

      {prevHref ? (
        <Link
          href={prevHref}
          style={pad}
          className={`${cell} text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100`}
        >
          ← 前の記事
        </Link>
      ) : (
        <button
          type="button"
          style={pad}
          onClick={() => setNotice({ id: articleId, text: 'これが最初の記事です' })}
          className={`${cell} text-zinc-700`}
        >
          ← 前の記事
        </button>
      )}

      <span aria-hidden className="w-px bg-zinc-800" />

      {nextHref ? (
        <Link
          href={nextHref}
          style={pad}
          className={`${cell} text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100`}
        >
          次の記事 →{rest}
        </Link>
      ) : (
        <button
          type="button"
          style={pad}
          onClick={() => setNotice({ id: articleId, text: '次の記事はありません（これが最後です）' })}
          className={`${cell} text-zinc-700`}
        >
          次の記事 →
        </button>
      )}
    </nav>
  );
}
