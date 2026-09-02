'use client';

import { ActionFlash } from '@/components/ArticleActions';
import { HelpTip } from '@/components/HelpTip';
import { IMPORTANCE_HELP, importanceTier, importanceTitle } from '@/lib/importance';
import { UNEXPECTED_ERROR } from '@/lib/actions/result';
import {
  loadMoreArticles,
  markRead,
  requestSummaries,
  setReadLater,
  setReadMany,
  setStarred,
} from '@/app/actions/articles';
import { PAGE_SIZE, VIEW_LABELS, type ArticleRow, type View } from '@/lib/types';
import { prefetchFull } from '@/lib/prefetch';
import { useNeighbours } from '@/lib/trail';
import {
  readMarksServerSnapshot,
  readMarksSnapshot,
  rememberRead,
  subscribeReadMarks,
} from '@/lib/read-marks';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';

/**
 * 記事リスト。ここが「大量の記事を高速に捌く」中心。
 *
 * - 行にAIの要点と重要度を出し、開かずに判断できるようにする
 * - PC: j/k で移動、m 既読、s スター、l あとで、v 元記事、Shift+A 全既読、? でヘルプ
 * - スマホ: 左スワイプで既読、右スワイプであとで
 * - 下まで来たら続きを継ぎ足す（無限スクロール）
 */

/**
 * ヘルプに出す一覧。実際の処理は onKey 側にあるので、増やしたら両方直すこと。
 */
const SHORTCUTS: [string, string][] = [
  ['j / ↓', '一覧で次へ'],
  ['k / ↑', '一覧で前へ'],
  ['o / Enter', '開く'],
  ['→ / ←', '開いたまま次／前の記事へ'],
  ['Esc', '記事を閉じる'],
  ['m', '既読・未読'],
  ['s', 'スター'],
  ['l', 'あとで'],
  ['v', '元記事を新しいタブで開く'],
  ['Shift + A', '表示中をすべて既読'],
  ['/', '検索'],
  ['?', 'このヘルプ'],
];

/**
 * 一覧の下端に常設するぶん。
 *
 * **ヘルプ（?）は、あることを知らないと開かれない。**元の作りではショートカットが
 * 全部その中に畳まれていて、`?` を押す動機がそもそも生まれなかった。よく使う数個
 * だけを常に見えるところへ置き、残りは `?` に畳む。全部を下端に出すと、毎日見る
 * 画面の下端が読みものになる。
 */
const BAR: [string, string][] = [
  ['j/k', '移動'],
  ['o', '開く'],
  ['←/→', '前後'],
  ['m', '既読'],
  ['s', '★'],
  ['l', 'あとで'],
];

/**
 * 移動中に溜めておける押下の数。
 *
 * 連打はそのまま効かせたいが、際限なく溜めると行き過ぎたときに戻すのが大仕事に
 * なる（溜まったぶんは1件ずつ本当に開いていくので、既読も付く）。
 */
const MAX_QUEUED_MOVES = 10;

const EMPTY_STATE = {
  is_read: false,
  is_starred: false,
  read_later: false,
  exported_at: null as string | null,
};

type StatePatch = Partial<typeof EMPTY_STATE>;

/**
 * 「取得」に出す時刻。
 *
 * 記事の日付と**同じ日なら時刻だけ**（`15:07`）、違う日なら日付から出す（`8/31`）。
 * 一覧に日付が2つ並ぶと、どちらが記事の日付なのか分からなくなる。知りたいのは
 * たいてい「ずれているかどうか」なので、ずれている日だけ日付が出れば足りる。
 */
export function formatFetched(fetched: string, published: string | null): string {
  const at = new Date(fetched);
  const sameDay =
    published && new Date(published).toLocaleDateString('ja-JP') === at.toLocaleDateString('ja-JP');

  return sameDay
    ? at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

/** キーの見た目。文字だけだと本文に紛れて、押せる文字だと分からない。 */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-px text-[13px] leading-none text-zinc-300">
      {children}
    </kbd>
  );
}

