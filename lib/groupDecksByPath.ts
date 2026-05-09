export type GroupableDeck = {
  relativePath?: string;
  updated_at?: string;
  created_at?: string;
  trigger?: string;
};

export type DeckGroup<T> = {
  groupKey: string;
  latestUpdatedAt: string;
  memoryCue: string;
  deckCount: number;
  items: T[];
};

const UNGROUPED_GROUP_KEY = "Ungrouped";

function getGroupKey(relativePath?: string) {
  if (!relativePath) {
    return UNGROUPED_GROUP_KEY;
  }

  const lastSeparatorIndex = relativePath.lastIndexOf("/");

  if (lastSeparatorIndex <= 0) {
    return UNGROUPED_GROUP_KEY;
  }

  return relativePath.slice(0, lastSeparatorIndex);
}

function getDeckUpdatedAt(deck: GroupableDeck) {
  return deck.updated_at || deck.created_at || "";
}

function getTime(value: string) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function groupDecksByPath<T extends GroupableDeck>(
  decks: T[],
): DeckGroup<T>[] {
  const groups = new Map<string, DeckGroup<T>>();

  for (const deck of decks) {
    const groupKey = getGroupKey(deck.relativePath);
    const existingGroup = groups.get(groupKey);

    if (existingGroup) {
      existingGroup.items.push(deck);
      existingGroup.deckCount = existingGroup.items.length;

      const updatedAt = getDeckUpdatedAt(deck);

      if (getTime(updatedAt) > getTime(existingGroup.latestUpdatedAt)) {
        existingGroup.latestUpdatedAt = updatedAt;
        existingGroup.memoryCue = deck.trigger ?? "";
      }

      continue;
    }

    groups.set(groupKey, {
      groupKey,
      latestUpdatedAt: getDeckUpdatedAt(deck),
      memoryCue: deck.trigger ?? "",
      deckCount: 1,
      items: [deck],
    });
  }

  return Array.from(groups.values());
}
