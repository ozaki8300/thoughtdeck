"use client";

import type { CSSProperties, ChangeEvent as ReactChangeEvent, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";

type Area = "left" | "center" | "right";

type ParsedCard = {
  id: string;
  area: Area;
  title: string;
  lines: string[];
  source: "raw";
  visualGroup: number;
  rawH3Index: number;
  areaBlockIndex: number;
};

type AddedCard = {
  id: string;
  area: Area;
  title: string;
  lines: string[];
  source: "added";
  visualGroup?: number;
};

type Card = ParsedCard | AddedCard;

type OneColumnSection = {
  id: string;
  title: string;
  lines: string[];
  position: "top" | "bottom";
  visualGroup: number;
};

type TextPanelFocusItem = {
  id: "td-memo" | "td-output";
  title: string;
  lines: string[];
  focusKind: "memo" | "output";
  focusLabel: string;
};

type FocusItem =
  | (Card & { focusKind: "card"; focusLabel: string })
  | (OneColumnSection & { focusKind: "section"; focusLabel: string })
  | TextPanelFocusItem;

type DeckState = {
  raw: string;
  memo: string;
  output: string;
  addedCards: AddedCard[];
  starred: string[];
};

type ParsedDeck = {
  title: string;
  topSections: OneColumnSection[];
  cards: ParsedCard[];
  bottomSections: OneColumnSection[];
};

const STORAGE_KEY = "thoughtdeck:data:v9";
const LEGACY_STORAGE_KEYS = ["thoughtdeck:v8", "thoughtdeck:v7", "thoughtdeck:v6"];
const RESOURCES_STORAGE_KEY = "thoughtdeck:resources:v1";
const LEGACY_CUSTOM_LINKS_STORAGE_KEY = "thoughtdeck:custom-links:v1";
const MAX_URL_LENGTH = 3000;
const QR_MAX_URL_LENGTH = 2900;
const THOUGHTDECK_HOME_URL = "https://thought-deck.vercel.app/";

const defaultQuickLinks = [
  { label: "ThoughtDeck", url: "https://thought-deck.vercel.app/" },
  { label: "GLOBIS VC", url: "https://vc.globis.ac.jp/wam/auth/login" },
] as const;

type ResourceTemplate = { id: string; title: string; content: string };
type ResourceState = { links: { label: string; url: string }[]; templates: ResourceTemplate[] };
type ThemeMode = "auto" | "light" | "dark";
type PdfSide = "left" | "right";
type PdfWorkMode = "thought" | "input" | "memo" | "output";
const THEME_STORAGE_KEY = "thoughtdeck:theme:v2";
const PDF_VIEW_STORAGE_KEY = "thoughtdeck:pdf-view:v1";
const PDF_MIN_WIDTH = 360;
const PDF_DEFAULT_WIDTH = 760;
const getPdfMaxWidth = () => {
  if (typeof window === "undefined") return 1280;
  return Math.max(980, Math.floor(window.innerWidth * 0.92));
};
const clampPdfWidth = (value: number) => Math.min(Math.max(value, PDF_MIN_WIDTH), getPdfMaxWidth());
const themeLabel = (mode: ThemeMode) => mode === "auto" ? "自動" : mode === "light" ? "ライト" : "ダーク";
const nextThemeMode = (mode: ThemeMode): ThemeMode => mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";

const placeholderSets = [
  {
    label: "発散",
    left: "何が起きている？",
    center: "どう考える？",
    right: "何が論点？",
  },
  {
    label: "再構造化",
    left: "どう見える？",
    center: "なぜそう思う？",
    right: "どこで使える？",
  },
  {
    label: "自由",
    left: "",
    center: "",
    right: "",
  },
] as const;

const blankRaw = `# タイトル

## 設問
- 

### 見出し
@area: left
-

## まとめ
- `;

const demoRaw = `# ファイナンス Day2 事業戦略と企業財務

## issue
NPVがマイナスでも投資する意思決定とは何か

### 業界の前提
@area: left
- 2012年当時の液晶業界は「大型化・設備投資・シェア獲得」で勝つという発想が主流
- 多くの企業は「良い工場を持てば勝てる」と考えていた

### 見方の違い
@area: center
- 同じ投資でも、単体の採算だけでなく、支配構造や将来の交渉力で意味が変わる
- 郭台銘氏は工場単体ではなく、サプライチェーン全体の中での価値を見ていた

### 判断軸
@area: right
- NPVだけでなく、不確実性・オプション価値・サプライチェーン支配を見る
- 数値ではなく、どの前提に賭けるかが重要になる

## まとめ
投資判断は、数値だけでなく、どの前提に賭けるのか、どの構造を取りにいくのかを含む意思決定である。`;

const demoOutput = `Day2では、NPVやIRRといった定量指標の重要性を再認識するとともに、それだけでは意思決定を説明できないケースについて深く考えさせられた。

特に印象的だったのは、シャープの投資判断である。NPVがマイナスであっても実行された背景には、「生存のための投資」という側面があり、単なる財務合理性では説明できない意思決定であった。

一方で、郭台銘氏の視点は、工場単体ではなくサプライチェーン全体の中で価値を捉えるものであり、同じ資産でも組み合わせによって価値が変わることを示していた。

本ケースを通じて、投資判断とは数値評価だけでなく、どの前提に賭けるのか、どの構造を取りにいくのかを含めた意思決定であると学んだ。`;

function encodeDeck(deck: DeckState) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(deck))));
}

function decodeDeck(value: string): DeckState | null {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(value))));
  } catch {
    return null;
  }
}

