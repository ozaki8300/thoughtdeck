import { notFound, redirect } from "next/navigation";
import { compressToEncodedURIComponent } from "lz-string";

import { supabase } from "../../../lib/supabase";

type DeckPageProps = {
  params: Promise<{ id: string }>;
};

type SharedDeck = {
  title: string | null;
  raw: string | null;
  output: string | null;
  memo: string | null;
};

function buildRestoreUrl(
  raw: string,
  memo: string,
  output: string,
  addedCards: [],
  starred: string[],
) {
  const deck = { raw, memo, output, addedCards, starred };
  return `/?d=${compressToEncodedURIComponent(JSON.stringify(deck))}`;
}

export default async function DeckPage({ params }: DeckPageProps) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("decks")
    .select("title, raw, output, memo")
    .eq("id", id)
    .maybeSingle<SharedDeck>();

  if (error || !data) notFound();

  const longUrl = buildRestoreUrl(
    data.raw ?? "",
    data.memo ?? "",
    data.output ?? "",
    [],
    [],
  );

  const url = new URL(longUrl, "http://localhost:3000");
  url.searchParams.set("ro", "1");
  redirect(url.toString());
}
