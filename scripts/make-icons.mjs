/**
 * PWA アイコンを生成する。
 *
 * 画像ライブラリを足したくないので、PNG を自前で書き出している（zlib は Node 標準）。
 * やっていることは「ピクセルを塗って deflate して PNG のチャンクで包む」だけ。
 * 図形は距離関数で表して4x4のスーパーサンプリングを取り、輪郭を滑らかにする。
 *
 *   npm run icons
 *
 * 生成物は public/ に置いて git に入れる。ビルドのたびに作り直す必要は無いし、
 * バイナリが手元に無いと Vercel 上でアイコンだけ欠ける事故が起きるため。
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Node は型注釈を剥がして .ts をそのまま読む（v22.18以降）。端末の一覧を
// layout.tsx と2か所に持たないため、ここから直に読んでいる。
import { SPLASH_DEVICES, splashHref, splashPixels } from '../src/lib/splash.ts';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** 背景。layout.tsx の themeColor と合わせる。 */
const BG = [0x0b, 0x0d, 0x10];
/** 前景。zinc-100 相当。 */
const FG = [0xf4, 0xf4, 0xf5];

/** 生成するもの。glyph は図柄の占める割合、round は角の丸めの割合（0で全面）。 */
const TARGETS = [
  { file: 'icon-192.png', size: 192, glyph: 0.62, round: 0.22 },
  { file: 'icon-512.png', size: 512, glyph: 0.62, round: 0.22 },
  // Android はマスクで円形などに切り抜くので、図柄を内側40%の安全域に収める。
  { file: 'icon-maskable-512.png', size: 512, glyph: 0.44, round: 0 },
  // iOS は角丸を自前で付けるため、こちらは全面べた塗りにする。
  { file: 'apple-touch-icon.png', size: 180, glyph: 0.62, round: 0 },
];

/**
 * 1枚ぶんの RGBA バッファを作る。
 * 図柄は RSS の記号（左下の点＋右上へ広がる2本の弧）。
 */
function renderIcon({ size, glyph, round }) {
  const buf = Buffer.alloc(size * size * 4);
  const S = 4; // スーパーサンプリングの分割数

  // 図柄の基準。左下に原点を置き、そこから弧を伸ばす。
  const span = size * glyph;
  const originX = (size - span) / 2;
  const originY = size - (size - span) / 2;
  const dotR = span * 0.13;
  const arcs = [
    { r: span * 0.42, w: span * 0.15 },
    { r: span * 0.78, w: span * 0.15 },
  ];
  const radius = round > 0 ? size * round : 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let fgHits = 0;

      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;

          if (!insideCard(px, py, size, radius)) continue;
          bgHits++;

          if (insideGlyph(px, py, originX, originY, dotR, arcs)) fgHits++;
        }
      }

      const total = S * S;
      const alpha = bgHits / total;
      if (alpha === 0) continue;

      // 前景の割合は「カードの内側」を分母にする（縁での二重の薄まりを避ける）。
      const mix = bgHits === 0 ? 0 : fgHits / bgHits;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        buf[i + c] = Math.round(BG[c] * (1 - mix) + FG[c] * mix);
      }
      buf[i + 3] = Math.round(alpha * 255);
    }
  }

  return { w: size, h: size, buf };
}

/**
 * iOS の起動画面を1枚ぶん作る（一覧は src/lib/splash.ts）。
 *
 * **アイコンと違って正方形ではない**ので、図柄を真ん中に置いて残りは背景色で
 * べた塗りにする。ここで凝らないこと——出ているのは1〜2秒で、要るのは
 * 「押したのは届いている」と分かることだけ。
 *
 * 走査するのは図柄の入る正方形だけにしてある。端末の実寸（例 1290x2796）を
 * 全画素×16標本で回すと1枚に数秒かかるが、塗るのは真ん中の数%しかない。
 */
function renderSplash({ w, h }) {
  const buf = Buffer.alloc(w * h * 4);
  // 全面を背景色で埋める。透明のまま残すと iOS が白で合成する。
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = BG[0];
    buf[i * 4 + 1] = BG[1];
    buf[i * 4 + 2] = BG[2];
    buf[i * 4 + 3] = 255;
  }

  // 図柄は短辺の26%。弧の比率はアイコンと同じ。
  const span = Math.round(Math.min(w, h) * 0.26);
  const left = Math.round((w - span) / 2);
  const top = Math.round((h - span) / 2);
  const originX = left;
  const originY = top + span;
  const dotR = span * 0.13;
  const arcs = [
    { r: span * 0.42, w: span * 0.15 },
    { r: span * 0.78, w: span * 0.15 },
  ];

  const S = 4;
  for (let y = top; y < top + span; y++) {
    for (let x = left; x < left + span; x++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          if (insideGlyph(x + (sx + 0.5) / S, y + (sy + 0.5) / S, originX, originY, dotR, arcs)) {
            hits++;
          }
        }
      }
      if (hits === 0) continue;
      const mix = hits / (S * S);
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round(BG[c] * (1 - mix) + FG[c] * mix);
    }
  }

  return { w, h, buf };
}

/** 角丸の四角形の内側か。radius が 0 なら全面。 */
function insideCard(x, y, size, radius) {
  if (radius <= 0) return true;
  const dx = Math.max(radius - x, 0, x - (size - radius));
  const dy = Math.max(radius - y, 0, y - (size - radius));
  return dx * dx + dy * dy <= radius * radius;
}

/** RSS の記号の内側か。左下の点と、そこを中心にした右上向きの弧2本。 */
function insideGlyph(x, y, ox, oy, dotR, arcs) {
  const dx = x - ox;
  const dy = y - oy;
  const d = Math.hypot(dx, dy);

  if (d <= dotR) return true;

  // 弧は原点から見て右上の象限だけ（dx >= 0 かつ dy <= 0）。
  if (dx < 0 || dy > 0) return false;
  return arcs.some((a) => d >= a.r && d <= a.r + a.w);
}

/** RGBA バッファを PNG のバイト列にする。 */
function png({ w, h, buf }) {
  // 各行の先頭にフィルタ種別のバイト（0 = なし）を挟むのが PNG の生データ形式。
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    buf.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // カラータイプ 6 = RGBA
  // 10-12 は圧縮・フィルタ・インタレース方式。いずれも既定値の 0。

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// 実行はここ。const 宣言（CRC_TABLE）より前に呼ぶと初期化前アクセスになるので、
// 生成のループはファイル末尾に置いている。
for (const t of TARGETS) {
  writeFileSync(join(OUT_DIR, t.file), png(renderIcon(t)));
  console.log(`${t.file}  ${t.size}x${t.size}`);
}

// iOS の起動画面。端末ごとに1枚要る（寸法が完全に一致する1枚しか使われない）。
mkdirSync(join(OUT_DIR, 'splash'), { recursive: true });
for (const d of SPLASH_DEVICES) {
  const px = splashPixels(d);
  writeFileSync(join(OUT_DIR, splashHref(d).slice(1)), png(renderSplash(px)));
  console.log(`splash/${px.w}x${px.h}.png  ${d.label}`);
}
