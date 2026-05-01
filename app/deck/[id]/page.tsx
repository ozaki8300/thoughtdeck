"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function DeckPage() {
  const params = useParams();
  const id = params?.id as string;

  const [deck, setDeck] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchDeck = async () => {
      console.log("🟡 id:", id);

      const { data, error } = await supabase
        .from("decks")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        console.error("❌ supabase error:", error);
        setErrorMsg(error.message);
        return;
      }

      if (!data) {
        setErrorMsg("データが見つかりません");
        return;
      }

      console.log("✅ data:", data);
      setDeck(data);
    };

    fetchDeck();
  }, [id]);

  if (errorMsg) return <div>{errorMsg}</div>;
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