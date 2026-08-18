'use client';

import { UNEXPECTED_ERROR, type ActionResult } from '@/lib/actions/result';
import { useState, useTransition } from 'react';

/**
 * 素の `<form action={サーバー関数}>` の置き換え。
 *
 * 素のフォームは、**失敗しても画面に何も出ない**。Server Action が投げた
 * エラーは本番では digest に置き換わるので、文面はどこにも届かないまま
 * 「押しても何も起きない」ようにしか見えない（lib/actions/result.ts）。
 *
 * 中身（入力欄とボタン）はそのまま受け取り、ここは結果を出すことだけをする。
 * 成功したときの見た目が変わる操作（フォルダの並べ替えなど）は文面が要らない
 * ので、`success` を渡したときだけ出す。
 */
export function ActionForm({
  action,
  children,
  className,
  success,
}: {
  action: (formData: FormData) => Promise<ActionResult<unknown>>;
  children: React.ReactNode;
  className?: string;
  /** 成功したときに出す一言。画面の変化だけで伝わるものには渡さない。 */
  success?: string;
}) {
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className={className}
      action={(formData) => {
        setState(null);
        startTransition(async () => {
          try {
            const r = await action(formData);
            setState(r.ok ? { ok: true, message: success ?? '' } : { ok: false, message: r.message });
          } catch {
            setState({ ok: false, message: UNEXPECTED_ERROR });
          }
        });
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>

      {state && !state.ok && <p className="mt-1 text-xs text-red-400">{state.message}</p>}
      {state?.ok && state.message && (
        <p className="mt-1 text-xs text-emerald-400">{state.message}</p>
      )}
    </form>
  );
}
