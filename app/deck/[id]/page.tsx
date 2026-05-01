"use client";

import { useEffect, useState, use } from "react";
import { supabase } from "../../../lib/supabase";

type Params = Promise<{ id: string }>;

export default function DeckPage(props: { params: Params }) {
  const params = use(props.params);
  const [deck, setDeck] = useState<any>(null);

  useEffect(() => {
    const fetchDeck = async () => {
      const { data, error } = await supabase
        .from("decks")
        .select("*")
        .eq("id", params.id)
        .single();

      if (error) {
        console.error("取得エラー:", error);
        return;
      }

      setDeck(data);
    };

    fetchDeck();
  }, [params.id]);

  if (!deck) {
    return <div style={{ padding: 20 }}>読み込み中...</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>{deck.title}</h1>

      <h3>raw</h3>
      <pre>{deck.raw}</pre>

      <h3>memo</h3>
      <pre>{deck.memo}</pre>

      <h3>output</h3>
      <pre>{deck.output}</pre>
    </div>
  );
}