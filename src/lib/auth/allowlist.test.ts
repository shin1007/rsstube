import { describe, expect, it, afterEach } from 'vitest';
import { isAllowedEmail } from './allowlist';

const original = process.env.ALLOWED_EMAILS;
afterEach(() => {
  if (original === undefined) delete process.env.ALLOWED_EMAILS;
  else process.env.ALLOWED_EMAILS = original;
});

describe('isAllowedEmail', () => {
  it('未設定なら制限しない（ローカル開発用）', () => {
    delete process.env.ALLOWED_EMAILS;
    expect(isAllowedEmail('anyone@example.com')).toBe(true);
  });

  it('空文字も未設定と同じ扱い', () => {
    process.env.ALLOWED_EMAILS = '   ';
    expect(isAllowedEmail('anyone@example.com')).toBe(true);
  });

  it('載っているアドレスだけ通す', () => {
    process.env.ALLOWED_EMAILS = 'me@example.com';
    expect(isAllowedEmail('me@example.com')).toBe(true);
    expect(isAllowedEmail('other@example.com')).toBe(false);
  });

  it('大文字小文字と前後の空白は無視する', () => {
    process.env.ALLOWED_EMAILS = ' Me@Example.com , you@example.com ';
    expect(isAllowedEmail('me@example.COM')).toBe(true);
    expect(isAllowedEmail('  you@example.com  ')).toBe(true);
    expect(isAllowedEmail('them@example.com')).toBe(false);
  });

  it('部分一致では通さない', () => {
    process.env.ALLOWED_EMAILS = 'me@example.com';
    expect(isAllowedEmail('me@example.com.attacker.test')).toBe(false);
    expect(isAllowedEmail('notme@example.com')).toBe(false);
  });
});
