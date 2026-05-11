import { useRef, useState } from "react";

import type { PdfSide, PdfWorkMode, ThemeMode } from "./deckTypes";
import type { AddedCard } from "./useDeckCore";
import { blankRaw, PDF_DEFAULT_WIDTH } from "./useDeckCore";

export type ResourceTemplate = { id: string; title: string; content: string };

export type UseDeckStateProps = {
  initialData?: {
    raw?: string;
    memo?: string;
    output?: string;
    title?: string;
  };
  readOnly?: boolean;
};

export function useDeckEditor(props?: UseDeckStateProps) {
  const { initialData } = props || {};
  const [raw, setRaw] = useState(initialData?.raw ?? blankRaw);
  const [memo, setMemo] = useState(initialData?.memo ?? "");
  const [output, setOutput] = useState(initialData?.output ?? "");
  const [addedCards, setAddedCards] = useState<AddedCard[]>([]);
  const [starred, setStarred] = useState<string[]>([]);

  const [saveStatus, setSaveStatus] = useState("保存済");
  const [copyStatus, setCopyStatus] = useState("");
  const [obsidianToast, setObsidianToast] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [longUrl, setLongUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [deckId, setDeckId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [expandedEditor, setExpandedEditor] = useState<"input" | "memo" | "output" | null>(
    null,
  );
  const [shortcutHint, setShortcutHint] = useState("");
  const [perspectiveIndex, setPerspectiveIndex] = useState(1);

  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const [openTopMenu, setOpenTopMenu] = useState<"more" | "display" | "export" | "resources" | "theme" | null>(null);
  const topMenuRef = useRef<HTMLDivElement | null>(null);
  const memoRef = useRef<HTMLElement | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const [customLinks, setCustomLinks] = useState<{ label: string; url: string }[]>([]);
  const [customLinkLabel, setCustomLinkLabel] = useState("");
  const [customLinkUrl, setCustomLinkUrl] = useState("");
  const [templates, setTemplates] = useState<ResourceTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("free");
  const [templateInstruction, setTemplateInstruction] = useState("");
  const [templateIncludeInput, setTemplateIncludeInput] = useState(true);
  const [templateIncludeMemo, setTemplateIncludeMemo] = useState(false);
  const [templateIncludeOutput, setTemplateIncludeOutput] = useState(false);
  const [newTemplateTitle, setNewTemplateTitle] = useState("");
  const [newTemplateContent, setNewTemplateContent] = useState("");
  const [leftWidth, setLeftWidth] = useState(350);
  const [rightWidth, setRightWidth] = useState(390);
  const [draggingLeft, setDraggingLeft] = useState(false);
  const [draggingRight, setDraggingRight] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfFileName, setPdfFileName] = useState("");
  const [isPdfOpen, setIsPdfOpen] = useState(false);
  const [pdfSide, setPdfSide] = useState<PdfSide>("left");
  const [pdfWidth, setPdfWidth] = useState(PDF_DEFAULT_WIDTH);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfWorkMode, setPdfWorkMode] = useState<PdfWorkMode>("thought");
  const [draggingPdf, setDraggingPdf] = useState(false);

  return {
    raw,
    setRaw,
    memo,
    setMemo,
    output,
    setOutput,
    addedCards,
    setAddedCards,
    starred,
    setStarred,
    saveStatus,
    setSaveStatus,
    copyStatus,
    setCopyStatus,
    obsidianToast,
    setObsidianToast,
    showQr,
    setShowQr,
    shareUrl,
    setShareUrl,
    longUrl,
    setLongUrl,
    qrError,
    setQrError,
    deckId,
    setDeckId,
    selectedCardId,
    setSelectedCardId,
    focusMode,
    setFocusMode,
    expandedEditor,
    setExpandedEditor,
    shortcutHint,
    setShortcutHint,
    perspectiveIndex,
    setPerspectiveIndex,
    showLeft,
    setShowLeft,
    showRight,
    setShowRight,
    showGuide,
    setShowGuide,
    showShortcutHelp,
    setShowShortcutHelp,
    showTemplatePanel,
    setShowTemplatePanel,
    openTopMenu,
    setOpenTopMenu,
    topMenuRef,
    memoRef,
    themeMode,
    setThemeMode,
    customLinks,
    setCustomLinks,
    customLinkLabel,
    setCustomLinkLabel,
    customLinkUrl,
    setCustomLinkUrl,
    templates,
    setTemplates,
    selectedTemplateId,
    setSelectedTemplateId,
    templateInstruction,
    setTemplateInstruction,
    templateIncludeInput,
    setTemplateIncludeInput,
    templateIncludeMemo,
    setTemplateIncludeMemo,
    templateIncludeOutput,
    setTemplateIncludeOutput,
    newTemplateTitle,
    setNewTemplateTitle,
    newTemplateContent,
    setNewTemplateContent,
    leftWidth,
    setLeftWidth,
    rightWidth,
    setRightWidth,
    draggingLeft,
    setDraggingLeft,
    draggingRight,
    setDraggingRight,
    pdfInputRef,
    pdfUrl,
    setPdfUrl,
    pdfFileName,
    setPdfFileName,
    isPdfOpen,
    setIsPdfOpen,
    pdfSide,
    setPdfSide,
    pdfWidth,
    setPdfWidth,
    pdfPage,
    setPdfPage,
    pdfWorkMode,
    setPdfWorkMode,
    draggingPdf,
    setDraggingPdf,
  };
}
