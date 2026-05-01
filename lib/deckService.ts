import { supabase } from "./supabase";

type DeckPayload = {
  title: string;
  raw: string;
  memo: string;
  output: string;
};

export async function createDeck(deck: DeckPayload) {
  const { data, error } = await supabase
    .from("decks")
    .insert(deck)
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function updateDeck(id: string, deck: DeckPayload) {
  const { error } = await supabase
    .from("decks")
    .update(deck)
    .eq("id", id);

  if (error) throw error;
}
