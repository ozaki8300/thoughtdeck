"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function Home() {
  const router = useRouter();
  const [hasDeck, setHasDeck] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("thoughtdeck:mydecks:v1");
      setHasDeck(!!saved);
    } catch {
      setHasDeck(false);
    }

    // アニメーション開始
    setTimeout(() => setShow(true), 100);
  }, []);

  return (
    <main
      data-theme="auto"
      className="flex min-h-screen -mt-4 items-center justify-center bg-[var(--td-bg)] text-[var(--td-text)] sm:mt-0"
    >
      <div className="flex flex-col items-center gap-6 text-center">

        {/* タイトル */}
        <h1
          className={`text-4xl font-bold transition-all duration-700 ${
            show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          ThoughtDeck
        </h1>

        {/* サブコピー */}
        <p
          className={`text-sm opacity-70 transition-all duration-700 delay-200 ${
            show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          Think. Deck. Share.
        </p>

        {/* サブライン */}
        <p
          className={`text-xs opacity-50 transition-all duration-700 delay-300 ${
            show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          思考を、構造化する。
        </p>

        {/* ボタン */}
        <div
          className={`flex flex-col gap-4 mt-6 transition-all duration-700 delay-500 ${
            show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <button
            onClick={() => router.push("/thoughtdeck")}
            className="hidden sm:block rounded-lg border border-[var(--td-accent-border)] px-6 py-3 transition hover:bg-[var(--td-hover)]"
          >
            Start Thinking
          </button>

          {hasDeck && (
            <button
              onClick={() => router.push("/mydecks")}
              className="rounded-lg border border-[var(--td-accent-border)] px-6 py-3 text-sm transition hover:bg-[var(--td-hover)]"
            >
              Open My Decks
            </button>
          )}
        </div>

      </div>
    </main>
  );
}
