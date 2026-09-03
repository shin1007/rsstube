import { ArticleView } from '@/components/ArticleView';

export const dynamic = 'force-dynamic';

const dummyArticle = {
  id: 'test-article-1',
  title: 'Playwright テスト用記事タイトル - スマホ表示と下端ナビゲーションの動作確認',
  url: 'https://example.com/test-article-1',
  author: 'RSSTube QA',
  published_at: new Date().toISOString(),
  content_text: 'これはテスト用の本文です。'.repeat(100),
  content_html: '<p>テスト用本文HTML</p>',
  content_ok: true,
  extracted_at: new Date().toISOString(),
  extract_fail: null,
  created_at: new Date().toISOString(),
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

export default function DebugArticlePage() {
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