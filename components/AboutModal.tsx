"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

type AboutModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex min-h-[100dvh] items-center justify-center overflow-hidden bg-black/70 px-4 py-6 text-slate-100 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          <h2 className="mb-3 w-full text-center text-[13pt] font-bold text-white sm:text-[16pt]">
            About ThoughtDeck
          </h2>
          <p className="mb-5 text-center text-[10pt] text-slate-300 sm:text-[11pt]">
            Think. Deck. Share.
          </p>

          <div className="space-y-4 text-[10.5pt] leading-7 text-slate-100 sm:text-[11pt]">
            <p>ThoughtDeckは、思考を整理し、構造化し、その場で共有するためのWebアプリです。</p>

            <hr className="border-slate-700" />

            <div>
              <p>Version: v0.1</p>
              <p>Developed by K</p>
            </div>

            <p>© 2026 ThoughtDeck. All rights reserved.</p>

            <hr className="border-slate-700" />

            <div>
              <p>本サービスの利用により生じたいかなる損害についても、開発者は責任を負いません。</p>
              <p>予告なく仕様変更・停止する場合があります。</p>
            </div>

            <div>
              <p>入力されたデータは、ローカルまたは一時的にサーバーへ保存される場合があります。</p>
              <p>個人を特定する目的では利用しません。</p>
            </div>

            <div>
              <p>共有URLを知っている人は内容にアクセスできます。</p>
              <p>共有された内容は、閲覧者によって再共有される可能性があります。</p>
              <p>公開範囲を十分にご確認のうえ、ご利用ください。</p>
            </div>

            <p>機密情報の取り扱いにはご注意ください。</p>

            <p>外部アプリ（Obsidian等）との連携はユーザーの責任で行ってください。</p>
          </div>
        </div>

        <div className="mt-4 grid w-full grid-cols-1 gap-3">
          <button
            onClick={onClose}
            className="min-h-10 rounded-lg border border-slate-500/80 bg-slate-900 px-3 py-2 text-[10.5pt] text-white transition hover:border-slate-200 hover:bg-slate-800 sm:text-[11pt]"
          >
            閉じる
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
