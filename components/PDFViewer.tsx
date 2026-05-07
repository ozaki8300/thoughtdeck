"use client";

import type { CSSProperties, ChangeEvent, ReactNode, RefObject } from "react";
import type { PdfSide, PdfWorkMode } from "../lib/deckTypes";

type PDFViewerProps = {
  children: ReactNode;
  pdfInputRef: RefObject<HTMLInputElement | null>;
  pdfUrl: string;
  pdfFileName: string;
  isPdfOpen: boolean;
  pdfSide: PdfSide;
  pdfWidth: number;
  pdfPage: number;
  pdfWorkMode: PdfWorkMode;
  draggingPdf: boolean;
  raw: string;
  memo: string;
  output: string;
  panelButtonClass: string;
  onPdfFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPdfDragMove: (clientX: number) => void;
  onStopPdfDrag: () => void;
  onStartPdfDrag: () => void;
  onPdfPageChange: (page: number) => void;
  onPdfSideChange: (side: PdfSide) => void;
  onPdfWorkModeChange: (mode: PdfWorkMode) => void;
  onRawChange: (value: string) => void;
  onMemoChange: (value: string) => void;
  onOutputChange: (value: string) => void;
  onHidePdf: () => void;
  onOpenPdfPicker: () => void;
  onClearPdf: () => void;
  renderThoughtArea: () => ReactNode;
};

