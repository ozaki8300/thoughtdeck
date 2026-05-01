"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";

type QRModalProps = {
  isOpen: boolean;
  title: string;
  shareUrl: string;
  qrError: string;
  onClose: () => void;
  onCopyUrl: () => void;
};

export function QRModal({
  isOpen,
  title,
  shareUrl,
  qrError,
  onClose,
  onCopyUrl,
}: QRModalProps) {
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
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[680px] flex-col items-center overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 p-4 shadow-2xl sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="mb-1 w-full truncate text-center text-[13pt] font-bold text-white sm:text-[16pt]">
          {title}
        </h2>
        <p className="mb-4 text-center text-[10pt] text-slate-300 sm:text-[11pt]">
          QRまたはURLでDeckを共有
        </p>

        {qrError ? (
          <div className="mb-4 w-full max-w-[520px] rounded-xl border border-slate-600 bg-slate-900 p-4 text-center text-[10.5pt] font-semibold leading-7 text-slate-100 sm:text-[11pt]">
            {qrError}
          </div>
        ) : (
          <div className="w-[min(70vw,240px)] shrink-0 rounded-2xl bg-white p-3 shadow-2xl sm:w-[320px] md:w-[380px]">
            <QRCodeSVG
              value={shareUrl}
              size={420}
              level="L"
              className="block h-auto w-full"
            />
          </div>
        )}

        <div className="mt-4 w-full max-w-[560px] rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-[8.5pt] leading-[1.25] text-slate-100 shadow-2xl sm:text-[9.5pt]">
          <p className="max-h-[3.8em] overflow-hidden break-all">{shareUrl}</p>
        </div>

        <div className="mt-4 grid w-full max-w-[560px] grid-cols-2 gap-3">
          <button
            onClick={() => {
              navigator.clipboard.writeText(shareUrl);
              onCopyUrl();
            }}
            className="min-h-10 rounded-lg border border-slate-500/80 bg-slate-900 px-3 py-2 text-[10.5pt] text-white transition hover:border-slate-200 hover:bg-slate-800 sm:text-[11pt]"
          >
            URLコピー
          </button>
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
