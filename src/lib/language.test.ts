import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  languageLabel,
  languageName,
  normalizeLanguage,
} from './language';

describe('normalizeLanguage', () => {
  it('知っているコードはそのまま', () => {
    expect(normalizeLanguage('ja')).toBe('ja');
    expect(normalizeLanguage('en')).toBe('en');
    expect(normalizeLanguage('zh-TW')).toBe('zh-TW');
  });

  it('知らない値は既定に倒す', () => {
    // 設定に手で妙な値を入れられても、要約の言語が黙って壊れないこと。
    for (const bad of ['', 'xx', 'JA', 'japanese', null, undefined, 42, {}, []]) {
      expect(normalizeLanguage(bad)).toBe(DEFAULT_LANGUAGE);
    }
  });

  it('既定は日本語', () => {
    expect(DEFAULT_LANGUAGE).toBe('ja');
  });
});

describe('languageName', () => {
  it('プロンプトにはコードではなくその言語自身の呼び名を渡す', () => {
    // 「ja で書け」と頼むと出力が揺れる。言語名で頼む。
    expect(languageName('ja')).toBe('日本語');
    expect(languageName('en')).toBe('English');
    expect(languageName('zh-CN')).toBe('简体中文');
  });

  it('知らない値でも落ちない', () => {
    expect(languageName('xx')).toBe('日本語');
  });
});

describe('languageLabel', () => {
  it('画面にはその言語の話者が読める名前を出す', () => {
    expect(languageLabel('ko')).toBe('한국어');
    expect(languageLabel('fr')).toBe('Français');
  });
});

describe('LANGUAGES', () => {
  it('すべての言語に画面名とプロンプト名がある', () => {
    for (const [code, v] of Object.entries(LANGUAGES)) {
      expect(v.label, `${code} の label`).toBeTruthy();
      expect(v.inPrompt, `${code} の inPrompt`).toBeTruthy();
    }
  });

  it('既定の言語が一覧に入っている', () => {
    expect(Object.keys(LANGUAGES)).toContain(DEFAULT_LANGUAGE);
  });
});
