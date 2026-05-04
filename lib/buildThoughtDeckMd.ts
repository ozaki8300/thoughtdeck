import { getTitle } from "./deckParser";
import { buildRestoreUrl } from "./useDeckState";

type BuildThoughtDeckMdArgs = {
  raw: string;
  memo: string;
  output: string;
  deckId: string | null;
};

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
  const title = getTitle(raw) || "Untitled Deck";
  const userId = getUserId();
  const deckIdFinal = getDeckId(deckId);
  const now = new Date().toISOString();
  const thoughtdeckUrl = buildRestoreUrl(raw, memo, output, [], []);

  return `---
format: thoughtdeck
version: 1

user_id: ${userId}
deck_id: ${deckIdFinal}

created_at: "${yamlSafe(now)}"
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

# ${title}

## 🧠 Raw
${visible(raw)}

---

## ✍️ Memo
${visible(memo)}

---

## 📤 Output
${visible(output)}

---
`;
}
