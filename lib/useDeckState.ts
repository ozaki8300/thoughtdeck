import type { ChangeEvent as ReactChangeEvent, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import { useCallback, useEffect, useMemo } from "react";
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

import type { Area, PdfSide, PdfWorkMode, ThemeMode } from "./deckTypes";
import { buildThoughtDeckMd } from "./buildThoughtDeckMd";
import { getTitle } from "./deckParser";
import { createDeck, updateDeck } from "./deckService";
import { useCloudSave } from "./useCloudSave";
import {
  blankRaw,
  defaultQuickLinks,
  demoOutput,
  demoRaw,
  PDF_MIN_WIDTH,
  parseDeck,
  placeholderSets,
  THOUGHTDECK_HOME_URL,
} from "./useDeckCore";
import type { AddedCard, Card, FocusItem } from "./useDeckCore";
import {
  changeRawCardArea,
  insertBottomSectionTemplate,
  insertCardTemplate,
  insertTopSectionTemplate,
  resolveTextStateAction,
} from "./useDeckActions";
import { useDeckEditor } from "./useDeckEditor";
import type { ResourceTemplate, UseDeckStateProps } from "./useDeckEditor";

export {
  THOUGHTDECK_HOME_URL,
  defaultQuickLinks,
  getActiveAreaEntries,
  getAreaPlaceholder,
  getDynamicColumnClass,
  nextThemeMode,
  themeLabel,
} from "./useDeckCore";
export type { Card, OneColumnSection } from "./useDeckCore";
export type { UseDeckStateProps } from "./useDeckEditor";

export type DeckState = {
  raw: string;
  memo: string;
  output: string;
  addedCards: AddedCard[];
  starred: string[];
};

export const STORAGE_KEY = "thoughtdeck:data:v9";
export const LEGACY_STORAGE_KEYS = ["thoughtdeck:v8", "thoughtdeck:v7", "thoughtdeck:v6"];
export const RESOURCES_STORAGE_KEY = "thoughtdeck:resources:v1";
export const LEGACY_CUSTOM_LINKS_STORAGE_KEY = "thoughtdeck:custom-links:v1";
export const MAX_URL_LENGTH = 3000;
export const QR_MAX_URL_LENGTH = 2900;

export type ResourceState = { links: { label: string; url: string }[]; templates: ResourceTemplate[] };
export const THEME_STORAGE_KEY = "thoughtdeck:theme:v2";
export const PDF_VIEW_STORAGE_KEY = "thoughtdeck:pdf-view:v1";
export const getPdfMaxWidth = () => {
  if (typeof window === "undefined") return 1280;
  return Math.max(980, Math.floor(window.innerWidth * 0.92));
};
export const clampPdfWidth = (value: number) => Math.min(Math.max(value, PDF_MIN_WIDTH), getPdfMaxWidth());

export function encodeDeck(deck: DeckState) {
  return compressToEncodedURIComponent(JSON.stringify(deck));
}

export function decodeDeck(value: string): DeckState | null {
  try {
    const json = decompressFromEncodedURIComponent(value);
    return JSON.parse(json || "{}");
  } catch {
    return null;
  }
}

export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function getTimestampSlug(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

export function sanitizeFileName(value: string) {
  return value
    .replace(/[\/:*?"<>|#^[\]]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

export function getObsidianTitle(title: string, timestamp: string) {
  const safeTitle = sanitizeFileName(title);
  if (!safeTitle || safeTitle === "タイトル" || safeTitle === "タイトル未設定")
    return timestamp;
  return `${timestamp}_${safeTitle}`;
}

export type ThoughtDeckIdKind = "note" | "group" | "card" | "memo";

export const ID_PREFIX_BY_KIND: Record<ThoughtDeckIdKind, string> = {
  note: "td_n",
  group: "td_g",
  card: "td_c",
  memo: "td_m",
};

export function normalizeUuid(rawId: string) {
  return rawId.replace(/-/g, "");
}

export function generatePortableId(kind: ThoughtDeckIdKind) {
  const prefix = ID_PREFIX_BY_KIND[kind];

  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${normalizeUuid(crypto.randomUUID())}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export type ObsidianExportIds = {
  noteId: string;
  groupId: string;
};

export function buildObsidianMetaLines(
  ids: ObsidianExportIds,
  item: { type: "question" | "card" | "summary"; area?: Area },
) {
  const areaLine = item.area ? `<!-- @area: ${item.area} -->\n` : "";

  return `<!-- @card_id: ${generatePortableId("card")} -->\n<!-- @note_id: ${ids.noteId} -->\n<!-- @group_id: ${ids.groupId} -->\n<!-- @type: ${item.type} -->\n${areaLine}`;
}

export function injectPortableIdsForObsidian(markdown: string, ids: ObsidianExportIds) {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let pendingCardHeading = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^##\s*設問/.test(trimmed)) {
      result.push(line);
      result.push(buildObsidianMetaLines(ids, { type: "question" }).trimEnd());
      continue;
    }

    if (/^##\s*まとめ/.test(trimmed)) {
      result.push(line);
      result.push(buildObsidianMetaLines(ids, { type: "summary" }).trimEnd());
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      pendingCardHeading = true;
      result.push(line);
      continue;
    }

    const areaMatch = trimmed.match(/^@area:\s*(left|center|right)\s*$/);
    if (areaMatch && pendingCardHeading) {
      result.push(
        buildObsidianMetaLines(ids, {
          type: "card",
          area: areaMatch[1] as Area,
        }).trimEnd(),
      );
      pendingCardHeading = false;
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}

export function addedCardToMarkdown(
  card: AddedCard,
  options?: { ids?: ObsidianExportIds; withPortableIds?: boolean },
) {
  const metaLines =
    options?.withPortableIds && options.ids
      ? buildObsidianMetaLines(options.ids, { type: "card", area: card.area })
      : `@area: ${card.area}\n`;

  return `### ${card.title || "見出し"}\n${metaLines}${card.lines.length ? card.lines.join("\n") : "- "}`;
}

export function buildExportMarkdown(
  raw: string,
  addedCards: AddedCard[],
  memo: string,
  output = "",
  includeFooter = true,
  withPortableIds = false,
  ids?: ObsidianExportIds,
) {
  const activeIds =
    ids ??
    (withPortableIds
      ? {
          noteId: generatePortableId("note"),
          groupId: generatePortableId("group"),
        }
      : undefined);

  const noteMeta =
    withPortableIds && activeIds
      ? `<!-- @note_id: ${activeIds.noteId} -->\n<!-- @group_id: ${activeIds.groupId} -->\n<!-- #${activeIds.groupId} -->\n\n`
      : "";

  const added =
    addedCards.length > 0
      ? [
          "",
          "---",
          "",
          "## 授業中に追加したカード",
          "",
          ...addedCards.map((card) =>
            addedCardToMarkdown(card, {
              ids: activeIds,
              withPortableIds,
            }),
          ),
        ].join("\n")
      : "";

  const footer = includeFooter
    ? `\n\n---\n\n作成元: ThoughtDeck\n保存日時: ${new Date().toLocaleString("ja-JP")}\n`
    : "";

  const sourceMarkdown =
    withPortableIds && activeIds
      ? injectPortableIdsForObsidian(raw.trimEnd(), activeIds)
      : raw.trimEnd();

  const memoMeta =
    withPortableIds && activeIds
      ? `<!-- @memo_id: ${generatePortableId("memo")} -->\n<!-- @note_id: ${activeIds.noteId} -->\n<!-- @group_id: ${activeIds.groupId} -->\n<!-- @type: memo -->\n\n`
      : "";

  const outputSection = output.trim()
    ? `\n\n---\n\n## 投稿文\n${output.trim()}`
    : "";

  return `${noteMeta}${sourceMarkdown}${added}\n\n---\n\n## メモ\n${memoMeta}${memo.trim() || "（メモなし）"}${outputSection}${footer}`;
}

export function buildRestoreUrl(
  raw: string,
  memo: string,
  output: string,
  addedCards: AddedCard[],
  starred: string[],
) {
  if (typeof window === "undefined") return "";
  const base = `${window.location.origin}${window.location.pathname}`;
  const deck: DeckState = { raw, memo, output, addedCards, starred };
  return `${base}?d=${encodeDeck(deck)}`;
}

export function formatObsidianTimestamp(date = new Date()) {
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function buildObsidianMarkdown(
  raw: string,
  addedCards: AddedCard[],
  memo: string,
  output: string,
  starred: string[],
) {
  const restoreUrl = buildRestoreUrl(raw, memo, output, addedCards, starred);
  const title = getTitle(raw);
  const ids: ObsidianExportIds = {
    noteId: generatePortableId("note"),
    groupId: generatePortableId("group"),
  };
  const body = buildExportMarkdown(raw, addedCards, memo, output, false, true, ids).trimEnd();

  const frontmatter = `---\nthoughtdeck_note_id: ${ids.noteId}\nthoughtdeck_group_id: ${ids.groupId}\ntags:\n  - thoughtdeck\n  - ${ids.groupId}\n---`;

  return `${frontmatter}\n\n[${title}](${restoreUrl})\n\n${body}\n\n---\n\n作成元: ThoughtDeck\n保存日時: ${formatObsidianTimestamp()}\n[thought-deck](${THOUGHTDECK_HOME_URL})\n`;
}


export function useDeckState(props?: UseDeckStateProps) {
  const {
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
  } = useDeckEditor(props);

  const hasDParam =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("d");
  const isReadOnly = props?.readOnly === true && !hasDParam;

  const perspective = placeholderSets[perspectiveIndex];

  const openOutputComposer = () => {
    setSelectedCardId("td-output");
    setFocusMode(false);

    // PDFワークスペースへ切り替えるのは、PCでPDFが実際に表示中のときだけ。
    // pdfUrl が残っているだけの状態やスマホでは、投稿エディタを通常モーダルで開く。
    if (pdfUrl && isPdfOpen && !isMobileLike()) {
      setPdfWorkMode("output");
      setExpandedEditor(null);
      return;
    }

    setExpandedEditor("output");
  };

  const openMemoEditor = () => {
    setSelectedCardId("td-memo");
    setFocusMode(false);

    // PDFワークスペースへ切り替えるのは、PCでPDFが実際に表示中のときだけ。
    if (pdfUrl && isPdfOpen && !isMobileLike()) {
      setPdfWorkMode("memo");
      setExpandedEditor(null);
      return;
    }

    setExpandedEditor("memo");
  };

  const baseCardClass =
    "border-[var(--td-card-border)] bg-[var(--td-card-bg)] text-[var(--td-text)] hover:border-[var(--td-card-border-hover)] hover:bg-[var(--td-hover)]";

  const selectedThoughtClass =
    "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] shadow-[inset_3px_0_0_var(--td-accent-shadow)]";

  const mutedQuestionClass = "text-[10.5pt] leading-none text-[var(--td-muted)]";

  const changePerspective = () => {
    setPerspectiveIndex((prev) => (prev + 1) % placeholderSets.length);
  };

  const openInputEditor = () => {
    // PDFワークスペースへ切り替えるのは、PCでPDFが実際に表示中のときだけ。
    if (pdfUrl && isPdfOpen && !isMobileLike()) {
      setPdfWorkMode("input");
      setSelectedCardId(null);
      setFocusMode(false);
      setExpandedEditor(null);
      return;
    }

    setExpandedEditor("input");
  };

  const parsedDeck = useMemo(() => parseDeck(raw), [raw]);
  const { title, topSections, bottomSections } = parsedDeck;
  const getLatestCloudDeck = useCallback(
    () => ({ title, raw, memo, output }),
    [title, raw, memo, output],
  );
  const { markDirty } = useCloudSave({
    deckId,
    getLatest: getLatestCloudDeck,
  });
  const parsedCards = parsedDeck.cards;
  const allCards = useMemo<Card[]>(
    () => [...parsedCards, ...addedCards],
    [parsedCards, addedCards],
  );
  const focusItems = useMemo<FocusItem[]>(() => {
    const cardLabel = (area: Area) =>
      area === "left" ? "事実" : area === "center" ? "解釈" : "論点";

    return [
      ...topSections.map((section) => ({
        ...section,
        focusKind: "section" as const,
        focusLabel: "設問",
      })),
      ...allCards.map((card) => ({
        ...card,
        focusKind: "card" as const,
        focusLabel: cardLabel(card.area),
      })),
      ...bottomSections.map((section) => ({
        ...section,
        focusKind: "section" as const,
        focusLabel: "結論",
      })),
    ];
  }, [topSections, allCards, bottomSections]);

  const allQuickLinks = useMemo(
    () => [...defaultQuickLinks, ...customLinks],
    [customLinks],
  );

  const addCustomLink = () => {
    const label = customLinkLabel.trim();
    let url = customLinkUrl.trim();
    if (!label || !url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    setCustomLinks((prev) => [...prev, { label, url }]);
    setCustomLinkLabel("");
    setCustomLinkUrl("");
    showShortcutHint("追加リンクしました");
  };

  const removeCustomLink = (index: number) => {
    setCustomLinks((prev) => prev.filter((_, i) => i !== index));
  };


  const copyTextSafely = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  const isMobileLike = () => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768 || window.matchMedia?.("(pointer: coarse)").matches;
  };

  const toggleMemoAndScroll = () => {
    const isMobile = isMobileLike();

    if (showRight) {
      setShowRight(false);
      if (selectedCardId === "td-memo") setSelectedCardId(null);
      return;
    }

    setShowRight(true);
    setSelectedCardId("td-memo");
    setFocusMode(false);

    if (!isMobile) return;

    window.setTimeout(() => {
      memoRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 120);
  };

  const handleResourceLinkClick = async (event: ReactMouseEvent<HTMLAnchorElement>, url: string) => {
    event.stopPropagation();

    if (isMobileLike()) {
      event.preventDefault();
      await copyTextSafely(url);
      showShortcutHint("URLをコピーしました");
      window.setTimeout(() => setOpenTopMenu(null), 250);
      return;
    }

    window.setTimeout(() => setOpenTopMenu(null), 300);
  };

  const addTemplate = () => {
    const title = newTemplateTitle.trim();
    const content = newTemplateContent.trim();
    if (!title || !content) return;
    const id = `tpl-${Date.now()}`;
    setTemplates((prev) => [...prev, { id, title, content }]);
    setSelectedTemplateId(id);
    setNewTemplateTitle("");
    setNewTemplateContent("");
    showShortcutHint("テンプレを追加しました");
  };

  const removeTemplate = (id: string) => {
    setTemplates((prev) => prev.filter((template) => template.id !== id));
    if (selectedTemplateId === id) setSelectedTemplateId("free");
  };

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || null;

  const cardBlocks = useMemo(() => {
    const blockMap = new Map<number, Card[]>();

    allCards.forEach((card) => {
      const blockKey = card.visualGroup ?? 0;
      const existing = blockMap.get(blockKey) ?? [];
      existing.push(card);
      blockMap.set(blockKey, existing);
    });

    return Array.from(blockMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([visualGroup, cards]) => ({
        visualGroup,
        left: cards.filter((card) => card.area === "left"),
        center: cards.filter((card) => card.area === "center"),
        right: cards.filter((card) => card.area === "right"),
      }));
  }, [allCards]);
  const selectedCard =
    allCards.find((card) => card.id === selectedCardId) || null;
  const selectedFocusItem =
    focusItems.find((item) => item.id === selectedCardId) || null;

  const showShortcutHint = (message: string) => {
    setShortcutHint(message);
    window.setTimeout(() => setShortcutHint(""), 1200);
  };

  const markCloudDirty = () => {
    markDirty();
  };

  const setRawWithCloudDirty = (value: SetStateAction<string>) => {
    const next = resolveTextStateAction(value, raw);
    if (next !== raw) markCloudDirty();
    setRaw(next);
  };

  const setMemoWithCloudDirty = (value: SetStateAction<string>) => {
    const next = resolveTextStateAction(value, memo);
    if (next !== memo) markCloudDirty();
    setMemo(next);
  };

  const setOutputWithCloudDirty = (value: SetStateAction<string>) => {
    const next = resolveTextStateAction(value, output);
    if (next !== output) markCloudDirty();
    setOutput(next);
  };

  const moveCardToArea = (cardId: string | null, nextArea: Area) => {
    if (!cardId) return;

    const target = allCards.find((card) => card.id === cardId);
    if (!target) return;

    if (target.source === "raw") {
      setRawWithCloudDirty((prev) => changeRawCardArea(prev, cardId, nextArea));
    } else {
      setAddedCards((prev) =>
        prev.map((card) =>
          card.id === cardId ? { ...card, area: nextArea } : card,
        ),
      );
    }

    setSelectedCardId(cardId);
    showShortcutHint(`${target.title} → ${nextArea}`);
  };

  const selectSiblingCard = (direction: 1 | -1) => {
    if (allCards.length === 0) return;

    const currentIndex = selectedCardId
      ? allCards.findIndex((card) => card.id === selectedCardId)
      : -1;
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + direction + allCards.length) % allCards.length;

    setSelectedCardId(allCards[nextIndex].id);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("d");

    if (d) {
      const decoded = decodeDeck(d);
      if (decoded) {
        setRaw(decoded.raw || blankRaw);
        setMemo(decoded.memo || "");
        setOutput(decoded.output || "");
        setAddedCards(decoded.addedCards || []);
        setStarred(decoded.starred || []);
        setShowLeft(false);
        setShowRight(false);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(decoded));
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }
    }

    const saved = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    if (saved) {
      try {
        const deck = JSON.parse(saved) as DeckState;
        setRaw(deck.raw || blankRaw);
        setMemo(deck.memo || "");
        setOutput(deck.output || "");
        setAddedCards(deck.addedCards || []);
        setStarred(deck.starred || []);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    try {
      const savedResources = localStorage.getItem(RESOURCES_STORAGE_KEY);
      if (savedResources) {
        const resources = JSON.parse(savedResources) as ResourceState;
        setCustomLinks(resources.links || []);
        setTemplates(resources.templates || []);
        return;
      }

      const legacyLinks = localStorage.getItem(LEGACY_CUSTOM_LINKS_STORAGE_KEY);
      if (legacyLinks) setCustomLinks(JSON.parse(legacyLinks));
    } catch {
      localStorage.removeItem(RESOURCES_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
      if (savedTheme === "auto" || savedTheme === "light" || savedTheme === "dark") {
        setThemeMode(savedTheme);
      }
    } catch {
      localStorage.removeItem(THEME_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      const savedPdfView = localStorage.getItem(PDF_VIEW_STORAGE_KEY);
      if (!savedPdfView) return;
      const config = JSON.parse(savedPdfView) as Partial<{ side: PdfSide; width: number; page: number; workMode: PdfWorkMode; isOpen: boolean }>;
      if (config.side === "left" || config.side === "right") setPdfSide(config.side);
      if (typeof config.width === "number") setPdfWidth(clampPdfWidth(config.width));
      if (typeof config.page === "number") setPdfPage(Math.max(1, Math.floor(config.page)));
      if (config.workMode === "thought" || config.workMode === "input" || config.workMode === "memo" || config.workMode === "output") setPdfWorkMode(config.workMode);
      if (typeof config.isOpen === "boolean") setIsPdfOpen(config.isOpen);
    } catch {
      localStorage.removeItem(PDF_VIEW_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem(
      PDF_VIEW_STORAGE_KEY,
      JSON.stringify({ side: pdfSide, width: pdfWidth, page: pdfPage, workMode: pdfWorkMode, isOpen: isPdfOpen }),
    );
  }, [pdfSide, pdfWidth, pdfPage, pdfWorkMode, isPdfOpen]);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  useEffect(() => {
    localStorage.setItem(
      RESOURCES_STORAGE_KEY,
      JSON.stringify({ links: customLinks, templates }),
    );
  }, [customLinks, templates]);

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (!openTopMenu) return;
      const target = event.target as Node;
      if (target instanceof Element && target.closest("[data-td-menu-root]")) return;
      if (topMenuRef.current && !topMenuRef.current.contains(target)) {
        setOpenTopMenu(null);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [openTopMenu]);

  useEffect(() => {
    setSaveStatus("保存中");
    const timer = window.setTimeout(() => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ raw, memo, output, addedCards, starred }),
      );
      setSaveStatus("保存済");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [raw, memo, output, addedCards, starred]);

  useEffect(() => {
    if (!draggingLeft) return;
    const onMove = (e: globalThis.MouseEvent) =>
      setLeftWidth(Math.min(Math.max(e.clientX, 260), 680));
    const onUp = () => setDraggingLeft(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingLeft]);

  useEffect(() => {
    if (!draggingRight) return;
    const onMove = (e: globalThis.MouseEvent) =>
      setRightWidth(
        Math.min(Math.max(window.innerWidth - e.clientX, 260), 680),
      );
    const onUp = () => setDraggingRight(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingRight]);

  const updatePdfWidthFromClientX = (clientX: number) => {
    const nextWidth = pdfSide === "left" ? clientX : window.innerWidth - clientX;
    setPdfWidth(clampPdfWidth(nextWidth));
  };

  useEffect(() => {
    if (!draggingPdf) return;

    const onMove = (e: globalThis.MouseEvent) => updatePdfWidthFromClientX(e.clientX);
    const onUp = () => setDraggingPdf(false);
    const onBlur = () => setDraggingPdf(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [draggingPdf, pdfSide]);

  const openPdfPicker = () => {
    if (isMobileLike()) {
      showShortcutHint("PDF表示はPCで利用できます");
      return;
    }
    pdfInputRef.current?.click();
  };

  const handlePdfFileChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    const nextUrl = URL.createObjectURL(file);
    setPdfUrl(nextUrl);
    setPdfFileName(file.name);
    setIsPdfOpen(true);
    showShortcutHint("PDFを開きました");

    event.target.value = "";
  };

  const hidePdf = () => {
    if (!pdfUrl) return;
    setIsPdfOpen(false);
    setDraggingPdf(false);
    showShortcutHint("PDFを非表示にしました");
  };

  const clearPdf = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl("");
    setPdfFileName("");
    setIsPdfOpen(false);
    setDraggingPdf(false);
    showShortcutHint("PDFを解除しました");
  };

  const togglePdf = () => {
    if (!pdfUrl) {
      openPdfPicker();
      return;
    }

    setIsPdfOpen((prev) => {
      const next = !prev;
      showShortcutHint(next ? "PDFを表示しました" : "PDFを非表示にしました");
      return next;
    });
  };

  const createShare = async () => {
    if (isReadOnly) return;

    try {
      let id = deckId;

      // 初回だけINSERT
      if (!id) {
        try {
          id = await createDeck({ title, raw, memo, output });
        } catch (error) {
          console.error("INSERT ERROR:", error);
          return;
        }

        setDeckId(id);
      } 
      // 2回目以降はUPDATE（←ここが追加）
      else {
        try {
          await updateDeck(id, { title, raw, memo, output });
        } catch (error) {
          console.error("UPDATE ERROR:", error);
          return;
        }
      }

      markDirty(false);

      const deckPath = `/deck/${id}`;
      const url = `${window.location.origin}${deckPath}`;
      const longUrl = buildRestoreUrl(raw, memo, output, addedCards, starred);

      setShareUrl(url);
      setLongUrl(longUrl);
      setQrError("");
      setShowQr(true);

      await navigator.clipboard.writeText(url);

    } catch (e) {
      console.error(e);
    }
  };

  const downloadMd = () => {
    const md = buildThoughtDeckMd({ raw, memo, output, deckId });
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${new Date().toISOString().slice(0, 10)}_${title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyMd = async () => {
    await navigator.clipboard.writeText(
      buildExportMarkdown(raw, addedCards, memo, output),
    );
    setCopyStatus("MDコピー済");
    window.setTimeout(() => setCopyStatus(""), 1800);
  };

  const saveToObsidian = async () => {
    const md = buildThoughtDeckMd({ raw, memo, output, deckId });
    const timestamp = getTimestampSlug();
    const fileTitle = getObsidianTitle(title, timestamp);
    const filePath = `ThoughtDeck/${fileTitle}`;
    const url = `obsidian://new?file=${encodeURIComponent(filePath)}&clipboard=true&append=true`;

    // 長いMarkdown本文をURIに直接詰めると、ブラウザやOSのURI長制限でObsidianが起動しないことがある。
    // 本文はクリップボードに置き、Obsidian URIの clipboard=true で取り込ませる。
    await copyTextSafely(md);
    setObsidianToast(`Obsidianに保存します：${fileTitle}`);
    window.setTimeout(() => setObsidianToast(""), 2600);
    window.location.href = url;
  };

  const clearAll = () => {
    if (isReadOnly) return;

    if (!confirm("全ての内容をまっさらにしますか？")) return;

    setRaw(blankRaw);
    setMemo("");
    setOutput("");
    setAddedCards([]);
    setStarred([]);

    setShareUrl("");
    setLongUrl("");
    setQrError("");
    setShowQr(false);

    setSelectedCardId(null);
    setFocusMode(false);
    setShowLeft(false);
    setShowRight(false);

    setDeckId(null); // ← ★これが足りなかった

    localStorage.removeItem(STORAGE_KEY);
  };

  const loadDemo = () => {
    setRaw(demoRaw);
    setMemo("");
    setOutput(demoOutput);
    setAddedCards([]);
    setStarred([]);
    setShareUrl("");
    setLongUrl("");
    setQrError("");
    setShowQr(false);
    setSelectedCardId(null);
    setFocusMode(false);
    setShowLeft(false);
    setShowRight(false);
  };

  const confirmLoadDemo = () => {
    const ok = window.confirm(
      "現在のInput・メモ・投稿文がデモ内容で上書きされます。よろしいですか？",
    );

    if (!ok) return;

    loadDemo();
  };

  const insertTemplate = (kind: "top" | Area | "bottom") => {
    if (isReadOnly) return;

    setRawWithCloudDirty((prev) => {
      if (kind === "top") return insertTopSectionTemplate(prev);
      if (kind === "bottom") return insertBottomSectionTemplate(prev);
      return insertCardTemplate(prev, kind);
    });
    setShowLeft(true);
  };

  const toggleStar = (id: string) => {
    setStarred((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const buildTemplateCopyText = () => {
    const sections: string[] = [];
    if (selectedTemplate?.content.trim()) sections.push(selectedTemplate.content.trim());
    if (templateInstruction.trim()) sections.push(templateInstruction.trim());

    const selectedSources: string[] = [];
    if (templateIncludeInput) selectedSources.push(`---\nInput\n---\n${raw.trim() || "（Inputなし）"}`);
    if (templateIncludeMemo) selectedSources.push(`---\nメモ\n---\n${memo.trim() || "（メモなし）"}`);
    if (templateIncludeOutput) selectedSources.push(`---\n投稿文\n---\n${output.trim() || "（投稿文なし）"}`);

    return [...sections, ...selectedSources].join("\n\n");
  };

  const copyTemplateBundle = async () => {
    const text = buildTemplateCopyText();
    await navigator.clipboard.writeText(text);
    setCopyStatus("コピーしました");
    showShortcutHint("コピーしました");
    window.setTimeout(() => setCopyStatus(""), 1200);
  };

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
    perspective,
    openOutputComposer,
    openMemoEditor,
    baseCardClass,
    selectedThoughtClass,
    mutedQuestionClass,
    changePerspective,
    openInputEditor,
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
    parsedDeck,
    title,
    topSections,
    bottomSections,
    parsedCards,
    allCards,
    focusItems,
    allQuickLinks,
    addCustomLink,
    removeCustomLink,
    copyTextSafely,
    isMobileLike,
    toggleMemoAndScroll,
    handleResourceLinkClick,
    addTemplate,
    removeTemplate,
    selectedTemplate,
    cardBlocks,
    selectedCard,
    selectedFocusItem,
    showShortcutHint,
    markCloudDirty,
    setRawWithCloudDirty,
    setMemoWithCloudDirty,
    setOutputWithCloudDirty,
    moveCardToArea,
    selectSiblingCard,
    updatePdfWidthFromClientX,
    openPdfPicker,
    handlePdfFileChange,
    hidePdf,
    clearPdf,
    togglePdf,
    createShare,
    downloadMd,
    copyMd,
    saveToObsidian,
    clearAll,
    loadDemo,
    confirmLoadDemo,
    insertTemplate,
    toggleStar,
    buildTemplateCopyText,
    copyTemplateBundle,
    isReadOnly,
  };
}
