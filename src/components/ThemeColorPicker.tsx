'use client';

import { useSyncExternalStore } from 'react';

export const THEME_COLOR_KEY = 'rsstube:theme-color';

export type ThemeColorId = 'cyan' | 'blue' | 'emerald' | 'amber' | 'violet' | 'rose';

export interface ThemeColorOption {
  id: ThemeColorId;
  label: string;
  dotColor: string;
}

export const THEME_COLORS: ThemeColorOption[] = [
  {
    id: 'cyan',
    label: 'シアン（標準）',
    dotColor: '#06b6d4',
  },
  {
    id: 'blue',
    label: 'インディゴブルー',
    dotColor: '#6366f1',
  },
  {
    id: 'emerald',
    label: 'エメラルドグリーン',
    dotColor: '#10b981',
  },
  {
    id: 'amber',
    label: 'アンバーオレンジ',
    dotColor: '#f59e0b',
  },
  {
    id: 'violet',
    label: 'パープルバイオレット',
    dotColor: '#a855f7',
  },
  {
    id: 'rose',
    label: 'ローズピンク',
    dotColor: '#f43f5e',
  },
];

export const DEFAULT_THEME_COLOR: ThemeColorId = 'cyan';

function read(): ThemeColorId {
  try {
    const raw = localStorage.getItem(THEME_COLOR_KEY);
    return THEME_COLORS.some((c) => c.id === raw) ? (raw as ThemeColorId) : DEFAULT_THEME_COLOR;
  } catch {
    return DEFAULT_THEME_COLOR;
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function applyThemeColor(id: ThemeColorId) {
  document.documentElement.setAttribute('data-accent', id);
  try {
    localStorage.setItem(THEME_COLOR_KEY, id);
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

export function ThemeColorPicker() {
  const current = useSyncExternalStore(subscribe, read, () => DEFAULT_THEME_COLOR);

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3">
      <p className="mb-3 text-xs text-zinc-400">
        ボタン、未読バッジ、選択枠、AI要約カードなどに適用されるアクセントカラーを選べます。
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {THEME_COLORS.map((color) => {
          const isSelected = color.id === current;
          return (
            <button
              key={color.id}
              type="button"
              onClick={() => applyThemeColor(color.id)}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition cursor-pointer ${
                isSelected
                  ? 'border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] text-zinc-100 shadow-sm'
                  : 'border-zinc-800/80 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800/50 hover:text-zinc-200'
              }`}
            >
              <span
                className="size-3.5 rounded-full shrink-0 shadow-sm ring-1 ring-white/10"
                style={{ backgroundColor: color.dotColor }}
              />
              <span className="text-xs font-medium truncate">{color.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
