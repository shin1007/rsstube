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
 */
export function SlideView({ slide }: { slide: Slide | undefined }) {
  if (!slide) {
    return <div className="flex h-full items-center justify-center text-zinc-700">…</div>;
  }

  if (slide.type === 'title') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h2
          className="font-bold leading-tight"
          style={{ fontSize: 'clamp(1.4rem, 4.5vw, 2.75rem)' }}
        >
          {slide.title}
        </h2>
        {slide.subtitle && (
          <p className="text-zinc-400" style={{ fontSize: 'clamp(0.8rem, 2vw, 1.1rem)' }}>
            {slide.subtitle}
          </p>
        )}
      </div>
    );
  }

  if (slide.type === 'quote') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <blockquote
          className="max-w-3xl leading-relaxed text-zinc-100"
          style={{ fontSize: 'clamp(1.1rem, 3vw, 1.9rem)' }}
        >
          「{slide.text}」
        </blockquote>
        {slide.cite && <cite className="text-sm text-zinc-500 not-italic">— {slide.cite}</cite>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-center gap-4 p-6 md:p-10">
      <h2
        className="font-bold leading-tight text-zinc-100"
        style={{ fontSize: 'clamp(1.1rem, 3.2vw, 2rem)' }}
      >
        {slide.heading}
      </h2>
      <ul className="space-y-2.5">
        {slide.bullets.map((b, i) => (
          <li
            key={i}
            className="flex gap-2.5 leading-relaxed text-zinc-300"
            style={{ fontSize: 'clamp(0.85rem, 2.1vw, 1.25rem)' }}
          >
            <span className="text-zinc-600">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
