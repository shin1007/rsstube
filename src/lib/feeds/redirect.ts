/**
 * リダイレクトの追跡。
 *
 * フィードのURLは変わる。サイトがドメインを移したり、CMS を入れ替えたりすると
 * 配信先が動き、元のURLは 301 を返すようになる。`redirect: 'follow'` に任せると
 * 読めはするが**移転先を覚えない**ので、古いURLを叩き続け、いつかそれが消えた
 * ときに「取得に失敗するフィード」として死ぬ。移転していただけなのに。
 *
 * 301 / 308（恒久的）で辿り着いた先だけを、保存してよい新しいURLとして返す。
 * 302 / 307（一時的）は追うだけで覚えない。相手が「一時的」と言っているものを
 * 勝手に固定すると、戻ったときに追随できなくなる。
 */

/** 何回まで追うか。ループしている相手で止まらなくならないように。 */
export const MAX_HOPS = 5;

const PERMANENT = new Set([301, 308]);
const TEMPORARY = new Set([302, 303, 307]);

export function isRedirect(status: number): boolean {
  return PERMANENT.has(status) || TEMPORARY.has(status);
}

/**
 * 追ってきた道のりから、保存してよい移転先を決める。
 *
 * 途中に一時的なものが1つでも混じっていたら覚えない。
 * 「恒久的に A→B、一時的に B→C」のとき、覚えてよいのは B までだが、
 * 途中で分けて持つほど得るものが無いので、その場合は何も覚えないことにする。
 */
export function permanentTarget(hops: { status: number; to: string }[]): string | null {
  if (hops.length === 0) return null;
  if (hops.some((h) => !PERMANENT.has(h.status))) return null;
  return hops[hops.length - 1].to;
}
