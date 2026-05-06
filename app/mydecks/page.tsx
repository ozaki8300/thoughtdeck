"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Deck = {
  deck_id: string;
  title: string;
  created_at: string;
  star: number;
  trigger: string;
};

type SavedDeck = Partial<Deck> & {
  deckId?: string | null;
};

type QrHistoryItem = {
  id: string;
  created_at: string;
  title: string;
  thoughtdeck_url: string;
};

const STORAGE_KEY = "thoughtdeck:mydecks:v1";
const QR_HISTORY_STORAGE_KEY = "thoughtdeck:qr-history:v1";
const DRAFT_STORAGE_KEY = "thoughtdeck:draft:v1";

function loadSavedDecks() {
  if (typeof window === "undefined") return [];

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const decks = JSON.parse(saved || "[]") as SavedDeck[];
    if (!saved) return [];

    const normalized = decks.map((deck) => ({
      deck_id: deck.deck_id ?? deck.deckId ?? "",
      title: deck.title ?? "Untitled Deck",
      created_at: deck.created_at ?? "",
      star: deck.star ?? 0,
      trigger: deck.trigger ?? "",
    }));

    return Array.from(
      new Map(normalized.map((deck) => [deckKey(deck), deck])).values(),
    );
  } catch {
    return [];
  }
}

function loadQrHistory() {
  if (typeof window === "undefined") return [];

  try {
    const saved = localStorage.getItem(QR_HISTORY_STORAGE_KEY);
    return saved ? (JSON.parse(saved) as QrHistoryItem[]) : [];
  } catch {
    return [];
  }
}

function readFrontmatter(text: string) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  return match?.[1] ?? "";
}

function unquoteYaml(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  return trimmed;
}

function getYamlValue(yaml: string, key: string) {
  const match = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return match ? unquoteYaml(match[1]) : "";
}

function getYamlBlock(yaml: string, key: "raw" | "memo" | "output") {
  const match = yaml.match(
    new RegExp(`^${key}: \\|\\n([\\s\\S]*?)(?=\\n\\w|$)`, "m"),
  );

  if (!match) return "";

  return match[1]
    .split("\n")
    .map((line) => line.replace(/^  /, ""))
    .join("\n")
    .trimEnd();
}

function getYamlRowBlock(
  yaml: string,
  key: "raw" | "memo" | "output",
) {
  const lines = yaml.split("\n");

  let inRow = false;
  let capture = false;

  const result: string[] = [];

  for (const line of lines) {
    // row開始
    if (line.trim() === "row:") {
      inRow = true;
      continue;
    }

    if (!inRow) continue;

    // row終了（トップレベルkey）
    if (
      !line.startsWith("  ") &&
      /^[a-zA-Z0-9_-]+:/.test(line)
    ) {
      break;
    }

    // key: |
    if (
      new RegExp(`^  ${key}: \\|$`).test(line)
    ) {
      capture = true;
      continue;
    }

    // key: ""
    const inline = line.match(
      new RegExp(`^  ${key}:\\s*"(.*)"$`),
    );

    if (inline) {
      return inline[1];
    }

    // block終了
    if (
      capture &&
      line.startsWith("  ") &&
      !line.startsWith("    ")
    ) {
      break;
    }

    // block本文
    if (capture) {
      result.push(line.replace(/^    /, ""));
    }
  }

  return result.join("\n").trim();
}

function getBodySection(text: string, label: string) {
  const match = text.match(
    new RegExp(`^## .*${label}\\n([\\s\\S]*?)(?=\\n---\\n\\n## |\\n---\\s*$|$)`, "m"),
  );
  const value = match?.[1]?.trim() ?? "";
  return value === "_(empty)_" ? "" : value;
}

