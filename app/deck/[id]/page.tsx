import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
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
  return `/thoughtdeck?d=${compressToEncodedURIComponent(JSON.stringify(deck))}`;
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

  const headersList = await headers();
  const host =
    headersList.get("x-forwarded-host") ??
    headersList.get("host") ??
    "localhost:3000";
  const proto =
    headersList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const request = { url: `${proto}://${host}` };
  const url = new URL(longUrl, request.url);
  url.searchParams.set("ro", "1");
  redirect(url.toString());
}
