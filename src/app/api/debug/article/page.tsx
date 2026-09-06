import { connection } from 'next/server';
import { ArticleView } from '@/components/ArticleView';

const dummyArticle = {
  id: 'test-article-1',
  title: 'Playwright テスト用記事タイトル - スマホ表示と下端ナビゲーションの動作確認',
  url: 'https://example.com/test-article-1',
  author: 'RSSTube QA',
  // **固定の日付にすること。** `new Date()` は prerender で落ちる（同期IOは
  // instant = false でも許されない）。テスト用の見本なので、日付が動く必要も無い。
  published_at: '2026-09-01T00:00:00.000Z',
  content_text: 'これはテスト用の本文です。'.repeat(100),
  content_html: '<p>テスト用本文HTML</p>',
  content_ok: true,
  extracted_at: '2026-09-01T00:00:00.000Z',
  extract_fail: null,
  created_at: '2026-09-01T00:00:00.000Z',
  feeds: { id: 'feed-1', title: 'テスト用フィード' },
  summaries: {
    bullets: [
      'スマホ下端にナビゲーションバーが固定表示されるか検証',
      'フローティングハンバーガーボタンが右下に表示されるか検証',
    ],
    tags: ['E2E', 'Playwright'],
    title_ja: 'Playwright テスト用記事タイトル - スマホ表示確認',
  },
  article_states: {
    is_read: true,
    is_starred: false,
    read_later: false,
    exported_at: null,
  },
};

/**
 * **prerender させない。** これは E2E 用の見本で、中身は `ArticleView` を
 * そのまま呼んでいる。本文側には「いま」に依っているところがあり、静的な
 * HTML に焼くと答えが決まらない（Cache Components が同期IOとして弾く）。
 *
 * 実物と同じ部品で見た目を確かめるのがこのページの目的なので、部品のほうを
 * 見本のために曲げない。`connection()` で「要求が来てから描く」側に倒す。
 */
export default async function DebugArticlePage() {
  await connection();

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col h-full overflow-hidden">
      <ArticleView
        article={dummyArticle}
        backHref="/api/debug/article"
        prevHref="/api/debug/article?prev=1"
        nextHref="/api/debug/article?next=1"
        remaining={5}
      />
    </div>
  );
}
/**
 * まだ「押した瞬間に枠が出る」形に直していないので、ブロックを許す。
 * 直したら消すこと（docs/traps/perf.md）。
 */
export const instant = false;
