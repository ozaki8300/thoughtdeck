// lib/deckTypes.ts

export type Area = "left" | "center" | "right";

export type ThemeMode = "auto" | "light" | "dark";

export type PdfSide = "left" | "right";

export type PdfWorkMode = "thought" | "input" | "memo" | "output";

export type Card = {
  id: string;
  area: Area;
  content: string;
};

export type ParsedCard = {
  area: Area;
  content: string;
};

export type AddedCard = {
  id: string;
  area: Area;
  content: string;
};

export type OneColumnSection = {
  title?: string;
  cards: Card[];
};

export type ParsedDeck = {
  title: string;
  sections: OneColumnSection[];
};

export type DeckState = {
  raw: string;
  memo: string;
  output: string;
  addedCards: AddedCard[];
  theme: ThemeMode;
};
