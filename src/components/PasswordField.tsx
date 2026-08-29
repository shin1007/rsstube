'use client';

import { useId, useState } from 'react';

/**
 * パスワードの入力欄と、伏せ字を外すボタン。
 *
 * スマホで長いパスワードを打つと、伏せ字のままでは打ち間違いに気づけない。
 * パスワードマネージャを使えない場面（別の端末から入るとき、初回の設定）が
 * 必ずあるので、目で確かめられるようにしておく。
 *
 * **`type="button"` を落とさないこと。** フォームの中のボタンは既定で submit なので、
 * 付け忘れると「見る」を押した瞬間にログインが走る（しかも入力途中で走るので、
 * 「パスワードが違います」だけが出て理由が分からない）。
 *
 * type を切り替えるだけにしてあるのは、`<input>` の要素そのものを作り替えないため。
 * 条件分岐で2つの input を出し分けると、React が別要素として作り直してしまい、
 * 入力中の値と入力位置（カーソル）が失われる。
 */
export function PasswordField({
  name,
  placeholder,
  autoComplete,
  minLength,
  required,
  defaultVisible = false,
}: {
  name: string;
  placeholder: string;
  /** 'current-password'（ログイン）か 'new-password'（設定・変更）。 */
  autoComplete: string;
  minLength?: number;
  required?: boolean;
  defaultVisible?: boolean;
}) {
  const [visible, setVisible] = useState(defaultVisible);
  const id = useId();

  return (
    <div className="relative">
      <input
        id={id}
        // 伏せ字を外している間も、ブラウザにはパスワード欄だと伝わり続ける
        // （autoComplete が付いているので、保存済みの候補は type を変えても出る）。
        type={visible ? 'text' : 'password'}
        name={name}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        // ボタンのぶんだけ右を空ける。空けないと長いパスワードが文字の下に潜る。
        className="w-full rounded border border-zinc-700 bg-zinc-900 py-2 pl-3 pr-16 text-base"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-controls={id}
        aria-pressed={visible}
        // 指で押せる大きさにする。文字だけだと当たり判定が小さすぎる。
        className="absolute inset-y-0 right-0 px-3 text-xs text-zinc-400 hover:text-zinc-100"
      >
        {visible ? '隠す' : '見る'}
      </button>
    </div>
  );
}
