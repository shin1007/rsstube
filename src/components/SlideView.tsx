import type { Slide } from '@/lib/ai/script';

/**
 * スライド1枚。
 *
 * mp4 は作らない（plan.md の判断）。動画にせず HTML/CSS で描くことにしたので、
 * サーバー側の合成が要らず、スマホでも即出る。文字も選択できるし、
 * 画面幅に合わせて折り返る。
 *
 * 文字サイズは vw ではなく clamp で決める。vw だけだと縦長の画面で
 * 極端に小さくなり、横長のPCでは大きすぎる。
 *
 * **黒地に文字を置くだけにしない。** 中身は正しく出ていても、罫線も色も
 * 番号も無いと「スライドが出ていない」ように見える（実際にそう報告された）。
 * 型ごとに構えを変え、記事の画像があれば敷き、無いときは色の帯で枚数を示す。
 */

/**
 * スライドごとの差し色。
 *
 * 全部同じ色にすると、切り替わったことが音でしか分からない。枚数ぶん循環させて、
 * 「次の話題に移った」を目で分かるようにする。ダークテーマ固定なので、
 * 黒地で沈まない明度のものだけを選んである。
 */
const ACCENTS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185'];

export function SlideView({
  slide,
  index = 0,
  total = 0,
  coverUrl = null,
}: {
  slide: Slide | undefined;
  index?: number;
  total?: number;
  /** 記事の代表画像。無ければ文字だけで組む。 */
  coverUrl?: string | null;
}) {
  if (!slide) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-600">
        このクリップに対応するスライドがありません
      </div>
    );
  }

  const accent = ACCENTS[index % ACCENTS.length];

  return (
    // key で作り直して、切り替わりをアニメーションさせる。
    <div key={index} className="slide-enter relative h-full overflow-hidden">
      {/*
        表紙の絵。表紙スライドは全面に、それ以外は薄く敷くだけにする。
        文字の上に絵を重ねると、どちらも読めなくなる。
      */}
      {coverUrl && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${coverUrl})`,
            opacity: slide.type === 'title' ? 0.85 : 0.14,
          }}
        />
      )}
      {coverUrl && (
        // 絵の上に文字を置くので、暗い膜を1枚かける。かけ方は表紙とそれ以外で
        // 変える。表紙は絵を見せたいので薄く、箇条書きは字が主役なので濃く。
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              slide.type === 'title'
                ? 'linear-gradient(180deg, rgba(9,9,11,0.25) 0%, rgba(9,9,11,0.5) 45%, rgba(9,9,11,0.8) 100%)'
                : 'linear-gradient(180deg, rgba(9,9,11,0.7) 0%, rgba(9,9,11,0.85) 100%)',
          }}
        />
      )}

      {/* 左端の差し色。絵が無いときはこれが「スライドらしさ」を持つ。 */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: accent, opacity: 0.9 }}
      />

      {/* 何枚目か。音だけ聴いていて画面を見たとき、どのあたりかが分かる。 */}
      {total > 1 && (
        // 絵の上にも乗るので、字だけだと読めない。薄い下地を敷く。
        <div className="absolute right-3 top-3 rounded-full bg-zinc-950/70 px-2 py-0.5 text-[14px] tabular-nums text-zinc-300">
          {index + 1} / {total}
        </div>
      )}

      <div className="relative h-full">
        {slide.type === 'title' && <TitleSlide slide={slide} accent={accent} />}
        {slide.type === 'quote' && <QuoteSlide slide={slide} accent={accent} />}
        {slide.type === 'bullets' && <BulletsSlide slide={slide} accent={accent} />}
      </div>
    </div>
  );
}

function TitleSlide({
  slide,
  accent,
}: {
  slide: Extract<Slide, { type: 'title' }>;
  accent: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center md:p-10">
      <h2
        className="font-bold leading-tight text-white"
        style={{ fontSize: 'clamp(1.4rem, 4.5vw, 2.75rem)' }}
      >
        {slide.title}
      </h2>
      {/* 見出しと副題の間の罫線。1本あるだけで「表紙」に見える。 */}
      <div className="h-0.5 w-16 rounded-full" style={{ background: accent }} />
      {slide.subtitle && (
        <p className="text-zinc-300" style={{ fontSize: 'clamp(0.8rem, 2vw, 1.1rem)' }}>
          {slide.subtitle}
        </p>
      )}
    </div>
  );
}

function QuoteSlide({
  slide,
  accent,
}: {
  slide: Extract<Slide, { type: 'quote' }>;
  accent: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center md:p-10">
      {/* 大きな引用符。「これは誰かの言葉だ」が一目で伝わる。 */}
      <div
        aria-hidden
        className="leading-none"
        style={{ color: accent, fontSize: 'clamp(2rem, 6vw, 4rem)', opacity: 0.5 }}
      >
        “
      </div>
      <blockquote
        className="max-w-3xl leading-relaxed text-zinc-50"
        style={{ fontSize: 'clamp(1.1rem, 3vw, 1.9rem)' }}
      >
        {slide.text}
      </blockquote>
      {slide.cite && <cite className="text-sm not-italic text-zinc-400">— {slide.cite}</cite>}
    </div>
  );
}

function BulletsSlide({
  slide,
  accent,
}: {
  slide: Extract<Slide, { type: 'bullets' }>;
  accent: string;
}) {
  return (
    <div className="flex h-full flex-col justify-center gap-5 p-6 md:p-10">
      <div className="space-y-2.5">
        <h2
          className="font-bold leading-tight text-white"
          style={{ fontSize: 'clamp(1.1rem, 3.2vw, 2rem)' }}
        >
          {slide.heading}
        </h2>
        <div className="h-0.5 w-12 rounded-full" style={{ background: accent }} />
      </div>

      <ul className="space-y-3">
        {(slide.bullets ?? []).map((b, i) => (
          <li
            key={i}
            className="flex gap-3 leading-relaxed text-zinc-200"
            style={{ fontSize: 'clamp(0.85rem, 2.1vw, 1.25rem)' }}
          >
            {/* 点ではなく短い縦棒。行が折り返しても頭の位置が分かる。 */}
            <span
              aria-hidden
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: accent }}
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