function getTitle(raw: string) {
  const line = raw
    .split("\n")
    .find(
      (l) => /^#[ \t\u3000]+/.test(l.trimEnd()) && !/^##/.test(l.trimStart()),
    );
  return line?.replace(/^#[ \t\u3000]+/, "").trim() || "タイトル未設定";
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getTimestampSlug(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

function sanitizeFileName(value: string) {
  return value
    .replace(/[\/:*?"<>|#^[\]]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function getObsidianTitle(title: string, timestamp: string) {
  const safeTitle = sanitizeFileName(title);
  if (!safeTitle || safeTitle === "タイトル" || safeTitle === "タイトル未設定")
    return timestamp;
  return `${timestamp}_${safeTitle}`;
}

function isH1(line: string) {
  return /^#[ \t\u3000]+/.test(line.trimEnd()) && !/^##/.test(line.trimStart());
}

function isH2(line: string) {
  return (
    /^##[ \t\u3000]+/.test(line.trimEnd()) &&
    !/^###[ \t\u3000]+/.test(line.trimEnd())
  );
}

function isH3(line: string) {
  return /^###[ \t\u3000]+/.test(line.trimEnd());
}

function normalizeDisplayLines(lines: string[]) {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function areaFromLine(line?: string): Area {
  const rawArea = line?.replace(/^@area:/, "").trim();
  return rawArea === "left" || rawArea === "center" || rawArea === "right"
    ? rawArea
    : "center";
}

function parseDeck(raw: string): ParsedDeck {
  const lines = raw.split("\n");
  const title = getTitle(raw);
  const topSections: OneColumnSection[] = [];
  const bottomSections: OneColumnSection[] = [];
  const cards: ParsedCard[] = [];

  let currentSection: OneColumnSection | null = null;
  let currentCard: ParsedCard | null = null;
  let hasSeenCard = false;
  let visualGroup = 0;
  let h3Index = -1;
  let areaBlockIndex = 0;
  let currentCardTitle = "見出し";

  const flushSection = () => {
    if (!currentSection) return;
    currentSection.lines = normalizeDisplayLines(currentSection.lines);
    if (currentSection.position === "top") topSections.push(currentSection);
    else bottomSections.push(currentSection);
    currentSection = null;
  };

  const flushCard = () => {
    if (!currentCard) return;
    currentCard.lines = normalizeDisplayLines(currentCard.lines).filter(
      (line) => !line.startsWith("@area:"),
    );
    cards.push(currentCard);
    currentCard = null;
  };

  const hasCardBody = (card: ParsedCard | null) =>
    Boolean(card && card.lines.some((line) => line.trim().length > 0));

  const createRawCard = (area: Area = "center"): ParsedCard => ({
    id: `raw-${h3Index}-${areaBlockIndex}-${currentCardTitle}`,
    source: "raw",
    area,
    title: currentCardTitle,
    lines: [],
    visualGroup,
    rawH3Index: h3Index,
    areaBlockIndex,
  });

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "---") {
      flushCard();
      flushSection();
      visualGroup += 1;
      continue;
    }

    if (isH1(line)) {
      flushCard();
      flushSection();
      continue;
    }

    if (isH2(line)) {
      flushCard();
      flushSection();
      const position: "top" | "bottom" = hasSeenCard ? "bottom" : "top";
      currentSection = {
        id: `${position}-${position === "top" ? topSections.length : bottomSections.length}-${trimmed}`,
        title: trimmed.replace(/^##[ \t\u3000]*/, "").trim() || "セクション",
        lines: [],
        position,
        visualGroup,
      };
      continue;
    }

    if (isH3(line)) {
      flushSection();
      flushCard();
      hasSeenCard = true;
      h3Index += 1;
      areaBlockIndex = 0;
      currentCardTitle = trimmed.replace(/^###[ \t\u3000]*/, "").trim() || "見出し";
      currentCard = createRawCard("center");
      continue;
    }

    if (currentCard) {
      if (trimmed.startsWith("@area:")) {
        const nextArea = areaFromLine(trimmed);

        // 1つの「### 見出し」の中に @area が複数ある場合は、
        // @area ごとにカードを分割する。
        // これにより、見出しは同じまま left / center / right に自然に展開できる。
        if (hasCardBody(currentCard)) {
          flushCard();
          areaBlockIndex += 1;
          currentCard = createRawCard(nextArea);
        } else {
          currentCard.area = nextArea;
        }
        continue;
      }

      currentCard.lines.push(line);
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    }
  }

  flushCard();
  flushSection();

  return { title, topSections, cards, bottomSections };
}

function firstH3Index(raw: string) {
  return raw.search(/^###[ \t\u3000]+/m);
}

function firstBottomSectionIndex(raw: string) {
  const h3Index = firstH3Index(raw);
  if (h3Index < 0) return -1;
  const rest = raw.slice(h3Index);
  const match = rest.match(/^##[ \t\u3000]+/m);
  return match?.index === undefined ? -1 : h3Index + match.index;
}

function insertBlock(raw: string, index: number, template: string) {
  if (index >= 0) {
    return `${raw.slice(0, index).trimEnd()}\n\n${template}\n\n${raw.slice(index).trimStart()}`;
  }
  return `${raw.trimEnd()}\n\n${template}`;
}

function insertTopSectionTemplate(raw: string) {
  const h3Index = firstH3Index(raw);
  const template = `## 設問\n- `;
  return insertBlock(raw, h3Index, template);
}

function insertCardTemplate(raw: string, area: Area) {
  const bottomIndex = firstBottomSectionIndex(raw);
  const template = `### 見出し\n@area: ${area}\n- `;
  return insertBlock(raw, bottomIndex, template);
}

function insertBottomSectionTemplate(raw: string) {
  return `${raw.trimEnd()}\n\n## まとめ\n- `;
}

function rawCardLocatorFromId(id: string) {
  const match = id.match(/^raw-(\d+)-(\d+)-/);
  if (!match) return null;
  return {
    h3Index: Number(match[1]),
    areaBlockIndex: Number(match[2]),
  };
}

function changeRawCardArea(raw: string, cardId: string, nextArea: Area) {
  const locator = rawCardLocatorFromId(cardId);
  if (!locator) return raw;

  const lines = raw.split("\n");
  let currentH3Index = -1;
  let h3LineIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (isH3(lines[i])) {
      currentH3Index += 1;
      if (currentH3Index === locator.h3Index) {
        h3LineIndex = i;
        break;
      }
    }
  }

  if (h3LineIndex < 0) return raw;

  let blockEnd = lines.length;
  for (let i = h3LineIndex + 1; i < lines.length; i += 1) {
    if (isH1(lines[i]) || isH2(lines[i]) || isH3(lines[i]) || lines[i].trim() === "---") {
      blockEnd = i;
      break;
    }
  }

  const areaLineIndexes: number[] = [];
  for (let i = h3LineIndex + 1; i < blockEnd; i += 1) {
    if (lines[i].trim().startsWith("@area:")) areaLineIndexes.push(i);
  }

  const targetAreaLineIndex = areaLineIndexes[locator.areaBlockIndex];

  if (targetAreaLineIndex !== undefined) {
    lines[targetAreaLineIndex] = `@area: ${nextArea}`;
  } else {
    lines.splice(h3LineIndex + 1, 0, `@area: ${nextArea}`);
  }

  return lines.join("\n");
}

function normalizeConclusionLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("-") ? `  ${trimmed}` : `  - ${trimmed}`;
}

function appendCardToConclusion(raw: string, card: Card) {
  const cardLines = [
    `- ${card.title || "選択カード"}`,
    ...card.lines.map(normalizeConclusionLine).filter(Boolean),
  ].join("\n");

  const summaryMatch = raw.match(/^##[ \t\u3000]+まとめ\s*$/m);

  if (!summaryMatch || summaryMatch.index === undefined) {
    return `${raw.trimEnd()}\n\n## まとめ\n${cardLines}\n`;
  }

  const insertAt = summaryMatch.index + summaryMatch[0].length;
  const before = raw.slice(0, insertAt);
  const after = raw.slice(insertAt);
  const needsNewLine = after.startsWith("\n") ? "" : "\n";
  return `${before}${needsNewLine}\n${cardLines}${after}`;
}

function renderInline(text: string) {
  const parts = text.split(/(==.*?==|=[^=].*?=|\*\*.*?\*\*)/g);

  return parts.map((part, i) => {
    if (part.startsWith("==") && part.endsWith("==")) {
      return (
        <mark
          key={i}
          className="rounded-[3px] bg-[var(--td-mark-bg)] px-[3px] text-[var(--td-text)]"
        >
          {part.slice(2, -2)}
        </mark>
      );
    }

    if (part.startsWith("=") && part.endsWith("=") && part.length > 2) {
      return (
        <mark
          key={i}
          className="rounded-[3px] bg-[var(--td-mark-bg)] px-[3px] text-[var(--td-text)]"
        >
          {part.slice(1, -1)}
        </mark>
      );
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-[var(--td-accent)]">
          {part.slice(2, -2)}
        </strong>
      );
    }

    return <span key={i}>{part}</span>;
  });
}

function stripListMarker(line: string) {
  return line.replace(/^\s*[-*+]\s+/, "");
}

function renderMarkdownBlocks(text: string, emptyText = "本文はInput欄に入力してください。") {
  const sourceLines = text.split("\n");
  const elements = [];
  let i = 0;
  let key = 0;

  const nextKey = () => `md-${key++}`;

  while (i < sourceLines.length) {
    const line = sourceLines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      elements.push(<hr key={nextKey()} className="my-3 border-[var(--td-border)]" />);
      i += 1;
      continue;
    }

    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      elements.push(
        <h3 key={nextKey()} className="mt-3 text-[12pt] font-bold text-[var(--td-accent)]">
          {renderInline(h3[1])}
        </h3>,
      );
      i += 1;
      continue;
    }

    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2) {
      elements.push(
        <h2 key={nextKey()} className="mt-4 text-[13pt] font-bold text-[var(--td-accent)]">
          {renderInline(h2[1])}
        </h2>,
      );
      i += 1;
      continue;
    }

    const h1 = trimmed.match(/^#\s+(.+)$/);
    if (h1) {
      elements.push(
        <h1 key={nextKey()} className="mt-4 text-[15pt] font-bold text-[var(--td-accent)]">
          {renderInline(h1[1])}
        </h1>,
      );
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < sourceLines.length && /^>\s?/.test(sourceLines[i].trim())) {
        quoteLines.push(sourceLines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      elements.push(
        <blockquote key={nextKey()} className="my-2 border-l-2 border-[var(--td-accent-border)] pl-3 text-[var(--td-text-soft)]">
          {quoteLines.map((quote, idx) => (
            <p key={idx}>{renderInline(quote)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < sourceLines.length && /^\s*[-*+]\s+/.test(sourceLines[i])) {
        items.push(stripListMarker(sourceLines[i]));
        i += 1;
      }
      elements.push(
        <ul key={nextKey()} className="my-1 list-disc space-y-0.5 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph = [];
    while (
      i < sourceLines.length &&
      sourceLines[i].trim() &&
      !/^\s*[-*+]\s+/.test(sourceLines[i]) &&
      !/^>\s?/.test(sourceLines[i].trim()) &&
      !/^#{1,3}\s+/.test(sourceLines[i].trim()) &&
      !/^---+$/.test(sourceLines[i].trim())
    ) {
      paragraph.push(sourceLines[i].trim());
      i += 1;
    }

    elements.push(
      <p key={nextKey()} className="whitespace-pre-wrap">
        {renderInline(paragraph.join("\n"))}
      </p>,
    );
  }

  if (elements.length === 0) {
    return <p className="text-[var(--td-muted)]">{emptyText}</p>;
  }

  return <div className="space-y-1 break-words">{elements}</div>;
}

type ThoughtDeckIdKind = "note" | "group" | "card" | "memo";

const ID_PREFIX_BY_KIND: Record<ThoughtDeckIdKind, string> = {
  note: "td_n",
  group: "td_g",
  card: "td_c",
  memo: "td_m",
};

function normalizeUuid(rawId: string) {
  return rawId.replace(/-/g, "");
}

function generatePortableId(kind: ThoughtDeckIdKind) {
  const prefix = ID_PREFIX_BY_KIND[kind];

  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${normalizeUuid(crypto.randomUUID())}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

type ObsidianExportIds = {
  noteId: string;
  groupId: string;
};

function buildObsidianMetaLines(
  ids: ObsidianExportIds,
  item: { type: "question" | "card" | "summary"; area?: Area },
) {
  const areaLine = item.area ? `<!-- @area: ${item.area} -->\n` : "";

  return `<!-- @card_id: ${generatePortableId("card")} -->\n<!-- @note_id: ${ids.noteId} -->\n<!-- @group_id: ${ids.groupId} -->\n<!-- @type: ${item.type} -->\n${areaLine}`;
}

function injectPortableIdsForObsidian(markdown: string, ids: ObsidianExportIds) {
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

function addedCardToMarkdown(
  card: AddedCard,
  options?: { ids?: ObsidianExportIds; withPortableIds?: boolean },
) {
  const metaLines =
    options?.withPortableIds && options.ids
      ? buildObsidianMetaLines(options.ids, { type: "card", area: card.area })
      : `@area: ${card.area}\n`;

  return `### ${card.title || "見出し"}\n${metaLines}${card.lines.length ? card.lines.join("\n") : "- "}`;
}

function buildExportMarkdown(
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

function buildRestoreUrl(
  raw: string,
  memo: string,
  output: string,
  addedCards: AddedCard[],
  starred: string[],
) {
  if (typeof window === "undefined") return "";
  const base = `${window.location.origin}${window.location.pathname}`;
  const deck: DeckState = { raw, memo, output, addedCards, starred };
  return `${base}?d=${encodeURIComponent(encodeDeck(deck))}`;
}

function getActiveAreaEntries(block: { left: Card[]; center: Card[]; right: Card[] }) {
  return ([
    ["left", block.left],
    ["center", block.center],
    ["right", block.right],
  ] as const).filter(([, items]) => items.length > 0);
}

function getDynamicColumnClass(count: number) {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  return "grid-cols-3";
}

function getAreaPlaceholder(perspective: (typeof placeholderSets)[number], area: Area) {
  if (area === "left") return perspective.left;
  if (area === "center") return perspective.center;
  return perspective.right;
}

function formatObsidianTimestamp(date = new Date()) {
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

function buildObsidianMarkdown(
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

export default function Home() {
  const [raw, setRaw] = useState(blankRaw);
  const [memo, setMemo] = useState("");
  const [output, setOutput] = useState("");
  const [addedCards, setAddedCards] = useState<AddedCard[]>([]);
  const [starred, setStarred] = useState<string[]>([]);

  const [saveStatus, setSaveStatus] = useState("保存済");
  const [copyStatus, setCopyStatus] = useState("");
  const [obsidianToast, setObsidianToast] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [expandedEditor, setExpandedEditor] = useState<"input" | "memo" | "output" | null>(
    null,
  );
  const [shortcutHint, setShortcutHint] = useState("");
  const [perspectiveIndex, setPerspectiveIndex] = useState(1);

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

  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const [openTopMenu, setOpenTopMenu] = useState<"more" | "display" | "export" | "resources" | "theme" | null>(null);
  const topMenuRef = useRef<HTMLDivElement | null>(null);
  const memoRef = useRef<HTMLElement | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
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

  const parsedDeck = useMemo(() => parseDeck(raw), [raw]);
  const { title, topSections, bottomSections } = parsedDeck;
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

  const moveCardToArea = (cardId: string | null, nextArea: Area) => {
    if (!cardId) return;

    const target = allCards.find((card) => card.id === cardId);
    if (!target) return;

    if (target.source === "raw") {
      setRaw((prev) => changeRawCardArea(prev, cardId, nextArea));
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
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping =
        tagName === "textarea" ||
        tagName === "input" ||
        tagName === "select" ||
        target?.isContentEditable;

      if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key.toLowerCase() === "d") {
        if (isMobileLike()) return;
        event.preventDefault();
        if (event.shiftKey) {
          clearPdf();
        } else {
          togglePdf();
        }
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        moveCardToArea(selectedCardId, "left");
      }

      if (event.key === "2") {
        event.preventDefault();
        moveCardToArea(selectedCardId, "center");
      }

      if (event.key === "3") {
        event.preventDefault();
        moveCardToArea(selectedCardId, "right");
      }

      if (event.key.toLowerCase() === "s" && selectedCard) {
        event.preventDefault();
        toggleStar(selectedCard.id);
        showShortcutHint("★ 重要マークを切り替えました");
      }

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        selectSiblingCard(1);
      }

      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        selectSiblingCard(-1);
      }

      if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        openInputEditor();
        showShortcutHint("Inputを編集します");
        return;
      }

      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        openMemoEditor();
        showShortcutHint("メモを編集します");
        return;
      }

      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        openOutputComposer();
        showShortcutHint("投稿文を編集します");
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFocusMode(true);
        showShortcutHint("思考エリアをフォーカス表示します");
        return;
      }

      if (event.key === "Escape") {
        if (expandedEditor) setExpandedEditor(null);
        else if (focusMode) setFocusMode(false);
        else if (showShortcutHelp) setShowShortcutHelp(false);
        else if (showTemplatePanel) setShowTemplatePanel(false);
        else if (openTopMenu) setOpenTopMenu(null);
        else setSelectedCardId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedCardId,
    selectedCard,
    selectedFocusItem,
    allCards,
    focusMode,
    expandedEditor,
    showShortcutHelp,
    showTemplatePanel,
    openTopMenu,
    pdfUrl,
    isPdfOpen,
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
    const base = `${window.location.origin}${window.location.pathname}`;
    const deck: DeckState = { raw, memo, output, addedCards, starred };
    const url = `${base}?d=${encodeURIComponent(encodeDeck(deck))}`;
    setShareUrl(url);
    if (url.length > QR_MAX_URL_LENGTH) {
      setQrError(
        `共有URLが長すぎます（${url.length}文字）。URLコピーは可能ですが、QR表示には向きません。`,
      );
    } else {
      setQrError("");
    }
    setShowQr(true);
    try {
      await navigator.clipboard.writeText(url);
    } catch {}
  };

  useEffect(() => {
    if (!showQr) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showQr]);

  const downloadMd = () => {
    const md = buildExportMarkdown(raw, addedCards, memo, output);
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
    const md = buildObsidianMarkdown(raw, addedCards, memo, output, starred);
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
    if (!confirm("全ての内容をまっさらにしますか？")) return;
    setRaw(blankRaw);
    setMemo("");
    setOutput("");
    setAddedCards([]);
    setStarred([]);
    setShareUrl("");
    setQrError("");
    setShowQr(false);
    setSelectedCardId(null);
    setFocusMode(false);
    setShowLeft(false);
    setShowRight(false);
    localStorage.removeItem(STORAGE_KEY);
  };

  const loadDemo = () => {
    setRaw(demoRaw);
    setMemo("");
    setOutput(demoOutput);
    setAddedCards([]);
    setStarred([]);
    setShareUrl("");
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
    setRaw((prev) => {
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

  const renderOneColumnSection = (section: OneColumnSection) => {
    const isSelected = selectedCardId === section.id;

    return (
      <section
        key={section.id}
        onClick={() => setSelectedCardId(section.id)}
        className={`cursor-pointer rounded-xl border p-4 transition ${
          isSelected ? selectedThoughtClass : baseCardClass
        }`}
      >
        <h3 className="mb-1 text-[12pt] font-bold text-[var(--td-accent)]">
          {section.title}
        </h3>
        <div className="text-[11pt] leading-5 text-[var(--td-text)]">
          {renderMarkdownBlocks(section.lines.join("\n"))}
        </div>
      </section>
    );
  };

  const renderCard = (card: Card, isCenter = false) => {
    const isSelected = selectedCardId === card.id;

    return (
      <div
        key={card.id}
        onClick={() => setSelectedCardId(card.id)}
        className={`cursor-pointer rounded-xl border px-2 py-3 transition ${
          isSelected
            ? selectedThoughtClass
            : baseCardClass
        }`}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <h3 className="w-full text-[12pt] font-bold text-[var(--td-accent)]">
            {card.title}
          </h3>
          <button
            onClick={(event) => {
              event.stopPropagation();
              toggleStar(card.id);
            }}
            className="shrink-0 text-[11pt] text-[var(--td-text)] hover:text-[var(--td-text)]"
            title="重要マーク"
          >
            {starred.includes(card.id) ? "★" : "☆"}
          </button>
        </div>

        <div className="text-[11pt] leading-5 text-[var(--td-text)]">
          {renderMarkdownBlocks(card.lines.join("\n"))}
        </div>
      </div>
    );
  };

  const renderCentralFocus = () => {
    if (!focusMode) return null;

    return (
      <div
        className="fixed inset-0 z-50 bg-[var(--td-overlay)] p-4 backdrop-blur-sm"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setFocusMode(false);
        }}
      >
        <section className="mx-auto flex h-full w-full max-w-7xl flex-col rounded-2xl border border-[var(--td-border-strong)] bg-[var(--td-bg)] shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--td-border)] px-5 py-4">
            <div>
              <p className="text-[10.5pt] text-[var(--td-muted)]">
                フォーカス / F：開く / Esc：閉じる
              </p>
              <h2 className="text-[16pt] font-bold text-[var(--td-text)]">
                {title}
              </h2>
            </div>
            <button
              onClick={() => setFocusMode(false)}
              className="rounded-lg border border-[var(--td-border-strong)] px-4 py-2 text-[11pt] text-[var(--td-text)] transition hover:border-blue-500/50 hover:bg-blue-950/10 hover:text-[var(--td-text)]"
            >
              閉じる
            </button>
          </div>

          <div className="no-scrollbar flex-1 overflow-auto p-6">
            <div className="mx-auto max-w-6xl">
              {topSections.length > 0 && (
                <div className="mb-6 space-y-4">
                  {topSections.map(renderOneColumnSection)}
                </div>
              )}

              <div>
                {cardBlocks.map((block, index) => renderCardBlock(block, index))}
              </div>

              {bottomSections.length > 0 && (
                <div className="mt-8 border-t border-[var(--td-border)] pt-5">
                  <div className="mb-2 px-1 text-[10.5pt] text-[var(--td-muted)]">
                    結論
                  </div>
                  <div className="space-y-4">
                    {bottomSections.map(renderOneColumnSection)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  };

  const renderColumn = (items: Card[], area?: Area) => {
    const isCenter = area === "center";

    return (
      <section className="min-h-12 space-y-3 rounded-xl transition">
        {items.map((card) => renderCard(card, isCenter))}

      </section>
    );
  };

  const renderCardBlock = (
    block: { visualGroup: number; left: Card[]; center: Card[]; right: Card[] },
    index: number,
  ) => {
    const hasCards =
      block.left.length > 0 || block.center.length > 0 || block.right.length > 0;

    if (!hasCards) return null;

    const activeAreas = getActiveAreaEntries(block);
    const columnClass = getDynamicColumnClass(activeAreas.length);

    return (
      <div
        key={block.visualGroup}
        className={index === 0 ? "" : "mt-12 pt-2"}
      >
        <div className={`grid gap-4 ${columnClass} max-xl:grid-cols-1`}>
          {activeAreas.map(([area, items]) => {
            const placeholder = getAreaPlaceholder(perspective, area);

            return (
              <div key={area} className="space-y-2">
                {placeholder && (
                  <p className={`${mutedQuestionClass} px-1`}>{placeholder}</p>
                )}
                {renderColumn(items, area)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderPdfPanel = () => {
    if (!pdfUrl || !isPdfOpen) return null;

    const pdfFrameSrc = `${pdfUrl}#page=${pdfPage}`;

    return (
      <aside
        className="hidden shrink-0 overflow-hidden border-[var(--td-border)] bg-[var(--td-panel)] lg:flex lg:w-[var(--pdf-width)] lg:flex-col"
        style={{ "--pdf-width": `${pdfWidth}px` } as CSSProperties}
      >
        <div className="flex min-h-[52px] items-center gap-2 overflow-x-auto border-b border-[var(--td-border)] px-3 py-2">
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
              onChange={(event) => setPdfPage(Math.max(1, Number(event.target.value) || 1))}
              className="w-16 rounded-lg border border-[var(--td-border)] bg-[var(--td-editor)] px-2 py-1 text-[10pt] text-[var(--td-text)] outline-none focus:border-[var(--td-accent-border)]"
            />
          </label>

          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setPdfSide("left")}
              className={`${panelButtonClass} ${pdfSide === "left" ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]" : ""}`}
              title="PDFを左に表示"
            >
              左
            </button>
            <button
              onClick={() => setPdfSide("right")}
              className={`${panelButtonClass} ${pdfSide === "right" ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]" : ""}`}
              title="PDFを右に表示"
            >
              右
            </button>
            <button onClick={hidePdf} className={panelButtonClass}>
              非表示
            </button>
            <button onClick={openPdfPicker} className={panelButtonClass}>
              変更
            </button>
            <button onClick={clearPdf} className={panelButtonClass}>
              解除
            </button>
          </div>
        </div>

        <iframe
          key={`${pdfUrl}-${pdfPage}`}
          src={pdfFrameSrc}
          className={`min-h-0 flex-1 bg-white ${draggingPdf ? "pointer-events-none" : ""}`}
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
          setDraggingPdf(true);
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


  const renderThoughtArea = () => (
    <section className="no-scrollbar flex-1 overflow-auto p-4 max-lg:overflow-visible max-lg:p-4">
      <div className="mb-5 rounded-xl border border-[var(--td-border)] bg-[var(--td-panel)] p-5">
        <p className="text-[11pt] text-[var(--td-muted)]">タイトル</p>
        <h2 className="text-xl font-bold">{title}</h2>
      </div>

      {topSections.length > 0 && (
        <div className="mb-5 space-y-4">
          {topSections.map(renderOneColumnSection)}
        </div>
      )}

      <div>{cardBlocks.map((block, index) => renderCardBlock(block, index))}</div>

      {bottomSections.length > 0 && (
        <div className="mt-5 border-t border-[var(--td-border)] pt-4">
          <div className="mb-2 px-1 text-[10.5pt] text-[var(--td-muted)]">結論</div>
          <div className="space-y-4">{bottomSections.map(renderOneColumnSection)}</div>
        </div>
      )}

      {output.trim() && (
        <div className="mt-8 border-t border-[var(--td-border)] pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10.5pt] text-[var(--td-muted)]">OUTPUT</p>
              <h2 className="text-[13pt] font-bold text-[var(--td-text)]">投稿文</h2>
            </div>
            <button onClick={openOutputComposer} className="rounded-lg border border-[var(--td-border)] px-3 py-1.5 text-[10.5pt] text-[var(--td-muted)] transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-accent-bg)] hover:text-[var(--td-accent)]">
              編集
            </button>
          </div>
          <section
            onClick={() => setSelectedCardId("td-output")}
            className={`cursor-pointer rounded-xl border p-4 text-[11pt] leading-6 text-[var(--td-text)] transition ${
              selectedCardId === "td-output"
                ? selectedThoughtClass
                : "border-[var(--td-border)] bg-[var(--td-surface-soft)] hover:border-[var(--td-border-strong)]"
            }`}
          >
            {renderMarkdownBlocks(output)}
          </section>
        </div>
      )}
    </section>
  );

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
    const setEditorValue = pdfWorkMode === "input" ? setRaw : pdfWorkMode === "memo" ? setMemo : setOutput;
    const editorPlaceholder =
      pdfWorkMode === "input"
        ? "PDFを見ながら、構造化する内容を書きます..."
        : pdfWorkMode === "memo"
          ? "PDFを見ながら、気づき・違和感・発言メモを自由に書きます..."
          : "PDFとカードを見ながら、投稿文を書きます...";

    return (
      <section className="no-scrollbar flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--td-bg)]">
        <div className="flex min-h-[54px] flex-wrap items-center justify-between gap-3 border-b border-[var(--td-border)] px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[10.5pt] text-[var(--td-muted)]">表示</span>
            <button onClick={() => setPdfWorkMode("thought")} className={pdfModeButtonClass("thought")}>思考</button>
            <button onClick={() => setPdfWorkMode("input")} className={pdfModeButtonClass("input")}>Input</button>
            <button onClick={() => setPdfWorkMode("memo")} className={pdfModeButtonClass("memo")}>メモ</button>
            <button onClick={() => setPdfWorkMode("output")} className={pdfModeButtonClass("output")}>投稿</button>
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
              className={`no-scrollbar min-h-0 flex-1 resize-none rounded-2xl border border-[var(--td-border-strong)] bg-[var(--td-editor)] p-5 text-[var(--td-text)] outline-none focus:border-[var(--td-accent-border)] ${
                pdfWorkMode === "input" ? "font-mono text-[11.5pt] leading-7" : "text-[12.5pt] leading-8"
              }`}
            />
          </div>
        )}
      </section>
    );
  };

  const renderExpandedEditor = () => {
    if (!expandedEditor) return null;

    const isInput = expandedEditor === "input";
    const isMemo = expandedEditor === "memo";
    const title = isInput
      ? "インプット編集"
      : isMemo
        ? "メモ編集"
        : "投稿文作成";
    const value = isInput ? raw : isMemo ? memo : output;
    const setValue = isInput ? setRaw : isMemo ? setMemo : setOutput;
    const placeholder = isInput
      ? "Inputを集中して書きます..."
      : isMemo
        ? "授業中の気づき・違和感・発言メモを自由に書く..."
        : "カードを見ながら、掲示板に投稿する文章を書く...";

    return (
      <div
        className="fixed inset-0 z-50 bg-[var(--td-overlay)] p-4 backdrop-blur-sm"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setExpandedEditor(null);
        }}
      >
        <section className="mx-auto flex h-full w-full max-w-6xl flex-col rounded-2xl border border-[var(--td-border-strong)] bg-[var(--td-bg)] shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--td-border)] px-5 py-4">
            <div>
              <p className="text-[10.5pt] text-[var(--td-muted)]">
                Esc：保存して閉じる / Ctrl+Enter：保存して閉じる
              </p>
              <h2 className="text-[15pt] font-bold text-[var(--td-text)]">
                {title}
              </h2>
            </div>
            <button
              onClick={() => setExpandedEditor(null)}
              className="rounded-lg border border-[var(--td-border-strong)] px-4 py-2 text-[11pt] text-[var(--td-text)] transition hover:border-blue-500/50 hover:bg-blue-950/10 hover:text-[var(--td-text)]"
            >
              閉じる
            </button>
          </div>

          <textarea
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setExpandedEditor(null);
              }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                setExpandedEditor(null);
              }
            }}
            placeholder={placeholder}
            className={`no-scrollbar flex-1 resize-none bg-[var(--td-editor)] p-6 text-[var(--td-text)] outline-none ${
              isInput
                ? "font-mono text-[12pt] leading-7"
                : "text-[13pt] leading-8"
            }`}
          />

          <div className="flex items-center justify-between border-t border-[var(--td-border)] px-5 py-3 text-[10.5pt] text-[var(--td-muted)]">
            <span>
              {isInput
                ? "Inputが唯一の元データです"
                : isMemo
                  ? "授業中の気づきだけに集中できます"
                  : "閉じるとOUTPUTに反映されます"}
            </span>
            <span>文字数：{value.length}</span>
          </div>
        </section>
      </div>
    );
  };

  const renderShortcutHelp = () => {
    if (!showShortcutHelp) return null;

    const shortcuts = [
      ["F", "中央思考エリアをフォーカス"],
      ["I", "Input表示／編集"],
      ["M", "メモ編集"],
      ["P", "投稿作成／編集"],
      ["D", "PDFを開く／表示／非表示（PCのみ）"],
      ["Shift + D", "PDFを解除（PCのみ）"],
      ["1 / 2 / 3", "選択カードを 左 / 中 / 右 へ移動"],
      ["↑ ↓ ← →", "カード選択を移動"],
      ["S", "選択カードに★を付ける／外す"],
      ["Esc", "閉じる／保存して閉じる"],
      ["Ctrl + Enter", "保存して閉じる"],
    ];

    return (
      <div
        className="fixed inset-0 z-50 bg-[var(--td-overlay)] p-4 backdrop-blur-sm"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowShortcutHelp(false);
        }}
      >
        <section className="mx-auto flex h-full w-full max-w-4xl flex-col rounded-2xl border border-[var(--td-border-strong)] bg-[var(--td-bg)] shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--td-border)] px-5 py-4">
            <div>
              <p className="text-[10.5pt] text-[var(--td-muted)]">使い方 / Esc：閉じる</p>
              <h2 className="text-[16pt] font-bold text-[var(--td-text)]">使い方</h2>
            </div>
            <button
              onClick={() => setShowShortcutHelp(false)}
              className="rounded-lg border border-[var(--td-border-strong)] px-4 py-2 text-[11pt] text-[var(--td-text)] transition hover:border-blue-500/50 hover:bg-blue-950/10 hover:text-[var(--td-text)]"
            >
              閉じる
            </button>
          </div>

          <div className="no-scrollbar flex-1 overflow-auto p-6">
            <div className="mx-auto max-w-2xl space-y-3">
              <section className="rounded-2xl border border-[var(--td-border)] bg-[var(--td-surface-soft)] p-5">
                <h3 className="mb-3 text-[13pt] font-bold text-[var(--td-accent)]">デモ</h3>
                <p className="mb-4 text-[10.5pt] leading-6 text-[var(--td-muted)]">はじめて触るときは、サンプル内容を読み込んで動きを確認できます。</p>
                <button
                  onClick={() => { setShowShortcutHelp(false); confirmLoadDemo(); }}
                  className="rounded-lg border border-[var(--td-border-strong)] px-4 py-2 text-[11pt] text-[var(--td-text)] transition hover:border-blue-500/50 hover:bg-blue-950/10 hover:text-[var(--td-text)]"
                >
                  デモを読み込む
                </button>
              </section>

              <section className="rounded-2xl border border-[var(--td-border)] bg-[var(--td-surface-soft)] p-5">
                <h3 className="mb-4 text-[13pt] font-bold text-[var(--td-accent)]">使い方</h3>
                <div className="space-y-3">
                  {shortcuts.map(([key, description]) => (
                    <div
                      key={key}
                      className="grid grid-cols-[140px_1fr] items-center gap-4 rounded-xl border border-[var(--td-border)] bg-[var(--td-surface-soft)] px-4 py-3 text-[11pt]"
                    >
                      <span className="font-mono text-[var(--td-accent)]">{key}</span>
                      <span className="text-[var(--td-text-soft)]">{description}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--td-border)] bg-[var(--td-surface-soft)] p-5">
                <h3 className="mb-4 text-[13pt] font-bold text-[var(--td-accent)]">書き方</h3>
                <div className="space-y-3 font-mono text-[11pt] leading-7 text-[var(--td-text-soft)]">
                  <p><span className="text-[var(--td-accent)]"># タイトル</span></p>
                  <p><span className="text-[var(--td-accent)]">## 上部1カラム</span><span className="text-[var(--td-muted)]">（設問・前提など）</span></p>
                  <p><span className="text-[var(--td-accent)]">### 3カラムカード見出し</span></p>
                  <p><span className="text-[var(--td-muted)]">@area: left / center / right</span></p>
                  <p><span className="text-[var(--td-accent)]">## 下部1カラム</span><span className="text-[var(--td-muted)]">（まとめ・次回アクションなど）</span></p>
                  <p><span className="rounded bg-[var(--td-mark-bg)] px-1 text-[var(--td-text)]">==強調==</span><span className="mx-2 text-[var(--td-muted)]">/</span><strong className="text-[var(--td-accent)]">**太字**</strong><span className="ml-2 text-[var(--td-muted)]">に対応</span></p>
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>
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

  const renderTemplatePanel = () => {
    if (!showTemplatePanel) return null;

    return (
      <div
        className="fixed inset-0 z-50 bg-[var(--td-overlay)] p-4 backdrop-blur-sm"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowTemplatePanel(false);
        }}
      >
        <section className="mx-auto flex h-full w-full max-w-5xl flex-col rounded-2xl border border-[var(--td-border-strong)] bg-[var(--td-bg)] shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--td-border)] px-5 py-4">
            <div>
              <p className="text-[10.5pt] text-[var(--td-muted)]">テンプレ / Esc：閉じる</p>
              <h2 className="text-[16pt] font-bold text-[var(--td-text)]">テンプレ</h2>
            </div>
            <button onClick={() => setShowTemplatePanel(false)} className="rounded-lg border border-[var(--td-border-strong)] px-4 py-2 text-[11pt] text-[var(--td-text)] transition hover:border-blue-500/50 hover:bg-blue-950/10 hover:text-[var(--td-text)]">閉じる</button>
          </div>

          <div className="no-scrollbar grid flex-1 grid-cols-[280px_1fr] gap-0 overflow-hidden max-lg:grid-cols-1">
            <aside className="no-scrollbar overflow-auto border-r border-[var(--td-border)] p-5 max-lg:border-b max-lg:border-r-0">
              <p className="mb-2 text-[10pt] text-[var(--td-muted)]">テンプレ選択</p>
              <div className="space-y-2">
                <button onClick={() => setSelectedTemplateId("free")} className={`w-full rounded-xl border px-3 py-2 text-left text-[11pt] transition ${selectedTemplateId === "free" ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]" : "border-[var(--td-border)] bg-[var(--td-surface-soft)] text-[var(--td-text-soft)] hover:border-[var(--td-border-strong)]"}`}>なし（自由）</button>
                {templates.map((template) => (
                  <div key={template.id} className="flex items-center gap-2">
                    <button onClick={() => setSelectedTemplateId(template.id)} className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-left text-[11pt] transition ${selectedTemplateId === template.id ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]" : "border-[var(--td-border)] bg-[var(--td-surface-soft)] text-[var(--td-text-soft)] hover:border-[var(--td-border-strong)]"}`}><span className="block truncate">{template.title}</span></button>
                    <button onClick={() => removeTemplate(template.id)} className="rounded-lg border border-[var(--td-border)] px-2 py-2 text-[10pt] text-[var(--td-muted)] hover:border-red-800 hover:text-red-400" title="削除">×</button>
                  </div>
                ))}
              </div>

              <div className="mt-5 border-t border-[var(--td-border)] pt-5">
                <p className="mb-2 text-[10pt] text-[var(--td-muted)]">テンプレ追加</p>
                <input value={newTemplateTitle} onChange={(event) => setNewTemplateTitle(event.target.value)} placeholder="タイトル" className="mb-2 w-full rounded-lg border border-[var(--td-border)] bg-[var(--td-panel)] px-3 py-2 text-[10.5pt] text-[var(--td-text)] outline-none focus:border-blue-500/50" />
                <textarea value={newTemplateContent} onChange={(event) => setNewTemplateContent(event.target.value)} placeholder="テンプレ本文" className="mb-2 min-h-[280px] w-full resize-y rounded-lg border border-[var(--td-border)] bg-[var(--td-panel)] px-3 py-2 text-[10.5pt] leading-6 text-[var(--td-text)] outline-none focus:border-blue-500/50" />
                <button onClick={addTemplate} className={`${topButtonClass} w-full`}>追加</button>
              </div>
            </aside>

            <div className="no-scrollbar overflow-auto p-6">
              <div className="space-y-5">
                <section className="rounded-2xl border border-[var(--td-border)] bg-[var(--td-surface-soft)] p-5">
                  <h3 className="mb-3 text-[13pt] font-bold text-[var(--td-accent)]">選択中テンプレ</h3>
                  {selectedTemplate ? <pre className="no-scrollbar max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--td-border)] bg-[var(--td-bg)] p-4 text-[10.5pt] leading-6 text-[var(--td-text-soft)]">{selectedTemplate.content}</pre> : <p className="rounded-xl border border-[var(--td-border)] bg-[var(--td-bg)] p-4 text-[11pt] text-[var(--td-muted)]">テンプレなし。自由記入欄とコピー対象だけで使えます。</p>}
                </section>

                <section className="rounded-2xl border border-[var(--td-border)] bg-[var(--td-surface-soft)] p-5">
                  <h3 className="mb-3 text-[13pt] font-bold text-[var(--td-accent)]">自由記入欄</h3>
                  <textarea value={templateInstruction} onChange={(event) => setTemplateInstruction(event.target.value)} placeholder="自由入力" className="h-32 w-full resize-y rounded-xl placeholder:text-neutral-600 border border-[var(--td-border)] bg-[var(--td-bg)] p-4 text-[11pt] leading-7 text-[var(--td-text)] outline-none focus:border-blue-500/50" />
                </section>

                <section className="rounded-2xl border border-[var(--td-border)] bg-[var(--td-surface-soft)] p-5">
                  <h3 className="mb-3 text-[13pt] font-bold text-[var(--td-accent)]">コピー対象</h3>
                  <div className="flex flex-wrap gap-4 text-[11pt] text-[var(--td-text-soft)]">
                    <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={templateIncludeInput} onChange={(event) => setTemplateIncludeInput(event.target.checked)} />Input</label>
                    <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={templateIncludeMemo} onChange={(event) => setTemplateIncludeMemo(event.target.checked)} />メモ</label>
                    <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={templateIncludeOutput} onChange={(event) => setTemplateIncludeOutput(event.target.checked)} />投稿文</label>
                  </div>
                  <button onClick={copyTemplateBundle} className="mt-5 rounded-lg border border-[var(--td-accent-border)] px-4 py-2 text-[11pt] text-[var(--td-accent)] transition hover:bg-[var(--td-accent-bg)]">コピー</button>
                </section>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  };

  const topButtonClass =
    "rounded-lg border border-[var(--td-border-strong)] px-3 py-2 text-[11pt] text-[var(--td-text)] transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]";
  const insertButtonClass =
    "rounded-lg border border-[var(--td-border-strong)] px-3 py-2 text-[11pt] text-[var(--td-text)] transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]";
  const panelButtonClass =
    "rounded-lg border border-[var(--td-border-strong)] px-3 py-1.5 text-[11pt] text-[var(--td-text-soft)] transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]";

  return (
    <main data-theme={themeMode} className="td-app-enter min-h-screen bg-[var(--td-bg)] text-[var(--td-text)] lg:h-screen lg:overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[90] h-[2px] w-full overflow-hidden">
        <div className="td-startup-scan h-full w-[34vw] rounded-full bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_18px_rgba(96,165,250,0.9)]" />
      </div>
      {renderExpandedEditor()}
      {renderCentralFocus()}
      {renderShortcutHelp()}
      {renderTemplatePanel()}
      <style jsx global>{`
        main[data-theme="light"] {
          --td-bg: #f8fafc;
          --td-panel: #ffffff;
          --td-surface: #f1f5f9;
          --td-surface-soft: rgba(241, 245, 249, 0.82);
          --td-editor: #ffffff;
          --td-text: #111827;
          --td-text-soft: #374151;
          --td-muted: #6b7280;
          --td-border: rgba(17, 24, 39, 0.13);
          --td-border-strong: rgba(17, 24, 39, 0.22);
          --td-hover: rgba(37, 99, 235, 0.08);
          --td-overlay: rgba(15, 23, 42, 0.32);
          --td-card-bg: rgba(255, 255, 255, 0.78);
          --td-card-border: rgba(17, 24, 39, 0.13);
          --td-card-border-hover: rgba(37, 99, 235, 0.36);
          --td-accent: #2563eb;
          --td-accent-bg: rgba(37, 99, 235, 0.09);
          --td-accent-border: rgba(37, 99, 235, 0.42);
          --td-accent-shadow: rgba(37, 99, 235, 0.45);
          --td-mark-bg: rgba(37, 99, 235, 0.14);
        }
        main[data-theme="dark"] {
          --td-bg: #0f172a;
          --td-panel: #111827;
          --td-surface: #162033;
          --td-surface-soft: rgba(22, 32, 51, 0.74);
          --td-editor: #111827;
          --td-text: #e5e7eb;
          --td-text-soft: #cbd5e1;
          --td-muted: #94a3b8;
          --td-border: rgba(148, 163, 184, 0.18);
          --td-border-strong: rgba(148, 163, 184, 0.30);
          --td-hover: rgba(37, 99, 235, 0.12);
          --td-overlay: rgba(15, 23, 42, 0.78);
          --td-card-bg: rgba(17, 24, 39, 0.72);
          --td-card-border: rgba(148, 163, 184, 0.18);
          --td-card-border-hover: rgba(96, 165, 250, 0.38);
          --td-accent: #60a5fa;
          --td-accent-bg: rgba(37, 99, 235, 0.14);
          --td-accent-border: rgba(96, 165, 250, 0.46);
          --td-accent-shadow: rgba(96, 165, 250, 0.48);
          --td-mark-bg: rgba(37, 99, 235, 0.24);
        }
        main[data-theme="auto"] {
          --td-bg: #f8fafc;
          --td-panel: #ffffff;
          --td-surface: #f1f5f9;
          --td-surface-soft: rgba(241, 245, 249, 0.82);
          --td-editor: #ffffff;
          --td-text: #111827;
          --td-text-soft: #374151;
          --td-muted: #6b7280;
          --td-border: rgba(17, 24, 39, 0.13);
          --td-border-strong: rgba(17, 24, 39, 0.22);
          --td-hover: rgba(37, 99, 235, 0.08);
          --td-overlay: rgba(15, 23, 42, 0.32);
          --td-card-bg: rgba(255, 255, 255, 0.78);
          --td-card-border: rgba(17, 24, 39, 0.13);
          --td-card-border-hover: rgba(37, 99, 235, 0.36);
          --td-accent: #2563eb;
          --td-accent-bg: rgba(37, 99, 235, 0.09);
          --td-accent-border: rgba(37, 99, 235, 0.42);
          --td-accent-shadow: rgba(37, 99, 235, 0.45);
          --td-mark-bg: rgba(37, 99, 235, 0.14);
        }
        @media (prefers-color-scheme: dark) {
          main[data-theme="auto"] {
            --td-bg: #0f172a;
            --td-panel: #111827;
            --td-surface: #162033;
            --td-surface-soft: rgba(22, 32, 51, 0.74);
            --td-editor: #111827;
            --td-text: #e5e7eb;
            --td-text-soft: #cbd5e1;
            --td-muted: #94a3b8;
            --td-border: rgba(148, 163, 184, 0.18);
            --td-border-strong: rgba(148, 163, 184, 0.30);
            --td-hover: rgba(37, 99, 235, 0.12);
            --td-overlay: rgba(15, 23, 42, 0.78);
            --td-card-bg: rgba(17, 24, 39, 0.72);
            --td-card-border: rgba(148, 163, 184, 0.18);
            --td-card-border-hover: rgba(96, 165, 250, 0.38);
            --td-accent: #60a5fa;
            --td-accent-bg: rgba(37, 99, 235, 0.14);
            --td-accent-border: rgba(96, 165, 250, 0.46);
            --td-accent-shadow: rgba(96, 165, 250, 0.48);
            --td-mark-bg: rgba(37, 99, 235, 0.24);
          }
        }
        @keyframes td-startup-scan {
          0% {
            transform: translateX(-40vw);
            opacity: 0;
          }
          12% {
            opacity: 1;
          }
          78% {
            opacity: 0.9;
          }
          100% {
            transform: translateX(120vw);
            opacity: 0;
          }
        }
        .td-startup-scan {
          animation: td-startup-scan 1.15s ease-out 1 both;
        }
        @keyframes td-app-enter {
          0% {
            opacity: 0;
            transform: translateY(6px);
            filter: blur(2px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
            filter: blur(0);
          }
        }
        .td-app-enter {
          animation: td-app-enter 0.42s ease-out 1 both;
        }
        textarea, input {
          background: var(--td-editor) !important;
          color: var(--td-text) !important;
        }
        textarea::placeholder, input::placeholder {
          color: var(--td-muted) !important;
        }
        .no-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {obsidianToast && (
        <div className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-xl border border-[var(--td-border-strong)] bg-[var(--td-panel)] px-4 py-2 text-[11pt] text-[var(--td-text-soft)] shadow-lg">
          {obsidianToast}
        </div>
      )}

      {shortcutHint && (
        <div className="fixed left-1/2 top-16 z-[60] -translate-x-1/2 rounded-xl border border-blue-500/40 bg-blue-950/40 px-4 py-2 text-[11pt] text-blue-100 shadow-lg">
          {shortcutHint}
        </div>
      )}

      {draggingPdf && (
        <div
          className="fixed inset-0 z-[70] cursor-col-resize bg-transparent"
          style={{ userSelect: "none" }}
          onMouseMove={(event) => updatePdfWidthFromClientX(event.clientX)}
          onMouseUp={() => setDraggingPdf(false)}
          onMouseLeave={() => setDraggingPdf(false)}
          title="ドラッグしてPDF幅を調整"
        />
      )}

      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handlePdfFileChange}
      />

      <header className="flex min-h-[70px] flex-wrap items-center justify-between gap-3 border-b border-[var(--td-border)] px-6 py-3">
        <div>
          <h1 className="text-[20px] font-bold leading-tight">
            <a
              href={THOUGHTDECK_HOME_URL}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--td-text)] no-underline transition-colors hover:text-[var(--td-text-soft)]"
            >
              ThoughtDeck
            </a>
          </h1>
          <p className="text-[11pt] text-[var(--td-muted)]">Think. Deck. Share.</p>
        </div>

        <div className="hidden flex-wrap items-center justify-end gap-3 lg:flex">
          <span className="text-[11pt] text-blue-400">✔ {saveStatus}</span>
          {copyStatus && (
            <span className="text-[11pt] text-[var(--td-text)]">{copyStatus}</span>
          )}

          <div ref={topMenuRef} data-td-menu-root className="flex items-center gap-2 rounded-xl border border-[var(--td-border)] bg-[var(--td-surface)] p-1">
            <button
              onClick={openOutputComposer}
              className={`${topButtonClass} border-[var(--td-accent-border)] text-[var(--td-accent)]`}
              title="投稿文を作成します"
            >
              投稿作成
            </button>

            <button
              onClick={() => setShowLeft((v) => !v)}
              className={`${topButtonClass} ${showLeft ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]" : ""}`}
              title="Input欄を表示／非表示"
            >
              Input
            </button>

            <button
              onClick={() => setShowRight((v) => !v)}
              className={`${topButtonClass} ${showRight ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]" : ""}`}
              title="メモ欄を表示／非表示"
            >
              メモ
            </button>

            <div className="relative">
              <button
                onClick={() => setOpenTopMenu((v) => (v === "more" ? null : "more"))}
                className={topButtonClass}
                title="その他の機能"
              >
                ︙
              </button>

              {openTopMenu === "more" && (
                <div className="absolute right-0 z-40 mt-2 w-[320px] rounded-xl border border-[var(--td-border)] bg-[var(--td-bg)] p-3 shadow-2xl">
                  <p className="mb-2 text-[10pt] text-[var(--td-muted)]">よく使う操作</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { openMemoEditor(); setOpenTopMenu(null); }} className={topButtonClass}>メモ編集</button>
                    <button onClick={() => { togglePdf(); setOpenTopMenu(null); }} className={`${topButtonClass} ${pdfUrl ? "border-[var(--td-accent-border)] text-[var(--td-accent)]" : ""}`}>
                      {!pdfUrl ? "PDFを開く" : isPdfOpen ? "PDF非表示" : "PDF表示"}
                    </button>
                    <button onClick={() => { setShowShortcutHelp(true); setOpenTopMenu(null); }} className={topButtonClass}>使い方</button>
                    <button onClick={() => { changePerspective(); setOpenTopMenu(null); }} className={topButtonClass}>視点: {perspective.label}</button>
                    <button onClick={() => { setShowTemplatePanel(true); setOpenTopMenu(null); }} className={topButtonClass}>テンプレ</button>
                  </div>

                  <div className="mt-3 border-t border-[var(--td-border)] pt-3">
                    <p className="mb-2 text-[10pt] text-[var(--td-muted)]">リンク</p>
                    <div className="grid grid-cols-2 gap-2">
                      {allQuickLinks.map((link, index) => {
                        const isCustom = index >= defaultQuickLinks.length;
                        return (
                          <div key={`${link.label}-${link.url}-${index}`} className="flex min-w-0 items-center gap-1">
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`${topButtonClass} min-w-0 flex-1 truncate text-center no-underline`}
                              style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                              onClick={(event) => handleResourceLinkClick(event, link.url)}
                            >
                              {link.label}
                            </a>
                            {isCustom && (
                              <button
                                onClick={() => removeCustomLink(index - defaultQuickLinks.length)}
                                className="rounded-lg border border-[var(--td-border)] px-2 py-2 text-[10pt] text-[var(--td-muted)] hover:border-red-800 hover:text-red-400"
                                title="削除"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                      <input
                        value={customLinkLabel}
                        onChange={(event) => setCustomLinkLabel(event.target.value)}
                        placeholder="表示名"
                        className="min-w-0 rounded-lg border border-[var(--td-border)] bg-[var(--td-panel)] px-3 py-2 text-[10.5pt] text-[var(--td-text)] outline-none focus:border-blue-500/50"
                      />
                      <input
                        value={customLinkUrl}
                        onChange={(event) => setCustomLinkUrl(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") addCustomLink();
                        }}
                        placeholder="https://..."
                        className="min-w-0 rounded-lg border border-[var(--td-border)] bg-[var(--td-panel)] px-3 py-2 text-[10.5pt] text-[var(--td-text)] outline-none focus:border-blue-500/50"
                      />
                      <button onClick={addCustomLink} className={topButtonClass}>追加</button>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-[var(--td-border)] pt-3">
                    <p className="mb-2 text-[10pt] text-[var(--td-muted)]">テーマ</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(["auto", "light", "dark"] as ThemeMode[]).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => { setThemeMode(mode); setOpenTopMenu(null); }}
                          className={`${topButtonClass} ${themeMode === mode ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]" : ""}`}
                        >
                          {themeLabel(mode)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 border-t border-[var(--td-border)] pt-3">
                    <p className="mb-2 text-[10pt] text-[var(--td-muted)]">エクスポート</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => { downloadMd(); setOpenTopMenu(null); }} className={topButtonClass}>MD保存</button>
                      <button onClick={() => { copyMd(); setOpenTopMenu(null); }} className={topButtonClass}>MDコピー</button>
                      <button onClick={() => { saveToObsidian(); setOpenTopMenu(null); }} className={topButtonClass}>Obsidian保存</button>
                      <button onClick={() => { createShare(); setOpenTopMenu(null); }} className={topButtonClass}>QR表示</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={clearAll}
              className="rounded-lg border border-red-800 px-3 py-2 text-[11pt] text-red-400 transition hover:bg-red-950/40"
            >
              クリア
            </button>
          </div>
        </div>

        <div className="text-[11pt] text-[var(--td-text)] lg:hidden">
          ✔ {saveStatus}
          {copyStatus ? ` / ${copyStatus}` : ""}
        </div>
      </header>

      {showQr && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex min-h-[100dvh] items-center justify-center overflow-hidden bg-black/70 px-4 py-6 text-slate-100 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowQr(false);
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
                  setCopyStatus("URLをコピーしました");
                }}
                className="min-h-10 rounded-lg border border-slate-500/80 bg-slate-900 px-3 py-2 text-[10.5pt] text-white transition hover:border-slate-200 hover:bg-slate-800 sm:text-[11pt]"
              >
                URLコピー
              </button>
              <button
                onClick={() => setShowQr(false)}
                className="min-h-10 rounded-lg border border-slate-500/80 bg-slate-900 px-3 py-2 text-[10.5pt] text-white transition hover:border-slate-200 hover:bg-slate-800 sm:text-[11pt]"
              >
                閉じる
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}


      <div className="flex h-[calc(100vh-70px)] overflow-hidden max-lg:h-auto max-lg:flex-col max-lg:overflow-visible">
        {pdfSide === "left" && isPdfOpen && renderPdfPanel()}
        {pdfSide === "left" && isPdfOpen && renderPdfDivider()}

        {pdfUrl && isPdfOpen ? (
          renderPdfWorkspace()
        ) : (
          <>
            {showLeft && (
              <>
                <aside
                  className="no-scrollbar w-full shrink-0 overflow-auto border-r border-[var(--td-border)] p-5 max-lg:border-b max-lg:border-r-0 lg:w-[var(--left-width)]"
                  style={{ "--left-width": `${leftWidth}px` } as CSSProperties}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-[13pt] font-bold text-[var(--td-text)]">インプット</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={openInputEditor} className={panelButtonClass}>編集</button>
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-5 gap-2">
                    <button onClick={() => insertTemplate("top")} className={insertButtonClass} title="上部1カラムを追加">＋上</button>
                    <button onClick={() => insertTemplate("left")} className={insertButtonClass} title="左カードを追加">＋左</button>
                    <button onClick={() => insertTemplate("center")} className={insertButtonClass} title="中央カードを追加">＋中</button>
                    <button onClick={() => insertTemplate("right")} className={insertButtonClass} title="右カードを追加">＋右</button>
                    <button onClick={() => insertTemplate("bottom")} className={insertButtonClass} title="下部1カラムを追加">＋下</button>
                  </div>

                  <textarea
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    placeholder="ここにInputを書きます..."
                    className="no-scrollbar h-[calc(100vh-205px)] w-full resize-none rounded-xl border border-[var(--td-border-strong)] bg-[var(--td-panel)] p-4 font-mono text-[11pt] leading-6 outline-none focus:border-[var(--td-border-strong)] max-lg:h-[42vh]"
                  />
                </aside>
                <button
                  onClick={() => setShowLeft(false)}
                  className="hidden w-9 shrink-0 border-r border-[var(--td-border)] bg-[var(--td-panel)] text-[12pt] text-[var(--td-text)] transition hover:bg-[var(--td-hover)] lg:block"
                  title="Inputを閉じる"
                >
                  ◀
                </button>
                <div onMouseDown={() => setDraggingLeft(true)} className="w-1 cursor-col-resize bg-[var(--td-border)] hover:bg-neutral-500 max-lg:hidden" />
              </>
            )}

            {!showLeft && (
              <button onClick={() => setShowLeft(true)} className="hidden w-9 shrink-0 border-r border-[var(--td-border)] bg-[var(--td-panel)] text-[11pt] text-[var(--td-text)] hover:bg-[var(--td-hover)] lg:block" title="Inputを開く">▶</button>
            )}

            {renderThoughtArea()}

            {!showRight && (
              <button onClick={() => setShowRight(true)} className="hidden w-9 shrink-0 border-l border-[var(--td-border)] bg-[var(--td-panel)] text-[11pt] text-[var(--td-text)] hover:bg-[var(--td-hover)] lg:block" title="Memoを開く">◀</button>
            )}

            {showRight && (
              <>
                <div onMouseDown={() => setDraggingRight(true)} className="w-1 cursor-col-resize bg-[var(--td-border)] hover:bg-neutral-500 max-lg:hidden" />
                <button
                  onClick={() => setShowRight(false)}
                  className="hidden w-9 shrink-0 border-l border-[var(--td-border)] bg-[var(--td-panel)] text-[12pt] text-[var(--td-text)] transition hover:bg-[var(--td-hover)] lg:block"
                  title="メモを閉じる"
                >
                  ▶
                </button>
                <aside
                  ref={memoRef}
                  className="no-scrollbar w-full shrink-0 overflow-auto border-l border-[var(--td-border)] p-5 max-lg:border-l-0 max-lg:border-t lg:w-[var(--right-width)]"
                  style={{ "--right-width": `${rightWidth}px` } as CSSProperties}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-[13pt] font-bold text-[var(--td-text)]">メモ</h2>
                    <div className="flex items-center gap-2">
                      <button onClick={openMemoEditor} className={panelButtonClass}>編集</button>
                    </div>
                  </div>
                  <section
                    onClick={() => setSelectedCardId("td-memo")}
                    className={`no-scrollbar h-[calc(100vh-150px)] w-full cursor-pointer overflow-auto rounded-xl border p-4 text-[11pt] leading-6 text-[var(--td-text)] transition max-lg:h-[34vh] ${
                      selectedCardId === "td-memo"
                        ? selectedThoughtClass
                        : "border-[var(--td-border)] bg-[var(--td-surface-soft)] hover:border-[var(--td-border-strong)]"
                    }`}
                  >
                    {renderMarkdownBlocks(memo, "編集ボタンから、授業中の気づき・違和感・発言メモを自由に書きます。")}
                  </section>
                  <p className="mt-2 text-right text-[11pt] text-[var(--td-muted)]">文字数：{memo.length}</p>
                </aside>
              </>
            )}
          </>
        )}

        {pdfSide === "right" && isPdfOpen && renderPdfDivider()}
        {pdfSide === "right" && isPdfOpen && renderPdfPanel()}
      </div>

      <footer className="sticky bottom-0 z-30 border-t border-[var(--td-border)] bg-[var(--td-bg)] p-2 lg:hidden">
        <div data-td-menu-root className="mx-auto flex max-w-md items-center justify-between gap-2 rounded-2xl border border-[var(--td-border)] bg-[var(--td-surface)] p-1.5 shadow-2xl">
          <button
            onClick={openOutputComposer}
            className={`${topButtonClass} flex-1 border-[var(--td-accent-border)] text-[var(--td-accent)]`}
            title="投稿文を作成します"
          >
            投稿
          </button>

          <button
            onClick={toggleMemoAndScroll}
            className={`${topButtonClass} flex-1 ${showRight ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]" : ""}`}
            title={showRight ? "メモ欄を閉じる" : "メモ欄までスクロール"}
          >
            {showRight ? "▼ メモ" : "▶ メモ"}
          </button>

          <button
            onClick={createShare}
            className={`${topButtonClass} flex-1`}
            title="QRを表示します"
          >
            QR
          </button>

          <div className="relative">
            <button
              onClick={() => setOpenTopMenu((v) => (v === "more" ? null : "more"))}
              className={`${topButtonClass} min-w-11 px-3`}
              title="その他の機能"
            >
              ︙
            </button>

            {openTopMenu === "more" && (
              <div className="absolute bottom-12 right-0 z-50 w-[260px] rounded-2xl border border-[var(--td-border)] bg-[var(--td-bg)] p-3 shadow-2xl">
                <p className="mb-2 text-[10pt] text-[var(--td-muted)]">スマホでは補助機能をここに集約</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { setShowLeft((v) => !v); setOpenTopMenu(null); }} className={topButtonClass}>{showLeft ? "Input非表示" : "Input表示"}</button>
                  <button onClick={() => { setShowShortcutHelp(true); setOpenTopMenu(null); }} className={topButtonClass}>使い方</button>
                  <button onClick={() => { setThemeMode((mode) => nextThemeMode(mode)); setOpenTopMenu(null); }} className={topButtonClass}>テーマ</button>
                  <button onClick={() => { downloadMd(); setOpenTopMenu(null); }} className={topButtonClass}>MD保存</button>
                  <button onClick={() => { copyMd(); setOpenTopMenu(null); }} className={topButtonClass}>MDコピー</button>
                  <button onClick={() => { saveToObsidian(); setOpenTopMenu(null); }} className={topButtonClass}>Obsidian</button>
                  <button onClick={() => { setShowTemplatePanel(true); setOpenTopMenu(null); }} className={topButtonClass}>テンプレ</button>
                </div>
                <button
                  onClick={() => { clearAll(); setOpenTopMenu(null); }}
                  className="mt-2 w-full rounded-lg border border-red-800 px-3 py-2 text-[11pt] text-red-400 hover:bg-red-950/40"
                >
                  クリア
                </button>
              </div>
            )}
          </div>
        </div>
      </footer>
    </main>
  );
}
