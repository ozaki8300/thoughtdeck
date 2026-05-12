import type { ChangeEvent as ReactChangeEvent, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

import type { Area, PdfSide, PdfWorkMode, ThemeMode } from "./deckTypes";
import { buildThoughtDeckMd } from "./buildThoughtDeckMd";
import {
  buildCurriculumIndex,
  buildCurriculumPath,
  buildRelatedLinks,
  loadCurriculum,
  type CurriculumIndexItem,
} from "./curriculum";
import { getTitle } from "./deckParser";
import { createDeck, createPublicationSnapshot, createWorkspaceRevision, deckExists } from "./deckService";
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
  deckId?: string | null;
  noteId?: string | null;
  groupId?: string | null;
  lineId?: string | null;
  forkedFromDeckId?: string | null;
  curriculumPath?: string | null;
  createdAt?: string;
  updatedAt?: string;
  restoreMode?: "revision" | "fork" | "readonly";
  sourceShareId?: string | null;
  sourceDeckId?: string | null;
  lineage?: {
    rootDeckId?: string | null;
    forkedFromDeckId?: string | null;
    forkedFromVersion?: string | number | null;
    forkedFromShareId?: string | null;
  };
  publicationId?: string | null;
  publishedAt?: string | null;
  shareId?: string | null;
  sharedAt?: string | null;
};

export const STORAGE_KEY = "thoughtdeck:data:v9";
export const LEGACY_STORAGE_KEYS = ["thoughtdeck:v8", "thoughtdeck:v7", "thoughtdeck:v6"];
export const RESOURCES_STORAGE_KEY = "thoughtdeck:resources:v1";
export const LEGACY_CUSTOM_LINKS_STORAGE_KEY = "thoughtdeck:custom-links:v1";
const MYDECKS_KEY = "thoughtdeck:mydecks:v1";
export const MAX_URL_LENGTH = 3000;
export const QR_MAX_URL_LENGTH = 2900;
const ENABLE_FREE_INPUT = true;
const LINE_REGISTRY_KEY =
  "td_line_registry";
const LINE_STATE_KEY =
  "td_line_state_v1";

export type ResourceState = { links: { label: string; url: string }[]; templates: ResourceTemplate[] };
type LineRegistry = Record<
  string,
  string[]
>;
type ThoughtCard = AddedCard;
type PersistedLineState = {
  raw: string;
  memo: string;
  output: string;
  addedCards: ThoughtCard[];
  starred: string[];
};

type LineStateMap = Record<
  string,
  PersistedLineState
>;
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

function loadLineRegistry(): LineRegistry {
  if (typeof window === "undefined") return {};

  try {
    const saved = localStorage.getItem(LINE_REGISTRY_KEY);
    return saved ? JSON.parse(saved) as LineRegistry : {};
  } catch {
    localStorage.removeItem(LINE_REGISTRY_KEY);
    return {};
  }
}

function saveLineRegistry(
  registry: LineRegistry,
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    LINE_REGISTRY_KEY,
    JSON.stringify(registry),
  );
}

export function registerLine(
  groupId: string,
  lineId: string,
) {
  const normalizedGroupId = groupId.trim();
  const normalizedLineId = lineId.trim();

  if (!normalizedGroupId || !normalizedLineId) return;

  const registry = loadLineRegistry();
  const lines = registry[normalizedGroupId] ?? [];

  if (lines.includes(normalizedLineId)) return;

  registry[normalizedGroupId] = [
    ...lines,
    normalizedLineId,
  ];
  saveLineRegistry(registry);
}

function buildLineStateKey(
  groupId: string,
  lineId: string,
) {
  return `${groupId}:${lineId}`;
}

function loadLineStateMap(): LineStateMap {
  if (typeof window === "undefined") return {};

  try {
    const saved = localStorage.getItem(LINE_STATE_KEY);
    return saved ? JSON.parse(saved) as LineStateMap : {};
  } catch {
    localStorage.removeItem(LINE_STATE_KEY);
    return {};
  }
}

