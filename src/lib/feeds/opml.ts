/**
 * OPML の読み書き。
 *
 * Inoreader / Feedly からの移行と、そこへの出戻りができるようにしておく。
 * OPML は outline 要素の入れ子で、フォルダ = 子を持つ outline、
 * フィード = xmlUrl 属性を持つ outline、という緩い約束で使われている。
 * 実際のエクスポートは属性の付き方がまちまちなので、正規表現で緩く拾う。
 */

export type OpmlFeed = {
  title: string;
  xmlUrl: string;
  htmlUrl?: string;
  folder?: string;
};

const ATTR = (tag: string, name: string): string | undefined => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'))
    ?? tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m?.[1];
};

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export function parseOpml(xml: string): OpmlFeed[] {
  const feeds: OpmlFeed[] = [];
  // 開始タグ・自己終了タグ・終了タグを出現順に走査し、
  // xmlUrl を持たない outline をフォルダとみなしてスタックに積む。
  const stack: string[] = [];
  const re = /<outline\b[^>]*?(\/?)>|<\/outline\s*>/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];

    if (tag.startsWith('</')) {
      stack.pop();
      continue;
    }

    const selfClosing = m[1] === '/';
    const xmlUrl = ATTR(tag, 'xmlUrl');
    const title = ATTR(tag, 'title') ?? ATTR(tag, 'text') ?? '';

    if (xmlUrl) {
      feeds.push({
        title: unescapeXml(title).trim() || xmlUrl,
        xmlUrl: unescapeXml(xmlUrl).trim(),
        htmlUrl: ATTR(tag, 'htmlUrl') ? unescapeXml(ATTR(tag, 'htmlUrl')!).trim() : undefined,
        folder: stack.length > 0 ? stack[stack.length - 1] : undefined,
      });
      // フィードの outline も入れ子を持ちうるので、自己終了でなければ積む。
      if (!selfClosing) stack.push(unescapeXml(title).trim());
    } else if (!selfClosing) {
      stack.push(unescapeXml(title).trim());
    }
  }

  // 同じフィードが複数フォルダに入っていることがあるので URL で一意化する。
  const seen = new Set<string>();
  return feeds.filter((f) => {
    if (!f.xmlUrl || seen.has(f.xmlUrl)) return false;
    seen.add(f.xmlUrl);
    return true;
  });
}

const escapeXml = (s: string): string =>
  s.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );

export function buildOpml(feeds: OpmlFeed[]): string {
  const byFolder = new Map<string, OpmlFeed[]>();
  for (const f of feeds) {
    const key = f.folder ?? '';
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key)!.push(f);
  }

  const line = (f: OpmlFeed, indent: string) =>
    `${indent}<outline type="rss" text="${escapeXml(f.title)}" title="${escapeXml(f.title)}"` +
    ` xmlUrl="${escapeXml(f.xmlUrl)}"${f.htmlUrl ? ` htmlUrl="${escapeXml(f.htmlUrl)}"` : ''}/>`;

  const body: string[] = [];
  for (const [folder, items] of byFolder) {
    if (folder === '') {
      body.push(...items.map((f) => line(f, '    ')));
    } else {
      body.push(`    <outline text="${escapeXml(folder)}" title="${escapeXml(folder)}">`);
      body.push(...items.map((f) => line(f, '      ')));
      body.push('    </outline>');
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="1.0">',
    '  <head><title>RSSTube subscriptions</title></head>',
    '  <body>',
    ...body,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}