export function PDFViewer({
  children,
  pdfInputRef,
  pdfUrl,
  pdfFileName,
  isPdfOpen,
  pdfSide,
  pdfWidth,
  pdfPage,
  pdfWorkMode,
  draggingPdf,
  raw,
  memo,
  output,
  panelButtonClass,
  onPdfFileChange,
  onPdfDragMove,
  onStopPdfDrag,
  onStartPdfDrag,
  onPdfPageChange,
  onPdfSideChange,
  onPdfWorkModeChange,
  onRawChange,
  onMemoChange,
  onOutputChange,
  onHidePdf,
  onOpenPdfPicker,
  onClearPdf,
  renderThoughtArea,
}: PDFViewerProps) {
  const renderPdfPanel = () => {
    if (!pdfUrl || !isPdfOpen) return null;

    const pdfFrameSrc = `${pdfUrl}#page=${pdfPage}`;

    return (
      <aside
        className="hidden min-h-0 shrink-0 overflow-hidden border-[var(--td-border)] bg-[var(--td-panel)] lg:flex lg:w-[var(--pdf-width)] lg:flex-col"
        style={{ "--pdf-width": `${pdfWidth}px` } as CSSProperties}
      >
        <div className="flex min-h-[52px] shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--td-border)] px-3 py-2">
          <div className="min-w-[160px] flex-1">
            <p className="truncate text-[10.5pt] font-bold text-[var(--td-text)]">
              PDF
              {pdfFileName ? <span className="ml-2 font-normal text-[var(--td-muted)]">{pdfFileName}</span> : null}
            </p>
            <p className="text-[9pt] text-[var(--td-muted)]">PDF本体は保存しません</p>
          </div>

          <label className="flex shrink-0 items-center gap-2 text-[10pt] text-[var(--td-muted)]">
            ページ
            <input
              type="number"
              min={1}
              value={pdfPage}
              onChange={(event) => onPdfPageChange(Math.max(1, Number(event.target.value) || 1))}
              className="w-16 rounded-lg border border-[var(--td-border)] bg-[var(--td-editor)] px-2 py-1 text-[10pt] text-[var(--td-text)] outline-none focus:border-[var(--td-accent-border)]"
            />
          </label>

          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => onPdfSideChange("left")}
              className={`${panelButtonClass} ${pdfSide === "left" ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]" : ""}`}
              title="PDFを左に表示"
            >
              左
            </button>
            <button
              onClick={() => onPdfSideChange("right")}
              className={`${panelButtonClass} ${pdfSide === "right" ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]" : ""}`}
              title="PDFを右に表示"
            >
              右
            </button>
            <button onClick={onHidePdf} className={panelButtonClass}>
              非表示
            </button>
            <button onClick={onOpenPdfPicker} className={panelButtonClass}>
              変更
            </button>
            <button onClick={onClearPdf} className={panelButtonClass}>
              解除
            </button>
          </div>
        </div>

        <iframe
          key={`${pdfUrl}-${pdfPage}`}
          src={pdfFrameSrc}
          className={`min-h-0 w-full flex-1 bg-white ${draggingPdf ? "pointer-events-none" : ""}`}
          title="ThoughtDeck PDF Viewer"
        />
      </aside>
    );
  };

  const renderPdfDivider = () => {
    if (!pdfUrl || !isPdfOpen) return null;

    return (
      <div
        onMouseDown={(event) => {
          event.preventDefault();
          onStartPdfDrag();
        }}
        title="ドラッグしてPDF幅を調整"
        className={`group hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center bg-transparent transition lg:flex ${
          draggingPdf ? "bg-[var(--td-hover)]" : "hover:bg-[var(--td-hover)]"
        }`}
      >
        <div
          className={`h-full w-[2px] transition ${
            draggingPdf ? "bg-[var(--td-accent)]" : "bg-[var(--td-border)] group-hover:bg-[var(--td-accent-border)]"
          }`}
        />
      </div>
    );
  };

  const pdfModeButtonClass = (mode: PdfWorkMode) =>
    `rounded-lg border px-3 py-1.5 text-[10.5pt] transition ${
      pdfWorkMode === mode
        ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]"
        : "border-[var(--td-border-strong)] text-[var(--td-text-soft)] hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
    }`;

  const renderPdfWorkspace = () => {
    const editorTitle =
      pdfWorkMode === "input" ? "インプット" : pdfWorkMode === "memo" ? "メモ" : "投稿文";
    const editorValue = pdfWorkMode === "input" ? raw : pdfWorkMode === "memo" ? memo : output;
    const setEditorValue = pdfWorkMode === "input" ? onRawChange : pdfWorkMode === "memo" ? onMemoChange : onOutputChange;
    const editorPlaceholder =
      pdfWorkMode === "input"
        ? "PDFを見ながら、構造化する内容を書きます..."
        : pdfWorkMode === "memo"
          ? "PDFを見ながら、気づき・違和感・発言メモを自由に書きます..."
          : "PDFとカードを見ながら、投稿文を書きます...";

    return (
      <section className="no-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--td-bg)]">
        <div className="flex min-h-[54px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--td-border)] px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[10.5pt] text-[var(--td-muted)]">表示</span>
            <button onClick={() => onPdfWorkModeChange("thought")} className={pdfModeButtonClass("thought")}>思考</button>
            <button onClick={() => onPdfWorkModeChange("input")} className={pdfModeButtonClass("input")}>Input</button>
            <button onClick={() => onPdfWorkModeChange("memo")} className={pdfModeButtonClass("memo")}>メモ</button>
            <button onClick={() => onPdfWorkModeChange("output")} className={pdfModeButtonClass("output")}>投稿</button>
          </div>
          <p className="text-[10pt] text-[var(--td-muted)]">PDF表示中は、右側を作業モードに切り替えます</p>
        </div>

        {pdfWorkMode === "thought" ? (
          renderThoughtArea()
        ) : (
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10.5pt] text-[var(--td-muted)]">PDFを見ながら書く</p>
                <h2 className="text-[14pt] font-bold text-[var(--td-text)]">{editorTitle}</h2>
              </div>
              <span className="text-[10.5pt] text-[var(--td-muted)]">文字数：{editorValue.length}</span>
            </div>
            <textarea
              autoFocus
              value={editorValue}
              onChange={(event) => setEditorValue(event.target.value)}
              placeholder={editorPlaceholder}
              className={`no-scrollbar min-h-0 flex-1 resize-none overflow-y-auto rounded-2xl border border-[var(--td-border-strong)] bg-[var(--td-editor)] p-5 text-[var(--td-text)] outline-none focus:border-[var(--td-accent-border)] ${
                pdfWorkMode === "input" ? "font-mono text-[11.5pt] leading-7" : "text-[12.5pt] leading-8"
              }`}
            />
          </div>
        )}
      </section>
    );
  };

  return (
    <>
      {draggingPdf && (
        <div
          className="fixed inset-0 z-[70] cursor-col-resize bg-transparent"
          style={{ userSelect: "none" }}
          onMouseMove={(event) => onPdfDragMove(event.clientX)}
          onMouseUp={onStopPdfDrag}
          onMouseLeave={onStopPdfDrag}
          title="ドラッグしてPDF幅を調整"
        />
      )}

      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={onPdfFileChange}
      />

      {pdfSide === "left" && isPdfOpen && renderPdfPanel()}
      {pdfSide === "left" && isPdfOpen && renderPdfDivider()}

      {pdfUrl && isPdfOpen ? renderPdfWorkspace() : children}

      {pdfSide === "right" && isPdfOpen && renderPdfDivider()}
      {pdfSide === "right" && isPdfOpen && renderPdfPanel()}
    </>
  );
}