export function ArticleList({
  articles,
  view,
  sort,
  selectedId,
  search,
  searchFailed,
  prevHref: serverPrev,
  nextHref: serverNext,
}: {
  articles: ArticleRow[];
  /** 検索そのものが失敗したか。0件と「引けなかった」を混ぜないため。 */
  searchFailed?: boolean;
  view: View;
  sort: 'new' | 'important';
  selectedId?: string;
  search?: string;
  /**
   * 前後の記事への行き先。**画面の下のボタンと同じものを受け取る**（app/page.tsx）。
   * ← → をここで一覧から数えると、開いた記事が一覧に居ないときに動かなくなる
   * （未読ビューでは開いた拍子に既読になり、その回の一覧から抜けているため）。
   */
  prevHref?: string;
  nextHref?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // 来た道があればそちらへ戻す（lib/trail.ts）。下のボタン・スワイプと同じ行き先。
  const { prevHref, nextHref } = useNeighbours(selectedId, serverPrev, serverNext);

  /**
   * 前後への移動が終わるまで、次の ← → を受けない。
   *
   * **押し続けると一歩も進まなくなる。** 行き先（`nextHref`）はサーバーが描き直す
   * まで変わらないので、着く前にもう一度押すと**いま向かっている先へもう一度**
   * 押したことになる。同じ場所への push は React の遷移をやり直させるだけなので、
   * 押し続けているあいだ永久に着かない。
   *
   * 実測（手元・300ms 間隔で40回）: 進んだのは3件だけで、13回続けて何も起きない
   * 場所があった。**「途中で止まった」に見えるのはこれ。**キーを押しっぱなしに
   * すると自動リピートは30ms 間隔なので、まず抜け出せない。
   *
   * **押したぶんは数えて覚えておく。**捨てると連打が効かない（実測: 300ms 間隔で
   * 40回押して20件しか進まなかった）。着けば次の行き先が分かるので、そこで残りを
   * 出す。5回押せば5つ先に着く——ただの遅れになる。
   *
   * **押しっぱなしの自動リピートは数えない**（`e.repeat`）。あれは30ms 間隔で
   * 際限なく届くので、数えると指を離したあとも延々と進み続ける。連打（1回ずつの
   * 押下）と押しっぱなしは、この旗でしか見分けられない。
   *
   * それでも上限を置くのは、連打しすぎたときに戻れなくなるため。溜まったぶんは
   * 1件ずつ本当に開いていく（既読も付く）ので、行き過ぎは手で戻すことになる。
   */
  const [moving, startMove] = useTransition();
  /** 移動中に押されたぶん。符号は向き（+ が次へ）。 */
  const queuedMove = useRef(0);

  useEffect(() => {
    if (moving || queuedMove.current === 0) return;
    const dir = queuedMove.current > 0 ? 1 : -1;
    const href = dir === 1 ? nextHref : prevHref;
    // 端に着いたら、残っているぶんは捨てる。押した回数ぶん壁を叩いても仕方がない。
    if (!href) {
      queuedMove.current = 0;
      return;
    }
    queuedMove.current -= dir;
    startMove(() => router.push(href));
  }, [moving, nextHref, prevHref, router]);

  const folderId = searchParams.get('folder') ?? undefined;
  const feedId = searchParams.get('feed') ?? undefined;

  /**
   * 継ぎ足したぶん。1ページ目はサーバー（page.tsx）が持っている。
   *
   * 記事を開くと URL が変わってサーバーから1ページ目が描き直されるが、
   * この state は残るので、**開いて戻っても読み込んだ位置が消えない**。
   * ここを props だけで組み立てると、1件開くたびに先頭60件へ巻き戻る。
   */
  const [extra, setExtra] = useState<ArticleRow[]>([]);
  /**
   * 次に取る位置は「読み込んだページ数 × PAGE_SIZE」で出す。表示中の行数から
   * 出してはいけない——未読ビューでは読んだ記事が1ページ目から抜けて行数が減るので、
   * 同じ位置を取り直しては重複除去で0件になり、**画面が動かないまま取得が
   * 止まらなくなる**（下端に居続けるので観測が何度でも発火する）。
   */
  const [pages, setPages] = useState(1);
  const [done, setDone] = useState(articles.length < PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  /**
   * 継ぎ足したぶんの状態の上書き。
   *
   * 1ページ目はサーバーが描き直すので既読やスターの変化がそのまま出るが、
   * 継ぎ足したぶんはこちらが state で持っているので**押しても見た目が変わらない**。
   * 押した内容をここに覚えて、描くときに重ねる。
   */
  const [patches, setPatches] = useState<Record<string, StatePatch>>({});

  const patch = useCallback((id: string, p: StatePatch) => {
    setPatches((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
    // setPatches まで並べているのは React Compiler の求めるまま。
    // 省くと『Existing memoization could not be preserved』でこの部品ごと
    // 最適化が止まる（lint が error にする）。中身は使わないが並べておく。
  }, [setPatches]);

  // 絞り込みが変わったら継ぎ足しは全部捨てる。「未読の続き」を
  // 「スター」の一覧に混ぜてはいけない。
  const queryKey = JSON.stringify([view, sort, folderId, feedId, search]);
  const [syncedKey, setSyncedKey] = useState(queryKey);
  if (queryKey !== syncedKey) {
    setSyncedKey(queryKey);
    setExtra([]);
    setPages(1);
    setDone(articles.length < PAGE_SIZE);
    setPatches({});
    setLoadError(null);
  }

  /**
   * 1ページ目 + 継ぎ足し。id で重複を落とす（未読を読むと位置がずれるので、
   * 同じ記事が両方に入ることがある）。
   *
   * useMemo なのは、これを毎レンダー作り直すと下のキー操作の登録も
   * 作り直しになるため（1文字打つたびに listener を張り替えることになる）。
   *
   * **重ねる先は1ページ目も含める。** 以前は継ぎ足したぶんにしか重ねていなかった。
   * 1ページ目はサーバーが描き直すから要らない、という理屈だったが、それは
   * 「開いた既読」が revalidate を連れていたときの話で、その描き直しをやめた今は
   * 押した結果がどこにも出なくなる（開いた記事が一覧では未読のまま残る）。
   *
   * 既読だけ別口（read-marks）なのは、**本文側で付いたぶんも重ねたいから**。
   * 「次の記事」で読み進めると既読を書くのは MarkReadOnView で、あちらから
   * この部品の state には触れない。
   */
  const readMarks = useSyncExternalStore(
    subscribeReadMarks,
    readMarksSnapshot,
    readMarksServerSnapshot,
  );

  const rows: ArticleRow[] = useMemo(() => {
    const merge = (a: ArticleRow) => {
      const p = patches[a.id];
      const read = readMarks.has(a.id) ? { is_read: true } : null;
      if (!p && !read) return a;
      // 押した操作（m・スワイプ）を後に重ねる。開いて既読になったものを
      // そのあと「未読に戻す」と押したときに、こちらが勝ってしまわないように。
      return { ...a, state: { ...EMPTY_STATE, ...a.state, ...read, ...p } };
    };
    const out = articles.map(merge);
    const seen = new Set(articles.map((a) => a.id));
    for (const a of extra) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(merge(a));
    }
    return out;
  }, [articles, extra, patches, readMarks]);

  // キーボード操作のカーソル。
  const selectedIndex = rows.findIndex((a) => a.id === selectedId);
  const [cursor, setCursor] = useState(() => Math.max(0, selectedIndex));
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const [helpOpen, setHelpOpen] = useState(false);
  // 全既読の取り消し用に、直前まで未読だった記事を覚えておく。
  const [undoIds, setUndoIds] = useState<string[] | null>(null);
  // スワイプやキー操作の結果を短い帯で知らせる。行の色は薄い変化しかないので、
  // 押した／滑らせたことが伝わらず「効いていない」と受け取られていた。
  const [flash, setFlash] = useState<string | null>(null);

  // 記事が選択され直したらカーソルを合わせる。
  // effect ではなくレンダー中に調整する（effect でやると余計な再レンダーが1往復増える）。
  const [syncedId, setSyncedId] = useState(selectedId);
  if (selectedId !== syncedId) {
    setSyncedId(selectedId);
    if (selectedIndex >= 0) setCursor(selectedIndex);
  }

  const hrefWith = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(searchParams.toString());
      mutate(sp);
      const qs = sp.toString();
      return qs ? `/?${qs}` : '/';
    },
    [searchParams],
  );

  const pushParams = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      router.push(hrefWith(mutate));
    },
    [router, hrefWith],
  );

  /** いま開いた記事。先読みが遷移と同じURLへ二重に飛ばないようにするための印。 */
  const opened = useRef<string | null>(null);

  /**
   * 記事を先に取っておく。
   *
   * 押してから往復が始まると、その1往復（RSC 89KB / 転送26KB。中身はほとんど
   * 変わっていないサイドバーと一覧60件）を毎回待つことになる。先に取っておけば
   * 押した瞬間に切り替わる。取ったぶんは静的扱いの5分間、手元に残る。
   *
   * 呼ぶのは**行きそうな1件だけ**にすること。60行ぶん先読みすると、
   * そのたびにサーバーがページを丸ごと組み立てる（Supabase に6往復ずつ）。
   */
  const prefetchArticle = useCallback(
    (id: string) => {
      prefetchFull(router, hrefWith((sp) => sp.set('article', id)));
    },
    [router, hrefWith],
  );

  const open = useCallback(
    (id: string) => {
      // 先読みの effect に「これはもう取りに行っている」と伝える。
      opened.current = id;
      pushParams((sp) => sp.set('article', id));
      // 開いた時点で既読にする（Inoreader と同じ挙動）。
      // quiet で書くのは、この既読に `/` の描き直しを抱き合わせないため
      // （actions/articles.ts の setState）。見た目はここの patch が持つ。
      patch(id, { is_read: true });
      rememberRead(id);
      startTransition(() => void markRead(id, true, true));
    },
    [pushParams, patch],
  );

  /** 続きを取る。下端の観測と、カーソルが末尾に近づいたときから呼ばれる。 */
  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const r = await loadMoreArticles({
        view,
        sort,
        folderId,
        feedId,
        search,
        offset: pages * PAGE_SIZE,
      });
      if (r.ok) {
        setExtra((prev) => [...prev, ...r.value.articles]);
        setPages((p) => p + 1);
        if (r.value.done) setDone(true);
      } else {
        // 黙って止めない。止まったのか終わったのかが見分けられなくなる。
        setLoadError(r.message);
      }
    } catch {
      setLoadError(UNEXPECTED_ERROR);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
    // set… も並べる理由は patch と同じ。
  }, [done, pages, view, sort, folderId, feedId, search, setExtra, setPages, setDone, setLoading, setLoadError]);

  /**
   * 下端が見えたら続きを取る。
   *
   * root は一覧の枠。ページ全体はスクロールしない（三ペインで枠ごとに
   * overflow-y-auto している）ので、既定の viewport 基準だと一度も交差しない。
   * 失敗したときは観測を張らない——同じ失敗を延々と繰り返すことになる。
   */
  useEffect(() => {
    if (done || loadError) return;
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      // 下端に着いてから取りに行くと必ず待つことになる。1画面ぶん手前で始める。
      { root: scrollRef.current, rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [done, loadError, loadMore]);

  /**
   * カーソルの下の記事だけ先に取っておく。
   *
   * j/k で選んでから o で開くので、選んだ時点で取り始めれば押したときには
   * もう手元にある。**カーソルは1つしか無い**ので、先読みも常に1件で済む
   * （画面に見えている行を全部先読みすると、その数だけサーバーが
   * ページを組み立てることになる）。
   *
   * **いま開いた記事は除く。** 行を押すとカーソルもそこへ動くので、素直に
   * 書くと遷移と先読みが同じURLへ同時に飛ぶ。走っている途中の先読みは
   * 遷移には使われず、サーバーが同じページを2回組み立てるだけになる。
   */
  useEffect(() => {
    const id = rows[cursor]?.id;
    if (!id || id === selectedId || id === opened.current) return;
    prefetchArticle(id);
  }, [cursor, rows, selectedId, prefetchArticle]);

  const markAll = useCallback(() => {
    // 既に既読だったものは戻す対象にしない。
    const wasUnread = rows.filter((a) => !a.state?.is_read).map((a) => a.id);
    if (wasUnread.length === 0) return;
    setUndoIds(wasUnread);
    for (const id of wasUnread) patch(id, { is_read: true });
    startTransition(() => void setReadMany(rows.map((a) => a.id), true));
  }, [rows, patch]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 入力中はショートカットを効かせない（Esc で入力から抜けるのだけ許す）。
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (typing) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ヘルプが開いている間は閉じる操作だけ受ける。
      if (helpOpen) {
        if (e.key === 'Escape' || e.key === '?') {
          e.preventDefault();
          setHelpOpen(false);
        }
        return;
      }

      const current = rows[cursor];

      switch (e.key) {
        case '?':
          e.preventDefault();
          setHelpOpen(true);
          break;
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case 'Escape':
          if (selectedId) {
            e.preventDefault();
            pushParams((sp) => sp.delete('article'));
          }
          break;
        case 'j':
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(cursor + 1, rows.length - 1);
          setCursor(next);
          rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          // 末尾が近づいたら続きを呼ぶ。キーだけで読み進める人は、下端が
          // 見えるところまでスクロールしないので観測が発火しない。
          if (next >= rows.length - 5) void loadMore();
          break;
        }
        case 'k':
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(cursor - 1, 0);
          setCursor(prev);
          rowRefs.current[prev]?.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'o':
        case 'Enter':
          if (current) {
            e.preventDefault();
            open(current.id);
          }
          break;
        /**
         * 記事を開いている間は、← → で前後の記事へ移る。
         *
         * スマホの「横に払う」と同じ操作をキーに割り当てたもの。画面の下の
         * 「← 前の記事 / 次の記事 →」を押しに行かなくても読み進められる。
         *
         * **開いていないときは何もしない。** 一覧だけを見ているときの ← → は、
         * 横に長い行を流し読みするための操作として残しておく。
         */
        case 'ArrowRight':
        case 'ArrowLeft': {
          // 行き先は**画面の下のボタンと同じもの**を使う（サーバーが出した prev/next）。
          // ここで一覧から自分で数えると、**開いた記事が一覧に居ないときに動かなくなる**
          // ——未読ビューでは開いた拍子に既読になり、その回の一覧からは抜けているため。
          // 実際それで ← → が無反応だった（app/page.tsx の位置の引き直しと同じ穴）。
          // 横に流れる要素（コード・表）の中では、その中を見るための矢印にする。
          // スワイプで pre / table を避けているのと同じ理由。
          if ((e.target as HTMLElement | null)?.closest?.('pre, table')) break;
          const href = e.key === 'ArrowRight' ? nextHref : prevHref;
          if (!href) break;
          e.preventDefault();
          // 着く前に押されたぶんは数えておいて、着いてから順に出す（上の moving）。
          if (moving) {
            // 押しっぱなしの自動リピートは数えない。離しても進み続けてしまう。
            if (e.repeat) break;
            const dir = e.key === 'ArrowRight' ? 1 : -1;
            queuedMove.current = Math.max(
              -MAX_QUEUED_MOVES,
              Math.min(MAX_QUEUED_MOVES, queuedMove.current + dir),
            );
            break;
          }
          startMove(() => router.push(href));
          break;
        }
        case 'm':
          if (current) {
            e.preventDefault();
            const next = !current.state?.is_read;
            setFlash(next ? '既読にしました' : '未読に戻しました');
            patch(current.id, { is_read: next });
            startTransition(() => void markRead(current.id, next));
          }
          break;
        case 's':
          if (current) {
            e.preventDefault();
            const next = !current.state?.is_starred;
            setFlash(next ? 'スターを付けました' : 'スターを外しました');
            patch(current.id, { is_starred: next });
            startTransition(() => void setStarred(current.id, next));
          }
          break;
        case 'l':
          if (current) {
            e.preventDefault();
            const next = !current.state?.read_later;
            setFlash(next ? '「あとで読む」に入れました' : '「あとで読む」から外しました');
            patch(current.id, { read_later: next });
            startTransition(() => void setReadLater(current.id, next));
          }
          break;
        case 'v':
          if (current) {
            e.preventDefault();
            window.open(current.url, '_blank', 'noopener');
          }
          break;
        case 'A':
          if (e.shiftKey) {
            e.preventDefault();
            markAll();
          }
          break;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursor, open, helpOpen, selectedId, pushParams, markAll, patch, loadMore, router, prevHref, nextHref, moving, startMove]);

  const unreadCount = rows.filter((a) => !a.state?.is_read).length;

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <header className="border-b border-zinc-800 px-3 py-2">
        {/* どのビューを見ているかを常に出す。スマホでは下部タブしか手がかりが無かった。 */}
        <div className="flex items-center gap-2">
          <h2 className="section-title shrink-0 whitespace-nowrap">{VIEW_LABELS[view]}</h2>
          <span className="whitespace-nowrap text-xs text-zinc-500">
            {/* まだ続きがあるなら「+」を付ける。確定した数字として出すと、
                スクロールのたびに増えるのが数え間違いに見える。 */}
            {rows.length}件{!done && '+'}
            {unreadCount > 0 && ` / 未読 ${unreadCount}`}
          </span>

          {view === 'unsummarized' ? (
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() =>
                startTransition(async () => {
                  // 結果を捨てない。捨てると、無料枠切れも未ログインも
                  // 「押しても何も起きない」として同じに見える。
                  const r = await requestSummaries(rows.map((a) => a.id));
                  setFlash(r.ok ? '再要約を受け付けました。順に処理されます。' : r.message);
                })
              }
              className="ml-auto rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
            >
              まとめて再要約
            </button>
          ) : (
            <button
              type="button"
              disabled={unreadCount === 0}
              onClick={markAll}
              title="表示中をすべて既読（Shift + A）"
              className="ml-auto flex items-center gap-1.5 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
            >
              全既読
              {/* ボタンの隣にキーを出す。ヘルプを開かなくても、押しながら覚えられる。 */}
              <span className="hidden md:inline">
                <Kbd>⇧A</Kbd>
              </span>
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          {/* 検索はサーバ側に前からあったが、入力欄が無くて使えなかった。 */}
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new FormData(e.currentTarget).get('q');
              pushParams((sp) => {
                const value = String(q ?? '').trim();
                if (value) sp.set('q', value);
                else sp.delete('q');
                sp.delete('article');
              });
            }}
          >
            <input
              ref={searchRef}
              type="search"
              name="q"
              defaultValue={search ?? ''}
              placeholder="検索（/ で移動）"
              aria-label="記事を検索"
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </form>

          <select
            value={sort}
            aria-label="並び順"
            title={sort === 'important' ? IMPORTANCE_HELP : undefined}
            onChange={(e) => pushParams((sp) => (sp.set('sort', e.target.value), sp.delete('article')))}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
          >
            <option value="new">新着順</option>
            <option value="important">重要度順</option>
          </select>

          {/* 重要度で並べているときだけ、その点数が何なのかを引ける「?」を出す。
              キーボードヘルプの ? と紛れないよう、説明する対象の隣に置く。 */}
          {sort === 'important' && <HelpTip label="重要度とは" text={IMPORTANCE_HELP} />}
        </div>
      </header>

      {/* 下の余白は下部タブぶん（3rem）＋ホームバーぶん。**両方要る**
          ——タブ自身がホームバーのぶんだけ背が高くなるので、3rem だけだと
          最後の行がタブの下に潜って押せなくなる。数はタブの min-h-12 と揃える。 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto thin-scroll pb-[calc(3rem+env(safe-area-inset-bottom))] md:pb-0"
      >
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-zinc-500">
            {/* **「0件」と「引けなかった」を同じ文面にしないこと。**
                前者は探し方を変える話、後者は語を短くする・記号を外す話で、
                次にやることが違う。 */}
            {searchFailed
              ? `「${search}」では検索できませんでした。語を短くするか、記号を減らして試してください`
              : search
              ? `「${search}」に一致する記事はありません`
              : view === 'unread'
                ? '未読はありません'
                : view === 'unsummarized'
                  ? '要約が付いていない記事はありません'
                  : '記事がありません'}
          </p>
        )}

        {rows.map((article, i) => (
          <Row
            key={article.id}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            article={article}
            active={i === cursor}
            selected={article.id === selectedId}
            onFocus={() => setCursor(i)}
            onOpen={() => {
              setCursor(i);
              open(article.id);
            }}
            onFlash={setFlash}
            onPatch={patch}
            onIntent={() => prefetchArticle(article.id)}
          />
        ))}

        {/* 下端。ここが見えたら続きを取る。高さゼロだと交差しないことがあるので、
            必ず何か描いておく（読み込み中は文言、終わりは終わりと書く）。 */}
        {rows.length > 0 && (
          <div ref={sentinelRef} className="px-3 py-4 text-center text-xs text-zinc-600">
            {loadError ? (
              <span className="flex flex-col items-center gap-2">
                <span className="text-amber-400">{loadError}</span>
                <button
                  type="button"
                  onClick={() => {
                    setLoadError(null);
                    void loadMore();
                  }}
                  className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:text-zinc-100"
                >
                  もう一度読み込む
                </button>
              </span>
            ) : loading ? (
              '読み込み中…'
            ) : done ? (
              'これで全部です'
            ) : (
              '続きを読み込みます…'
            )}
          </div>
        )}
      </div>

      {/* ショートカットの常設バー。スマホには物理キーが無いので出さない
          （そのぶんはスワイプが担う）。 */}
      <footer className="hidden md:flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800 px-3 py-1.5 text-[14px] text-zinc-500">
        {BAR.map(([keys, label]) => (
          <span key={keys} className="flex items-center gap-1">
            <Kbd>{keys}</Kbd>
            {label}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label="キーボードショートカット"
          title="キーボードショートカット（?）"
          className="ml-auto flex items-center gap-1 rounded px-1 hover:text-zinc-200"
        >
          <Kbd>?</Kbd>
          すべて
        </button>
      </footer>

      {undoIds && (
        <UndoBar
          count={undoIds.length}
          onUndo={() => {
            const ids = undoIds;
            setUndoIds(null);
            for (const id of ids) patch(id, { is_read: false });
            startTransition(() => void setReadMany(ids, false));
          }}
          onDismiss={() => setUndoIds(null)}
        />
      )}

      {/* 全既読の取り消し帯が出ているときは、そちらを優先して重ねない。 */}
      {flash && !undoIds && <ActionFlash text={flash} onDismiss={() => setFlash(null)} />}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

/**
 * 全既読の取り消し。自分から消える。
 *
 * 無限スクロールを入れてから、この対象は「読み込んだぶん全部」になった。
 * 60件で頭打ちだった頃より押し間違いの被害が大きいので、消えるまでを
 * 10秒に伸ばしてある（8秒だと、件数を読んでから指を動かすには短い）。
 */
const UNDO_MS = 10000;

function UndoBar({
  count,
  onUndo,
  onDismiss,
}: {
  count: number;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, UNDO_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      // PC ではショートカットのバーぶん（約28px）上に置く。重ねると
      // 「取り消す」がバーの上に乗って、どちらも読めなくなる。
      className="absolute inset-x-3 bottom-20 z-20 flex items-center gap-3 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs shadow-lg md:bottom-12"
    >
      <span className="flex-1">{count}件を既読にしました</span>
      <button type="button" onClick={onUndo} className="font-semibold text-sky-400 hover:text-sky-300">
        取り消す
      </button>
      <button type="button" onClick={onDismiss} aria-label="閉じる" className="text-zinc-500 hover:text-zinc-300">
        ✕
      </button>
    </div>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="キーボードショートカット"
      onClick={onClose}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded border border-zinc-700 bg-zinc-900 p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">キーボードショートカット</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>
        <dl className="space-y-1.5">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="flex items-baseline gap-3">
              <dt className="w-24 shrink-0 text-right">
                <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[14px] text-zinc-300">{keys}</kbd>
              </dt>
              <dd className="text-xs text-zinc-400">{label}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 border-t border-zinc-800 pt-3 text-[14px] text-zinc-500">
          一覧は下までスクロールすると続きを読み込みます。
        </p>
      </div>
    </div>
  );
}

function Row({
  ref,
  article,
  active,
  selected,
  onOpen,
  onFocus,
  onFlash,
  onPatch,
  onIntent,
}: {
  ref: (el: HTMLElement | null) => void;
  article: ArticleRow;
  active: boolean;
  selected: boolean;
  onOpen: () => void;
  onFocus: () => void;
  /** スワイプで何をしたかを親に伝え、帯で出してもらう。 */
  onFlash: (text: string) => void;
  /** 継ぎ足したぶんの行は親が state で持っている。押した結果を親へ返す。 */
  onPatch: (id: string, patch: StatePatch) => void;
  /** 開きそうだと分かった時点（指を置く・上に載せる）で本文を取りに行かせる。 */
  onIntent: () => void;
}) {
  const [, startTransition] = useTransition();
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [swipe, setSwipe] = useState(0);
  const [releasing, setReleasing] = useState(false);

  const read = article.state?.is_read ?? false;
  const importance = article.summary?.importance;
  // 訳した見出し（0023）。無ければ原題のまま。
  const heading = article.summary?.title_ja?.trim() || article.title;

  // 何が起きるかをスワイプ中に見せる。滑るだけだと壊れて見える。
  const THRESHOLD = 80;
  const willAct = Math.abs(swipe) > THRESHOLD;
  const leftAction = swipe < 0; // 左へ = 既読

  return (
    <div className="relative overflow-hidden border-b border-zinc-900">
      {/* 行の背後。スワイプで顔を出す。 */}
      {swipe !== 0 && (
        <div
          aria-hidden
          className={`absolute inset-0 flex items-center px-4 text-xs font-semibold ${
            leftAction
              ? 'justify-end bg-zinc-700 text-zinc-200'
              : 'justify-start bg-sky-900 text-sky-200'
          } ${willAct ? 'opacity-100' : 'opacity-50'}`}
        >
          {leftAction ? (read ? '未読に戻す' : '既読にする') : article.state?.read_later ? 'あとでを外す' : 'あとで読む'}
        </div>
      )}

      <article
        ref={ref}
        tabIndex={0}
        role="button"
        aria-current={selected ? 'true' : undefined}
        onFocus={onFocus}
        onClick={onOpen}
        // マウスを載せた時点で先に取りに行く。押してから始めると、その往復
        // （RSC 89KB）を必ず待つことになる。載せただけで離れたぶんは5分間
        // 手元に残るので、あとで開いたときに効く。
        //
        // **押した瞬間（pointerdown）には取りに行かない。** 押してから click
        // までは数十ミリ秒しかなく、取得が終わらないうちに遷移が始まる。
        // 走っている途中の先読みは遷移には使われないので、**同じページを
        // サーバーが2回組み立てるだけ**になる（実測で2本飛んでいた）。
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') onIntent();
        }}
        onKeyDown={(e) => {
          // 行そのものにフォーカスがあるとき用。全体のショートカットとは別。
          if (e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        onTouchStart={(e) => {
          touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          setReleasing(false);
        }}
        onTouchMove={(e) => {
          if (!touchStart.current) return;
          const dx = e.touches[0].clientX - touchStart.current.x;
          const dy = e.touches[0].clientY - touchStart.current.y;
          // 縦スクロールと取り違えないよう、横移動が明確なときだけ追従させる。
          if (Math.abs(dx) > Math.abs(dy)) setSwipe(dx);
        }}
        onTouchEnd={() => {
          const dx = swipe;
          setReleasing(true);
          setSwipe(0);
          touchStart.current = null;
          if (dx < -THRESHOLD) {
            onFlash(read ? '未読に戻しました' : '既読にしました');
            onPatch(article.id, { is_read: !read });
            startTransition(() => void markRead(article.id, !read));
          } else if (dx > THRESHOLD) {
            const next = !article.state?.read_later;
            onFlash(next ? '「あとで読む」に入れました' : '「あとで読む」から外しました');
            onPatch(article.id, { read_later: next });
            startTransition(() => void setReadLater(article.id, next));
          }
        }}
        style={swipe !== 0 ? { transform: `translateX(${swipe}px)` } : undefined}
        className={`relative cursor-pointer px-3 py-2.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-500 ${
          releasing ? 'transition-transform duration-150' : ''
        } ${
          selected
            ? 'bg-zinc-800'
            : active
              ? 'bg-zinc-900 shadow-[inset_2px_0_0_0_var(--color-sky-500)]'
              : 'bg-zinc-950 hover:bg-zinc-900/60'
        }`}
      >
        <div className="flex items-start gap-2">
          {!read && (
            <span aria-label="未読" className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-500" />
          )}
          {/*
            訳した見出しがあればそれを主にする。記事の42%（1262件中531件）が
            英語のフィードで、原題のままだと一覧を目で追うのが重い。
            原題は捨てずに下に小さく残す（訳が的外れなときに気づけるように）。
          */}
          <h3 className={`flex-1 text-sm leading-snug ${read ? 'text-zinc-500' : 'font-semibold text-zinc-50'}`}>
            {heading}
            {heading !== article.title && (
              <span className="mt-0.5 block text-[14px] font-normal text-zinc-600">
                {article.title}
              </span>
            )}
          </h3>
          {typeof importance === 'number' && importanceTier(importance).badge && (
            <span
              title={importanceTitle(importance)}
              className={`shrink-0 rounded px-1.5 py-0.5 text-[13px] ${importanceTier(importance).className}`}
            >
              重要度 {importanceTier(importance).label}
            </span>
          )}
        </div>

        {/* AI要点。ここが読めれば記事を開かずに判断できる。 */}
        {article.summary?.bullets?.length ? (
          <ul className="mt-1.5 space-y-0.5">
            {article.summary.bullets.slice(0, 3).map((b, i) => (
              <li key={i} className="text-xs leading-relaxed text-zinc-400">
                ・{b}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500">
            {/*
              **「要約待ち…」は待てば来るときだけ出す。**
              本文もRSSの抜粋も無い記事には要約を作らない（モデルに渡しても
              「本文は存在しない」という入力の説明が返るだけなので）。
              取りに行った跡（extracted_at）があるのに何も無いなら、
              待っても何も来ない。そう書かないと永久に待たせることになる。
            */}
            {article.excerpt ?? (article.extracted_at ? '本文なし（元記事で読めます）' : '要約待ち…')}
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-2 text-[14px] text-zinc-600">
          <span className="truncate">{article.feed?.title}</span>
          {article.published_at && (
            <time dateTime={article.published_at}>
              {new Date(article.published_at).toLocaleDateString('ja-JP', {
                month: 'numeric',
                day: 'numeric',
              })}
            </time>
          )}
          {/* 記事の日付の隣に、こちらへ入ってきた時刻。**同じ日なら時刻だけ**にする
              ——一覧では日付が2つ並ぶより、違う日のときだけ日付が出るほうが目立つ。 */}
          {article.created_at && (
            <time
              dateTime={article.created_at}
              title={`取得 ${new Date(article.created_at).toLocaleString('ja-JP')}`}
              className="text-zinc-700"
            >
              取得{formatFetched(article.created_at, article.published_at)}
            </time>
          )}
          {article.state?.is_starred && (
            <span title="スター" className="text-amber-400">
              ★
            </span>
          )}
          {article.state?.read_later && (
            <span title="あとで読む" className="text-sky-400">
              ◷
            </span>
          )}
          {article.state?.exported_at && (
            <span title="NotebookLM へ書き出し済み" className="text-emerald-400">
              NLM
            </span>
          )}
        </div>
      </article>
    </div>
  );
}
