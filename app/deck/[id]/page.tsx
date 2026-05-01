"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

export default function DeckPage({ params }: any) {
  const [deck, setDeck] = useState<any>(null);

  useEffect(() => {
    const fetchDeck = async () => {
      const { data, error } = await supabase
        .from("decks")
        .select("*")
        .eq("id", params.id)
        .single();

      if (error) {
        console.error(error);
        return;
      }

      setDeck(data);
    };

    fetchDeck();
  }, [params.id]);

  if (!deck) return <div>読み込み中...</div>;

  return (
    <div style={{ padding: 20 }}>
      <h1>{deck.title}</h1>
      <pre>{deck.raw}</pre>
      <pre>{deck.memo}</pre>
      <pre>{deck.output}</pre>
    </div>
  );
}