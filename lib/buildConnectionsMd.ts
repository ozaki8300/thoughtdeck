export type ConnectionDeck = {
  deck_id: string;
  title: string;
  group_id?: string;
  forked_from_deck_id?: string;
  genre?: string;
  subject?: string;
  unit?: string;
  links?: string[];
  triggers?: string[];
  relativePath?: string;
};

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function cleanWikiLabel(value: string) {
  return value
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/[#^]/g, " ")
    .trim();
}

function wiki(value: string) {
  const label = cleanWikiLabel(value);

  return label ? `[[${label}]]` : "";
}

function semanticTitle(value: string) {
  const title = value.trim();
  const timestampTitle = title.match(
    /^TD_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(.+)$/,
  );

  return timestampTitle?.[1]?.trim() || title;
}

function shortTitle(value: string, maxLength = 14) {
  const title = semanticTitle(value);

  if (title.length <= maxLength) {
    return title;
  }

  return `${title.slice(0, maxLength - 1)}…`;
}

function deckLabel(deck: ConnectionDeck) {
  const title = shortTitle(deck.title || "Untitled Deck");
  const prefix = [
    deck.subject,
    deck.unit,
  ]
    .filter(Boolean)
    .join(" ");

  return prefix ? `${prefix} | ${title}` : title;
}

function pathLabel(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

function section(title: string, lines: string[]) {
  if (lines.length === 0) {
    return `## ${title}\n\n_(none)_`;
  }

  return `## ${title}\n\n${lines.join("\n")}`;
}

export function buildConnectionsMd(decks: ConnectionDeck[]) {
  const sortedDecks = [...decks].sort((a, b) =>
    deckLabel(a).localeCompare(deckLabel(b)),
  );
  const deckLinks = unique(
    sortedDecks
      .map((deck) => wiki(deckLabel(deck)))
      .filter(Boolean),
  );
  const relatedLines = unique(
    sortedDecks.flatMap((deck) =>
      (deck.links ?? []).map((link) => {
        const target = wiki(pathLabel(link));
        const source = wiki(deckLabel(deck));

        return target && source
          ? `- ${source} -> ${target}`
          : "";
      }),
    ),
  );
  const resonanceLines = unique(
    sortedDecks.flatMap((deck) =>
      (deck.triggers ?? []).map((trigger) => {
        const source = wiki(deckLabel(deck));
        const target = wiki(trigger);

        return source && target
          ? `- ${source} -> ${target}`
          : "";
      }),
    ),
  );
  const deckById = new Map(
    sortedDecks.map((deck) => [deck.deck_id, deck]),
  );
  const forkLines = unique(
    sortedDecks.map((deck) => {
      const parentId = deck.forked_from_deck_id;
      const parent = parentId ? deckById.get(parentId) : null;

      if (!parent) return "";

      return `- ${wiki(deckLabel(parent))} -> ${wiki(deckLabel(deck))}`;
    }),
  );

  return [
    "# Thought Connections",
    "",
    "Open this note and use Obsidian Local Graph to explore connected ideas.",
    "",
    section("Decks", deckLinks),
    "",
    section("Related", relatedLines),
    "",
    section("Resonance", resonanceLines),
    "",
    section("Forks", forkLines),
    "",
  ].join("\n");
}
