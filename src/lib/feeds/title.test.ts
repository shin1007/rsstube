import { describe, expect, it } from 'vitest';
import { stripRepeatedTails } from './title';

describe('stripRepeatedTails', () => {
  it('東洋経済のサイト名を落とす（実データの形）', () => {
    const out = stripRepeatedTails([
      '日銀｢3カ月ぶり利上げ｣判断へ､マイナス金利解除後では初 | 政治・経済・投資 | 東洋経済オンライン',
      'ソフトバンクグループ､台湾TSMC株の保有を72%削減 | 政治・経済・投資 | 東洋経済オンライン',
      '25年後に後を追った妻の"泣けるいじわる" | ライフ | 東洋経済オンライン',
      '東大生1000人を調査した筆者が解説するインプットのコツ | キャリア・教育 | 東洋経済オンライン',
    ]);
    for (const t of out) expect(t).not.toContain('東洋経済オンライン');
    // カテゴリは記事ごとに変わるので残る。中身の手がかりなので残したい。
    expect(out[2]).toContain('ライフ');
  });

  it('ダイヤモンドの連載名を落とす（実データの形）', () => {
    const out = stripRepeatedTails([
      '「正しい陰謀論」と「間違った陰謀論」の違い - ニュースな本',
      '「面倒見が良い大学ランキング」21年連続1位の地方大 - ニュースな本',
      '中国が日本人を相次ぎ「スパイ摘発」するワケ - ニュースな本',
      '「高血圧」はどこまで下げればいい？9000人超を追跡した答え - ニュースな本',
    ]);
    for (const t of out) expect(t).not.toContain('ニュースな本');
    expect(out[0]).toBe('「正しい陰謀論」と「間違った陰謀論」の違い');
  });

  it('記事ごとに違う末尾は落とさない（Hacker News で実際に誤検出した形）', () => {
    const titles = [
      'Magnitude 7.7 Earthquake – 68 km NNW of Ende, Indonesia',
      'Breaking the WAL',
      'Every Fucking Website',
      'Using GCC Nested Functions – Part II',
      'Ask HN: How do you keep up',
    ];
    expect(stripRepeatedTails(titles)).toEqual(titles);
  });

  it('件数が少ないときは何もしない', () => {
    // 3件では「たまたま揃った」と区別が付かない。
    const titles = ['記事のタイトルその1 | サイト名', '記事のタイトルその2 | サイト名'];
    expect(stripRepeatedTails(titles)).toEqual(titles);
  });

  it('落とすと短くなりすぎるものは残す', () => {
    const titles = ['速報 | NHK', '速報 | NHK', '速報 | NHK', '速報 | NHK', '速報 | NHK'];
    // 残りが8字未満になるので手を付けない。「速報」だけにしても意味がない。
    expect(stripRepeatedTails(titles)).toEqual(titles);
  });

  it('長い末尾は本文の一部とみなして残す', () => {
    const titles = Array(5).fill('見出しはこちらです - これは三十文字を超えるとても長い末尾なので本文の一部とみなしたい');
    expect(stripRepeatedTails(titles)).toEqual(titles);
  });

  it('件数と並びは変えない', () => {
    const titles = [
      'あいうえおかきくけこ | サイト',
      '別の記事のタイトルです | サイト',
      'さらに別のタイトルです | サイト',
      'よっつめのタイトルです | サイト',
    ];
    const out = stripRepeatedTails(titles);
    expect(out).toHaveLength(4);
    expect(out[1]).toBe('別の記事のタイトルです');
  });

  it('区切りが無いものはそのまま', () => {
    const titles = ['タイトルその1です', 'タイトルその2です', 'タイトルその3です', 'タイトルその4です'];
    expect(stripRepeatedTails(titles)).toEqual(titles);
  });

  it('ハイフンを含む語を巻き込まない', () => {
    // 区切りとして見るのは前後に空白があるダッシュだけ。
    const titles = Array(5).fill('e-Taxとマイナポータルの連携について');
    expect(stripRepeatedTails(titles)).toEqual(titles);
  });
});