function saveLineStateMap(
  map: LineStateMap,
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    LINE_STATE_KEY,
    JSON.stringify(map),
  );
}

type MyDecksLocalItem = {
  title?: string;
  deck_id?: string | null;
  trigger?: string;
  created_at?: string;
};

function generateTriggerPreview(
  raw: string,
  memo: string,
  output: string,
) {
  const clean = (text: string) =>
    text
      .replace(/\n/g, " ")
      .replace(/[#\-*]/g, "")
      .trim();

  // 投稿優先
  if (output?.trim()) {
    return clean(output).slice(0, 60);
  }

  // fallback
  if (memo?.trim()) {
    return clean(memo).slice(0, 60);
  }

  if (raw?.trim()) {
    return clean(raw).slice(0, 60);
  }

  return "（要約なし）";
}

function updateMyDecksLocal(
  title: string,
  deckId?: string | null,
  trigger?: string,
) {
  if (!deckId || typeof window === "undefined") return;

  const deckLite = {
    title,
    deck_id: deckId,
    trigger,
    created_at: new Date().toISOString(),
  };

  try {
    const saved = JSON.parse(localStorage.getItem(MYDECKS_KEY) || "[]") as MyDecksLocalItem[];

    const map = new Map(
      saved.map((d) => [d.deck_id, d]),
    );

    map.set(deckId, deckLite);

    localStorage.setItem(
      MYDECKS_KEY,
      JSON.stringify(Array.from(map.values())),
    );
  } catch {
  }
}

function normalizeInput(input: string) {
  if (/^#\s+/m.test(input) || /^##\s+/m.test(input)) {
    return input;
  }

  if (/^###\s+/m.test(input)) return input;

  const blocks = input
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) return input;

  return blocks
    .map((block) => {
      const lines = block.split("\n");
      const isListOnly = lines.every((line) =>
        line.trim().startsWith("-"),
      );
      const title =
        isListOnly
          ? "メモ"
          : lines[0]?.replace(/^[-*]\s*/, "").trim() || "見出し";
      const body = isListOnly
        ? lines.join("\n")
        : lines.slice(1).join("\n").trim() || "- ";

      return [`### ${title}`, "@area: center", body].join("\n");
    })
    .join("\n\n");
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
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
}

export function getObsidianTitle(title: string, timestamp: string) {
  const safeTitle = sanitizeFileName(title) || "Untitled Deck";
  if (!safeTitle || safeTitle === "タイトル" || safeTitle === "タイトル未設定")
    return `TD_${timestamp}_Untitled Deck.md`;
  return `TD_${timestamp}_${safeTitle}.md`;
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

export function generateWorkspaceId() {
  if (
    typeof crypto !== "undefined" &&
    "randomUUID" in crypto
  ) {
    return crypto.randomUUID();
  }

  return `ws_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export type PublicationSnapshot = {
  publicationId: string;
  publishedAt: string;
};

export type ShareSnapshot = {
  shareId: string;
  sharedAt: string;
};

export function createPublication(
  existing?: Partial<PublicationSnapshot> | null,
): PublicationSnapshot {
  if (
    existing?.publicationId &&
    existing?.publishedAt
  ) {
    return {
      publicationId:
        existing.publicationId,

      publishedAt:
        existing.publishedAt,
    };
  }

  // publication is immutable snapshot identity
  // reuse existing publication whenever possible
  return {
    publicationId:
      generatePortableId("group"),

    publishedAt:
      new Date().toISOString(),
  };
}

export function createShareEntity(
  existing?: Partial<ShareSnapshot> | null,
): ShareSnapshot {
  if (
    existing?.shareId &&
    existing?.sharedAt
  ) {
    return {
      shareId:
        existing.shareId,

      sharedAt:
        existing.sharedAt,
    };
  }

  return {
    shareId:
      generatePortableId("group"),

    sharedAt:
      new Date().toISOString(),
  };
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
  noteId?: string | null,
  publication?: Partial<PublicationSnapshot> | null,
  share?: Partial<ShareSnapshot> | null,
  metadata?: Pick<DeckState, "groupId" | "lineId" | "forkedFromDeckId"> | null,
) {
  if (typeof window === "undefined") return "";
  const base = `${window.location.origin}${window.location.pathname}`;
  const restorePublication =
    createPublication(publication);
  const restoreShare =
    createShareEntity(share);
  const semanticNoteId =
    noteId ||
    metadata?.groupId ||
    generatePortableId("note");
  const deck: DeckState = {
    raw,
    memo,
    output,
    addedCards,
    starred,
    deckId: null,
    noteId:
      semanticNoteId,
    groupId:
      metadata?.groupId ||
      semanticNoteId,
    lineId:
      metadata?.lineId ||
      "main",
    forkedFromDeckId:
      metadata?.forkedFromDeckId ||
      null,
    restoreMode: "readonly",
    sourceDeckId:
      semanticNoteId,
    lineage: {
      rootDeckId:
        semanticNoteId,
      forkedFromDeckId:
        metadata?.forkedFromDeckId ||
        null,
    },
    publicationId:
      restorePublication.publicationId,

    publishedAt:
      restorePublication.publishedAt,
    shareId:
      restoreShare.shareId,
    sharedAt:
      restoreShare.sharedAt,
    sourceShareId: null,
  };
  return `${base}?d=${encodeDeck(deck)}`;
}

export async function createShareSnapshot({
  raw,
  memo,
  output,
  addedCards,
  starred,
  deckId,
  noteId,
  publication,
  groupId,
  lineId,
  forkedFromDeckId,
}: {
  raw: string;
  memo: string;
  output: string;
  addedCards: AddedCard[];
  starred: string[];
  deckId?: string | null;
  noteId?: string | null;
  publication?: Partial<PublicationSnapshot> | null;
  groupId?: string | null;
  lineId?: string | null;
  forkedFromDeckId?: string | null;
}) {
  // workspace runtime persistence identity
  let workspaceId = deckId;
  const title = getTitle(raw);
  const publicationSnapshot =
    createPublication(
      publication,
    );
  const shareSnapshot =
    createShareEntity();

  if (!workspaceId || !(await deckExists(workspaceId))) {
    workspaceId = await createDeck({
      title,
      raw,
      memo,
      output,
    });
  }

  await createWorkspaceRevision({
    deckId: workspaceId,
    title,
    raw,
    memo,
    output,
  });

  await createPublicationSnapshot({
    deckId: workspaceId,
    title,
    raw,
    memo,
    output,
    publicationId:
      publicationSnapshot.publicationId,
    publishedAt:
      publicationSnapshot.publishedAt,
  });
  const semanticNoteId =
    noteId ||
    generatePortableId("note");
  const lineageGroupId =
    groupId ||
    semanticNoteId;
  const activeLineId =
    lineId ||
    "main";
  const activeForkedFromDeckId =
    forkedFromDeckId ||
    null;
  const restoreUrl = buildRestoreUrl(
    raw,
    memo,
    output,
    addedCards,
    starred,
    semanticNoteId,
    publicationSnapshot,
    shareSnapshot,
    {
      groupId:
        lineageGroupId,
      lineId:
        activeLineId,
      forkedFromDeckId:
        activeForkedFromDeckId,
    },
  );
  const shortUrl = `${window.location.origin}/deck/${workspaceId}`;
  const longUrl = restoreUrl;

  return {
    deckId: workspaceId,
    noteId:
      semanticNoteId,
    groupId:
      lineageGroupId,
    lineId:
      activeLineId,
    forkedFromDeckId:
      activeForkedFromDeckId,
    publicationId:
      publicationSnapshot.publicationId,
    publishedAt:
      publicationSnapshot.publishedAt,
    shortUrl,
    longUrl,
    restoreUrl,
  };
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

  const [groupId, setGroupId] =
    useState("");

  const [lineId, setLineId] =
    useState("main");

  const [genre, setGenre] =
    useState("");

  const [subject, setSubject] =
    useState("");

  const [unit, setUnit] =
    useState("");

  const [triggers, setTriggers] =
    useState<string[]>([]);

  const [
    showCurriculumModal,
    setShowCurriculumModal,
  ] = useState(false);

  const [
    curriculumIndex,
    setCurriculumIndex,
  ] = useState<CurriculumIndexItem[]>([]);

  const [
    curriculumSearch,
    setCurriculumSearch,
  ] = useState("");

  const [
    selectedCurriculum,
    setSelectedCurriculum,
  ] = useState<CurriculumIndexItem | null>(null);

  const [
    forkedFromDeckId,
    setForkedFromDeckId,
  ] = useState("");

  const [
    availableLines,
    setAvailableLines,
  ] = useState<string[]>([]);

  const [isReadOnly, setIsReadOnly] = useState(
    props?.readOnly === true,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const ro =
      new URLSearchParams(window.location.search).get("ro") === "1";

    if (ro) {
      setIsReadOnly(true);
    }
  }, [props?.readOnly]);

  const perspective = placeholderSets[perspectiveIndex];

  const filteredCurriculum =
    useMemo(() => {
      const q =
        curriculumSearch
          .trim()
          .toLowerCase();

      if (!q) {
        return curriculumIndex;
      }

      return curriculumIndex.filter(
        (item) =>
          item.code
            .toLowerCase()
            .includes(q) ||
          item.label
            .toLowerCase()
            .includes(q),
      );
    }, [
      curriculumSearch,
      curriculumIndex,
    ]);

  const availableDays =
    useMemo(
      () => {
        if (!selectedCurriculum) return [];

        const days = Object.keys(
          selectedCurriculum.units ?? {},
        );

        return days.length > 0
          ? days
          : [selectedCurriculum.unit];
      },
      [selectedCurriculum],
    );

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

  const parsedDeck = useMemo(
    () => parseDeck(ENABLE_FREE_INPUT ? normalizeInput(raw) : raw),
    [raw],
  );
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

    const isStructured = /^###\s+/m.test(raw);
    if (!isStructured) {
      const normalized = normalizeInput(raw);
      setRawWithCloudDirty(normalized);
      return;
    }

    const nextRaw = changeRawCardArea(raw, cardId, nextArea);

    setRawWithCloudDirty(nextRaw);

    setSelectedCardId(cardId);
    showShortcutHint(`→ ${nextArea}`);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;

      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!selectedCardId) return;

      if (e.key === "1") {
        moveCardToArea(selectedCardId, "left");
      }
      if (e.key === "2") {
        moveCardToArea(selectedCardId, "center");
      }
      if (e.key === "3") {
        moveCardToArea(selectedCardId, "right");
      }
    };

    document.addEventListener("keydown", handler);

    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, [selectedCardId, raw]);

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

  const saveCurrentLineState = useCallback(() => {
    const activeGroupId =
      groupId ||
      deckId ||
      "";

    if (!activeGroupId || !lineId) return;

    const map = loadLineStateMap();
    map[buildLineStateKey(activeGroupId, lineId)] = {
      raw,
      memo,
      output,
      addedCards,
      starred,
    };
    saveLineStateMap(map);
  }, [
    groupId,
    deckId,
    lineId,
    raw,
    memo,
    output,
    addedCards,
    starred,
  ]);

  const loadLineState = useCallback((
    nextLineId: string,
  ) => {
    const activeGroupId =
      groupId ||
      deckId ||
      "";

    if (!activeGroupId || !nextLineId) return;

    const map = loadLineStateMap();
    const key = buildLineStateKey(activeGroupId, nextLineId);
    const lineState = map[key] ?? {
      raw,
      memo,
      output,
      addedCards,
      starred,
    };

    if (!map[key]) {
      map[key] = lineState;
      saveLineStateMap(map);
    }

    setRaw(lineState.raw);
    setMemo(lineState.memo);
    setOutput(lineState.output);
    setAddedCards(lineState.addedCards);
    setStarred(lineState.starred);
  }, [
    groupId,
    deckId,
    raw,
    memo,
    output,
    addedCards,
    starred,
    setRaw,
    setMemo,
    setOutput,
    setAddedCards,
    setStarred,
  ]);

  const switchLine = useCallback((
    nextLineId: string,
  ) => {
    const normalizedLineId = nextLineId.trim();

    const activeGroupId =
      groupId ||
      deckId ||
      "";

    if (!activeGroupId || !lineId || !normalizedLineId) return;
    if (normalizedLineId === lineId) return;

    saveCurrentLineState();
    setLineId(normalizedLineId);
    loadLineState(normalizedLineId);
  }, [
    groupId,
    lineId,
    saveCurrentLineState,
    setLineId,
    loadLineState,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const resume = params.get("resume");
    const d = params.get("d");
    const isForkMode = params.get("fork") === "1";

    if (resume) {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        try {
          const deck = JSON.parse(saved) as DeckState;

          if (deck.deckId === resume) {
            setRaw(deck.raw || blankRaw);
            setMemo(deck.memo || "");
            setOutput(deck.output || "");
            setAddedCards(deck.addedCards || []);
            setStarred(deck.starred || []);
            setDeckId(deck.deckId ?? null);
            setGroupId(
              deck.groupId ||
                deck.noteId ||
                deck.deckId ||
                "",
            );
            setLineId(deck.lineId || "main");
            setForkedFromDeckId(
              deck.forkedFromDeckId ||
                deck.lineage?.forkedFromDeckId ||
                "",
            );

            return;
          }
        } catch {
          console.error("resume restore error");
        }
      }
    }

    if (d) {
      try {
        const json = decompressFromEncodedURIComponent(d);
        if (!json) return;

        const snapshot = JSON.parse(json) as Partial<DeckState>;
        const restoreMode =
          isForkMode
            ? "fork"
            : snapshot.restoreMode ??
              "revision";
        const publicationId =
          snapshot.publicationId ??
          null;
        const publishedAt =
          snapshot.publishedAt ??
          null;
        const restoredDeckId =
          snapshot.noteId ??
          snapshot.sourceDeckId ??
          snapshot.deckId ??
          snapshot.groupId ??
          null;
        const sourceDeckId =
          restoredDeckId ??
          snapshot.sourceDeckId ??
          snapshot.deckId ??
          null;
        const semanticNoteId =
          isForkMode
            ? generatePortableId("note")
            : restoredDeckId ??
              generatePortableId("note");
        const snapshotForkedFromDeckId =
          isForkMode
            ? restoredDeckId
            : snapshot.forkedFromDeckId ??
              snapshot.lineage?.forkedFromDeckId ??
              (restoreMode === "fork" ? sourceDeckId : null) ??
              null;
        const forkedFromShareId =
          snapshot.sourceShareId ??
          snapshot.shareId ??
          null;
        // workspace runtime identity
        // semantic note continuity is handled separately
        const migratedDeckId =
          generateWorkspaceId();
        const restoredGroupId =
          snapshot.groupId ||
          snapshot.lineage?.rootDeckId ||
          restoredDeckId ||
          semanticNoteId;
        const lineage =
          restoreMode === "fork"
            ? {
                rootDeckId:
                  restoredGroupId,

                forkedFromDeckId:
                  snapshotForkedFromDeckId,

                forkedFromShareId,
              }
            : snapshot.lineage ?? {
                rootDeckId:
                  restoredGroupId,
              };
        const restoredLineId =
          snapshot.lineId ||
          "main";
        const restoredForkedFromDeckId =
          isForkMode
            ? snapshotForkedFromDeckId ?? ""
            : snapshot.forkedFromDeckId ||
              lineage.forkedFromDeckId ||
              "";

        setRaw(snapshot.raw ?? "");
        setMemo(snapshot.memo ?? "");
        setOutput(snapshot.output ?? "");
        setAddedCards(snapshot.addedCards ?? []);
        setStarred(snapshot.starred ?? []);
        setDeckId(migratedDeckId);
        setGroupId(restoredGroupId);
        setLineId(restoredLineId);
        setForkedFromDeckId(restoredForkedFromDeckId);
        setShowLeft(false);
        setShowRight(false);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            ...snapshot,
            deckId: migratedDeckId,
            noteId: semanticNoteId,
            groupId: restoredGroupId,
            lineId: restoredLineId,
            forkedFromDeckId: restoredForkedFromDeckId,
            curriculumPath:
              snapshot.curriculumPath ??
              null,
            restoreMode,
            sourceDeckId,
            lineage,
            publicationId,
            publishedAt,
          }),
        );
        return;
      } catch (e) {
        console.error("restore error:", e);
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
        setDeckId(deck.deckId ?? null);
        setGroupId(
          deck.groupId ||
            deck.noteId ||
            deck.deckId ||
            "",
        );
        setLineId(deck.lineId || "main");
        setForkedFromDeckId(
          deck.forkedFromDeckId ||
            deck.lineage?.forkedFromDeckId ||
            "",
        );
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
    if (!groupId) {
      setAvailableLines(["main"]);
      return;
    }

    const registry = loadLineRegistry();
    setAvailableLines(
      registry[groupId] || ["main"],
    );
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !lineId) return;

    registerLine(
      groupId,
      lineId,
    );

    const registry = loadLineRegistry();
    setAvailableLines(
      registry[groupId] || ["main"],
    );
  }, [groupId, lineId]);

  useEffect(() => {
    loadCurriculum()
      .then((data) => {
        setCurriculumIndex(
          buildCurriculumIndex(data),
        );
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    try {
      const savedTheme =
        (localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null) ?? "auto";
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
      const savedSnapshot = JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "{}",
      ) as Partial<DeckState>;

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          raw,
          memo,
          output,
          addedCards,
          starred,
          deckId,
          noteId:
            savedSnapshot.noteId ??
            null,
          groupId:
            groupId ||
            savedSnapshot.groupId ||
            savedSnapshot.noteId ||
            deckId ||
            null,
          lineId:
            lineId ||
            "main",
          forkedFromDeckId:
            forkedFromDeckId ||
            savedSnapshot.forkedFromDeckId ||
            savedSnapshot.lineage?.forkedFromDeckId ||
            null,
          curriculumPath:
            savedSnapshot.curriculumPath ??
            null,

          restoreMode:
            "revision",

          publicationId:
            savedSnapshot.publicationId ??
            null,

          publishedAt:
            savedSnapshot.publishedAt ??
            null,

          shareId:
            savedSnapshot.shareId ??
            null,

          sharedAt:
            savedSnapshot.sharedAt ??
            null,

          lineage:
            {
              ...(savedSnapshot.lineage ?? {}),
              forkedFromDeckId:
                forkedFromDeckId ||
                savedSnapshot.lineage?.forkedFromDeckId ||
                null,
            },
        }),
      );
      setSaveStatus("保存済");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    raw,
    memo,
    output,
    addedCards,
    starred,
    deckId,
    groupId,
    lineId,
    forkedFromDeckId,
  ]);

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
    try {
      const savedSnapshot = JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "{}",
      ) as Partial<DeckState>;
      const publicationId =
        savedSnapshot.restoreMode === "fork"
          ? null
          : savedSnapshot.publicationId ??
            null;
      const publishedAt =
        savedSnapshot.restoreMode === "fork"
          ? null
          : savedSnapshot.publishedAt ??
            null;
      const result = await createShareSnapshot({
        raw,
        memo,
        output,
        addedCards,
        starred,
        deckId,
        noteId:
          savedSnapshot.noteId ??
          null,
        groupId:
          groupId ||
          savedSnapshot.groupId ||
          savedSnapshot.lineage?.rootDeckId ||
          savedSnapshot.noteId ||
          undefined,
        lineId,
        forkedFromDeckId:
          forkedFromDeckId ||
          savedSnapshot.forkedFromDeckId ||
          savedSnapshot.lineage?.forkedFromDeckId ||
          undefined,
        publication: {
          publicationId:
            publicationId ??
            undefined,
          publishedAt:
            publishedAt ??
            undefined,
        },
      });

      setDeckId(result.deckId);
      setGroupId(result.groupId);
      setLineId(result.lineId);
      setForkedFromDeckId(
        result.forkedFromDeckId ??
          "",
      );
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...savedSnapshot,
          raw,
          memo,
          output,
          addedCards,
          starred,
          deckId: result.deckId,
          noteId:
            result.noteId,
          groupId:
            result.groupId,
          lineId:
            result.lineId,
          forkedFromDeckId:
            result.forkedFromDeckId,
          restoreMode: "revision",
          publicationId:
            result.publicationId,
          publishedAt:
            result.publishedAt,
        }),
      );
      setShareUrl(result.shortUrl);
      setLongUrl(result.longUrl);
      setQrError("");
      setShowQr(true);

      await navigator.clipboard.writeText(result.shortUrl);

    } catch (e) {
      console.error(e);
    }
  };

  const downloadMd = () => {
    const savedSnapshot = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "{}",
    ) as Partial<DeckState>;
    const activeNoteId =
      savedSnapshot.noteId ??
      generatePortableId("note");
    const activeGroupId =
      groupId ||
      savedSnapshot.groupId ||
      savedSnapshot.lineage?.rootDeckId ||
      activeNoteId;
    const activeForkedFromDeckId =
      forkedFromDeckId ||
      savedSnapshot.forkedFromDeckId ||
      savedSnapshot.lineage?.forkedFromDeckId ||
      "";

    const md = buildThoughtDeckMd({
      raw,
      memo,
      output,
      deckId: activeNoteId,
      identity: {
        groupId: activeGroupId,
        lineId,
      },
      lineage: {
        forkedFromDeckId:
          activeForkedFromDeckId,
      },
    });
    const timestamp = getTimestampSlug();
    const fileName = getObsidianTitle(title, timestamp);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    // updateMyDecksLocal(
    //   title,
    //   activeNoteId,
    //   generateTriggerPreview(raw, memo, output),
    // );
  };

  const copyMd = async () => {
    const savedSnapshot = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "{}",
    ) as Partial<DeckState>;
    const activeNoteId =
      savedSnapshot.noteId ??
      generatePortableId("note");
    const activeGroupId =
      groupId ||
      savedSnapshot.groupId ||
      savedSnapshot.lineage?.rootDeckId ||
      activeNoteId;
    const activeForkedFromDeckId =
      forkedFromDeckId ||
      savedSnapshot.forkedFromDeckId ||
      savedSnapshot.lineage?.forkedFromDeckId ||
      "";

    await navigator.clipboard.writeText(
      buildThoughtDeckMd({
        raw,
        memo,
        output,
        deckId: activeNoteId,
        identity: {
          groupId: activeGroupId,
          lineId,
        },
        lineage: {
          forkedFromDeckId:
            activeForkedFromDeckId,
        },
      }),
    );
    setCopyStatus("MDコピー済");
    window.setTimeout(() => setCopyStatus(""), 1800);
  };

  const saveToObsidian = () => {
    setShowCurriculumModal(true);
  };

  const executeObsidianSave = async (curriculumOverride?: {
    genre: string;
    subject: string;
    unit: string;
  }) => {
    const activeGenre =
      curriculumOverride?.genre ??
      genre;
    const activeSubject =
      curriculumOverride?.subject ??
      subject;
    const activeUnit =
      curriculumOverride?.unit ??
      unit;
    const relatedLinks =
      buildRelatedLinks(
        activeGenre,
        activeSubject,
        activeUnit,
      );

    const savedSnapshot = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "{}",
    ) as Partial<DeckState>;
    const curriculumPath =
      buildCurriculumPath(
        activeGenre,
        activeSubject,
        activeUnit,
      );
    const previousCurriculumPath =
      savedSnapshot.curriculumPath ??
      null;
    const nextCurriculumPath =
      curriculumPath;
    const isSameCurriculum =
      previousCurriculumPath ===
      nextCurriculumPath;
    const activeNoteId =
      isSameCurriculum
        ? savedSnapshot.noteId ??
          generatePortableId("note")
        : generatePortableId("note");
    const activeGroupId =
      isSameCurriculum
        ? groupId ||
          savedSnapshot.groupId ||
          savedSnapshot.lineage?.rootDeckId ||
          activeNoteId
        : activeNoteId;
    const activeForkedFromDeckId =
      isSameCurriculum
        ? forkedFromDeckId ||
          savedSnapshot.forkedFromDeckId ||
          savedSnapshot.lineage?.forkedFromDeckId ||
          ""
        : "";

    const md = buildThoughtDeckMd({
      raw,
      memo,
      output,
      trigger: triggers,
      links: relatedLinks,
      deckId: activeNoteId,
      identity: {
        groupId: activeGroupId,
        lineId,
      },
      lineage: {
        forkedFromDeckId:
          activeForkedFromDeckId,
      },
      curriculum: {
        genre: activeGenre,
        subject: activeSubject,
        unit: activeUnit,
      },
    });
    const timestamp = getTimestampSlug();
    const fileTitle = getObsidianTitle(title, timestamp);
    const filePath = `${curriculumPath}/${fileTitle}`;
    const url = `obsidian://new?file=${encodeURIComponent(filePath)}&clipboard=true`;

    // 長いMarkdown本文をURIに直接詰めると、ブラウザやOSのURI長制限でObsidianが起動しないことがある。
    // 本文はクリップボードに置き、Obsidian URIの clipboard=true で取り込ませる。
    await copyTextSafely(md);
    setGroupId(activeGroupId);
    setForkedFromDeckId(activeForkedFromDeckId);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...savedSnapshot,
        raw,
        memo,
        output,
        addedCards,
        starred,
        noteId: activeNoteId,
        groupId: activeGroupId,
        lineId,
        forkedFromDeckId:
          activeForkedFromDeckId ||
          null,
        curriculumPath:
          nextCurriculumPath,
        restoreMode: "revision",
      }),
    );
    setObsidianToast(`Obsidianに保存します：${fileTitle}`);
    window.setTimeout(() => setObsidianToast(""), 2600);
    // updateMyDecksLocal(
    //   title,
    //   activeNoteId,
    //   generateTriggerPreview(raw, memo, output),
    // );
    await new Promise((resolve) => setTimeout(resolve, 50));
    setShowCurriculumModal(false);
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
    setGroupId("");
    setLineId("main");
    setForkedFromDeckId("");

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
    setGroupId("");
    setLineId("main");
    setForkedFromDeckId("");
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

  const insertDefaultTemplate = () => {
    if (isReadOnly) return;

    const template = `
# タイトル

## 設問
- ここに入力

### 左
@area: left
- ここに入力

### 中央
@area: center
- ここに入力

### 右
@area: right
- ここに入力

## まとめ
- ここに入力
`.trim();

    setRawWithCloudDirty((prev) => {
      if (!prev.trim()) return template;

      return `${prev.trim()}\n\n${template}`;
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
    groupId,
    setGroupId,
    lineId,
    setLineId,
    genre,
    setGenre,
    subject,
    setSubject,
    unit,
    setUnit,
    triggers,
    setTriggers,
    showCurriculumModal,
    setShowCurriculumModal,
    curriculumIndex,
    setCurriculumIndex,
    curriculumSearch,
    setCurriculumSearch,
    selectedCurriculum,
    setSelectedCurriculum,
    filteredCurriculum,
    availableDays,
    availableLines,
    setAvailableLines,
    switchLine,
    forkedFromDeckId,
    setForkedFromDeckId,
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
    executeObsidianSave,
    clearAll,
    loadDemo,
    confirmLoadDemo,
    insertTemplate,
    insertDefaultTemplate,
    toggleStar,
    buildTemplateCopyText,
    copyTemplateBundle,
    isReadOnly,
  };
}
