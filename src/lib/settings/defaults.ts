import type { VoiceMode } from '@/lib/ai/script';

/**
 * settings の既定値。
 *
 * **`settings` の行が無いと、DB の列の default は効かない。**設定画面を一度も
 * 保存していないと行そのものが無いので、`0001` に書いた default は出てこない
 * （CLAUDE.md の罠にある `notebooklm_prompt` と同じ話）。だからここに TS 側の
 * 定数も置く。
 *
 * **値を変えるときは、マイグレーションの default と両方を揃えること。**
 * 以前はこの数字が「画面の defaultValue」「保存時のフォールバック」
 * 「ワーカー側の ?? 」「purge の定数」の4か所に散っていて、1か所直しても
 * 他が古いままになる形だった。参照先はここ1つにする。
 */

/** 音声の話し方。1人の語りが既定（2026-08-27 にオーナーが決定）。 */
export const DEFAULT_VOICE_MODE: VoiceMode = 'solo';

/** 音声をサーバーに置いておく日数。0 で無期限。 */
export const DEFAULT_MEDIA_RETENTION_DAYS = 14;

/** 記事本文を置いておく日数。0 で無期限。 */
export const DEFAULT_RETENTION_DAYS = 90;

/** ダイジェストに入れる記事数。 */
export const DEFAULT_DIGEST_COUNT = 8;

/** ダイジェストを作る時刻（日本時間）。 */
export const DEFAULT_DIGEST_HOUR = 6;