function getTitleFromRaw(raw: string) {
  const line = raw
    .split("\n")
    .find((value) => /^#{1,3}\s+/.test(value.trim()));

  return line ? line.replace(/^#{1,3}\s+/, "").trim() : "Untitled Deck";
}

function stripFrontmatter(text: string) {
  return text.replace(/^---[\s\S]*?---\n?/, "");
}

function stripObsidianSections(text: string) {
  return text
    .replace(/## 🧠 Raw\s*/, "")
    .replace(/---\s*## ✍️ Memo[\s\S]*?---\s*/, "")
    .replace(/## 📤 Output[\s\S]*$/, "");
}

function extractSections(text: string) {
  const memoMatch = text.match(/## ✍️ Memo\s*([\s\S]*?)\n---/);
  const outputMatch = text.match(/## 📤 Output\s*([\s\S]*)$/);

  return {
    memo: memoMatch ? memoMatch[1].trim() : "",
    output: outputMatch ? outputMatch[1].trim() : "",
  };
}

function getMemoPreview(memo: string) {
  const line = memo.split("\n").find((value) => value.trim());
  return line ? line.replace(/^#{1,6}\s+/, "").trim() : "（メモなし）";
}

function generateTrigger(raw: string, memo: string, output: string) {
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

function formatDate(value: string) {
  if (!value) return "日時なし";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseDeck(text: string): Deck | null {
  const yaml = readFrontmatter(text);

  const type = getYamlValue(yaml, "type") || getYamlValue(yaml, "format");
  if (type !== "thoughtdeck") return null;

  const raw =
    getYamlRowBlock(yaml, "raw") ||
    getYamlBlock(yaml, "raw") ||
    getBodySection(text, "Raw");
  const memo =
    getYamlRowBlock(yaml, "memo") ||
    getYamlBlock(yaml, "memo") ||
    getBodySection(text, "Memo");
  const output =
    getYamlRowBlock(yaml, "output") ||
    getYamlBlock(yaml, "output") ||
    getBodySection(text, "Output");

  const title =
    getYamlValue(yaml, "title") || getTitleFromRaw(raw);

  const created_at =
    getYamlValue(yaml, "created_at") ||
    new Date().toISOString();

  const deck_id =
    getYamlValue(yaml, "deck_id");

  return {
    deck_id,
    title,
    created_at,
    star: 0,
    trigger: generateTrigger(raw, memo, output),
  };
}

function deckKey(deck: Deck) {
  return deck.deck_id || deck.title + deck.created_at;
}

export default function MyDecksPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [decks, setDecks] = useState<Deck[]>(loadSavedDecks);
  const [qrHistory] = useState<QrHistoryItem[]>(loadQrHistory);
  const [filterMode, setFilterMode] = useState<"all" | "star">("all");
  const [importMessage, setImportMessage] = useState("");
  const [highlightedKeys, setHighlightedKeys] = useState<string[]>([]);
  const [hasDraft, setHasDraft] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const sortedDecks = [...decks].sort((a, b) => {
    if (b.star !== a.star) return b.star - a.star;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const visibleDecks = sortedDecks.filter((deck) =>
    filterMode === "star" ? deck.star >= 3 : true,
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
  }, [decks]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHasDraft(!!localStorage.getItem(DRAFT_STORAGE_KEY));
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const loaded = (
      await Promise.all(files.map(async (file) => parseDeck(await file.text())))
    ).filter((deck): deck is Deck => Boolean(deck));

    if (loaded.length === 0) {
      setImportMessage("ThoughtDeck形式のファイルが見つかりませんでした");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const loadedKeys = loaded.map(deckKey);
    const currentKeys = new Set(decks.map(deckKey));
    const updatedCount = loadedKeys.filter((key) => currentKeys.has(key)).length;
    const addedCount = loaded.length - updatedCount;

    setDecks((current) => {
      const next = [...current];

      for (const imported of loaded) {
        const index = next.findIndex(
          (deck) =>
            (deck.deck_id &&
              imported.deck_id &&
              deck.deck_id === imported.deck_id) ||
            deck.title === imported.title,
        );

        if (index >= 0) {
          next[index] = imported;
        } else {
          next.push(imported);
        }
      }

      return next;
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
    setHighlightedKeys(loadedKeys);
    setImportMessage(`${addedCount}件追加 / ${updatedCount}件更新`);
    window.setTimeout(() => setHighlightedKeys([]), 1200);
    window.setTimeout(() => setImportMessage(""), 3000);

    if (fileRef.current) fileRef.current.value = "";
  };

  const openDeck = (deck: Deck) => {
    if (!deck.deck_id) return;

    window.location.assign(
      `/thoughtdeck?resume=${deck.deck_id}`,
    );
  };

  const removeDeck = (event: React.MouseEvent<HTMLButtonElement>, key: string) => {
    event.stopPropagation();
    setDecks((current) => current.filter((deck) => deckKey(deck) !== key));
  };

  const updateStar = (
    event: React.MouseEvent<HTMLButtonElement>,
    key: string,
    star: number,
  ) => {
    event.stopPropagation();
    setDecks((current) =>
      current.map((deck) => (deckKey(deck) === key ? { ...deck, star } : deck)),
    );
  };

  return (
    <main className="mydecks-page td-app-enter min-h-screen overflow-x-hidden bg-[var(--td-bg)] px-5 py-6 text-[var(--td-text)]">
      <style jsx global>{`
        .mydecks-page {
          --td-bg: #0f172a;
          --td-panel: rgba(15, 23, 42, 0.88);
          --td-surface-soft: rgba(22, 32, 51, 0.74);
          --td-border: rgba(148, 163, 184, 0.18);
          --td-border-strong: rgba(148, 163, 184, 0.32);
          --td-text: #e5e7eb;
          --td-text-soft: #cbd5e1;
          --td-muted: #94a3b8;
          --td-hover: rgba(37, 99, 235, 0.12);
          --td-card-bg: rgba(17, 24, 39, 0.72);
          --td-card-border-hover: rgba(96, 165, 250, 0.38);
          --td-accent: #93c5fd;
          --td-accent-bg: rgba(37, 99, 235, 0.14);
          --td-accent-border: rgba(96, 165, 250, 0.46);
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
      `}</style>
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-sans text-xl font-bold text-[var(--td-text)]">My Decks</h1>
            <p className="font-sans mt-1 text-sm text-[var(--td-muted)]">Think. Deck. Share.</p>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".md,text/markdown,text/plain"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              handleFiles(files);
            }}
          />
        </header>

        <div className="grid gap-6">
          <section
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);

              const files = Array.from(event.dataTransfer.files);
              handleFiles(files);
            }}
            className={`grid gap-4 transition ${
              isDragging ? "border-[var(--td-accent-border)] bg-[var(--td-hover)]" : ""
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setFilterMode("all")}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                    filterMode === "all"
                      ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]"
                      : "border-[var(--td-border-strong)] text-[var(--td-muted)] hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)]"
                  }`}
                >
                  すべて
                </button>
                <button
                  onClick={() => setFilterMode("star")}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                    filterMode === "star"
                      ? "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]"
                      : "border-[var(--td-border-strong)] text-[var(--td-muted)] hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)]"
                  }`}
                >
                  ⭐3以上
                </button>
              </div>

              {importMessage && (
                <span className="break-words text-sm text-[var(--td-accent)]">{importMessage}</span>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {hasDraft && (
                  <button
                    onClick={() => router.push("/thoughtdeck")}
                    className="rounded-lg border border-[var(--td-border-strong)] px-4 py-2 text-sm text-[var(--td-text)] transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)]"
                  >
                    ▶ 再開
                  </button>
                )}

                <div className="hidden sm:flex gap-2">
                <button
                  onClick={() => router.push("/thoughtdeck?new=1")}
                  className="rounded-lg border border-[var(--td-border-strong)] px-4 py-2 text-sm text-[var(--td-text)] transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)]"
                >
                  ＋ 新規作成
                </button>

                <button
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg border border-[var(--td-accent-border)] px-4 py-2 text-sm text-[var(--td-accent)] transition hover:bg-[var(--td-hover)]"
                >
                  取り込む
                </button>
                </div>
              </div>
            </div>

            {decks.length === 0 ? (
              <div className="rounded-xl border border-[var(--td-border)] bg-[var(--td-card-bg)] p-5 text-sm text-[var(--td-muted)]">
                <p>Obsidianで保存したMarkdownを取り込むと、ここにDeckが並びます。</p>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="mt-4 rounded-lg border border-[var(--td-accent-border)] px-4 py-2 text-sm text-[var(--td-accent)] transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)]"
                >
                  取り込む
                </button>
                <p className="mt-2 text-xs text-[var(--td-muted)]">
                  複数ファイル選択できます
                </p>
              </div>
            ) : (
              visibleDecks.map((deck) => {
                const key = deckKey(deck);

                return (
                  <article
                    key={key}
                    onClick={() => openDeck(deck)}
                    className={`group min-w-0 overflow-hidden cursor-pointer rounded-xl border border-[var(--td-border)] p-4 transition transform hover:scale-[1.01] hover:border-[var(--td-card-border-hover)] hover:bg-[var(--td-hover)] hover:shadow-lg ${
                      highlightedKeys.includes(key) ? "bg-[var(--td-hover)]" : "bg-[var(--td-card-bg)]"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-start justify-between gap-3 overflow-hidden">
                        <h2 className="min-w-0 flex-1 truncate text-sm text-[var(--td-muted)]">
                          {deck.title}
                        </h2>
                        <div className="flex shrink-0 gap-0.5">
                          {[1, 2, 3, 4, 5].map((value) => (
                            <button
                              key={value}
                              onClick={(event) => updateStar(event, key, value)}
                              className={`text-sm transition hover:text-yellow-300 ${
                                value <= deck.star ? "text-yellow-400" : "text-[var(--td-muted)]"
                              }`}
                              title={`${value} stars`}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--td-muted)]">{formatDate(deck.created_at)}</p>
                      <p className="mt-2 line-clamp-2 text-base font-medium leading-6 text-[var(--td-text)]">
                        {deck.trigger ? deck.trigger : "（要約なし）"}
                      </p>
                    </div>

                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={(event) => removeDeck(event, key)}
                        className="rounded-md border border-[var(--td-border-strong)] px-3 py-1.5 text-xs text-[var(--td-muted)] transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)]"
                      >
                        削除
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </section>

          <section className="rounded-xl border border-[var(--td-border)] bg-[var(--td-card-bg)] p-4">
            <h2 className="text-sm font-semibold text-[var(--td-text)]">QR履歴</h2>
            <div className="mt-3 grid gap-3">
              {qrHistory.length === 0 ? (
                <div className="rounded-lg border border-[var(--td-border)] bg-[var(--td-surface-soft)] p-3 text-sm text-[var(--td-muted)]">
                  QR履歴はまだありません。
                </div>
              ) : (
                qrHistory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => window.location.assign(item.thoughtdeck_url)}
                    className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--td-border)] bg-[var(--td-surface-soft)] p-3 text-left transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)]"
                  >
                    <span className="block min-w-0 truncate text-sm font-semibold text-[var(--td-text)]">
                      {item.title || "Untitled Deck"}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--td-muted)]">
                      {formatDate(item.created_at)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
        {isDragging && (
          <div className="pointer-events-none fixed inset-0 flex items-center justify-center bg-black/40 text-lg text-[var(--td-text)]">
            ファイルをドロップして更新
          </div>
        )}
      </div>
    </main>
  );
}
