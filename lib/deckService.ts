import { nanoid } from "nanoid";
import { supabase } from "./supabase";

type DeckPayload = {
  title: string;
  raw: string;
  memo: string;
  output: string;
};

export async function createDeck(deck: DeckPayload) {
  const id = nanoid();

  console.log("🔥 createDeck called");
  console.log("🔥 generated id:", id);

  const { error } = await supabase
    .from("decks")
    .insert({ id, ...deck });

  if (error) {
    console.error("🔥 insert error:", JSON.stringify(error, null, 2));
    throw error;
  }

  return id;
}

export async function updateDeck(id: string, deck: DeckPayload) {
  const { error } = await supabase
    .from("decks")
    .update(deck)
    .eq("id", id);

  if (error) throw error;
}

export async function createWorkspaceRevision({
  deckId,
  title,
  raw,
  memo,
  output,
}: {
  deckId: string;
  title: string;
  raw: string;
  memo: string;
  output: string;
}) {
  await updateDeck(deckId, {
    title,
    raw,
    memo,
    output,
  });
}

export async function createPublicationSnapshot({
  deckId,
  title,
  raw,
  memo,
  output,
  publicationId,
  publishedAt,
}: {
  deckId: string;
  title: string;
  raw: string;
  memo: string;
  output: string;
  publicationId: string;
  publishedAt: string;
}) {
  void publicationId;
  void publishedAt;

  // publication snapshots must become append-only immutable entities
  // current implementation still writes into mutable workspace deck
  // future phase:
  // publication table separation
  // immutable publication persistence
  await updateDeck(deckId, {
    title,
    raw,
    memo,
    output,
  });
}
