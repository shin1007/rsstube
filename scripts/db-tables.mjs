/**
 * バックアップ・復元で扱うテーブルと、その順序。
 *
 * 外部キーの向きに沿って並べてある。復元はこの順、削除するならこの逆順。
 *
 * 入っていないもの:
 *   jobs              巡回のたびに作られる一時的なキュー。戻すと古い仕事が動き出す
 *   schema_migrations db:migrate が管理する
 */
export const TABLES = [
  'folders',
  'feeds',
  'articles',
  'article_states',
  'summaries',
  'exports',
  'digests',
  'settings',
];
