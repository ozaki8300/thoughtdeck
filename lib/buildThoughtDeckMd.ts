import { buildRestoreUrl } from "./useDeckState";

type BuildThoughtDeckMdArgs = {
  raw: string;
  memo: string;
  output: string;
  deckId: string | null;
};

const CREATED_AT_STORAGE_KEY = "thoughtdeck:created-at:v1";
const DECK_STATE_STORAGE_KEY = "thoughtdeck:data:v9";

function getUserId() {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("td_user_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("td_user_id", id);
  }
  return id;
}

function getDeckId(existingId?: string | null) {
  if (existingId) return existingId;

  if (typeof window === "undefined") {
    return crypto.randomUUID();
  }

  let id = localStorage.getItem("td_current_deck_id");

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("td_current_deck_id", id);
  }

  return id;
}

function getCreatedAt(deckId: string, fallback: string) {
  if (typeof window === "undefined") return fallback;

  try {
    const saved = localStorage.getItem(CREATED_AT_STORAGE_KEY);
    const createdAtByDeck = JSON.parse(saved || "{}") as Record<string, string>;
    const existing = createdAtByDeck[deckId];

    if (existing) return existing;

    const currentDeck = JSON.parse(
      localStorage.getItem(DECK_STATE_STORAGE_KEY) || "{}",
    ) as {
      deckId?: string | null;
      createdAt?: string;
      created_at?: string;
    };
    const restoredCreatedAt =
      currentDeck.deckId === deckId
        ? currentDeck.createdAt || currentDeck.created_at
        : "";

    if (restoredCreatedAt) {
      createdAtByDeck[deckId] = restoredCreatedAt;
      localStorage.setItem(CREATED_AT_STORAGE_KEY, JSON.stringify(createdAtByDeck));
      return restoredCreatedAt;
    }

    createdAtByDeck[deckId] = fallback;
    localStorage.setItem(CREATED_AT_STORAGE_KEY, JSON.stringify(createdAtByDeck));
  } catch {
    return fallback;
  }

  return fallback;
}

function yamlBlock(value: string | null | undefined) {
  const text = value ?? "";
  if (!text) return "    ";

  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function yamlSafe(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

// 変更箇所: Markdown本文で空データを見える形にする
function visible(value: string | null | undefined) {
  return value && value.trim() ? value : "_(empty)_";
}

export function buildThoughtDeckMd({
  raw,
  memo,
  output,
  deckId,
}: BuildThoughtDeckMdArgs) {
  const userId = getUserId();
  const deckIdFinal = getDeckId(deckId);
  const now = new Date().toISOString();
  const createdAt = getCreatedAt(deckIdFinal, now);
  const thoughtdeckUrl = buildRestoreUrl(
    raw,
    memo,
    output,
    [],
    [],
    deckIdFinal,
  );

  return `---
format: thoughtdeck
version: 1

user_id: ${userId}
deck_id: ${deckIdFinal}

created_at: "${yamlSafe(createdAt)}"
updated_at: "${yamlSafe(now)}"

thoughtdeck_url: ${thoughtdeckUrl}

row:
  raw: |
${yamlBlock(raw)}
  memo: |
${yamlBlock(memo)}
  output: |
${yamlBlock(output)}

trigger: []

keywords: []
links: []
---

${visible(raw)}

---

## Memo
${visible(memo)}

---

## Output
${visible(output)}

---
`;
}
