"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export default function DeckPage() {
  const params = useParams();
  const rawId = params?.id;

  // ⭐ 修正ポイント
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const [deck, setDeck] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchDeck = async () => {
      console.log("🟡 id:", id);

      const res = await fetch(`/api/deck/${id}`);

      const data = await res.json();

      console.log("🔵 API response:", data);

      if (res.status === 404) {
        setNotFound(true);
        return;
      }

      if (!res.ok) {
        setErrorMsg(data?.error || "Deckの取得に失敗しました");
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

  if (notFound) {
    return (
      <div className="flex h-screen flex-col items-center justify-center text-white">
        <h1 className="mb-4 text-2xl font-bold">このDeckは期限切れです</h1>
        <p className="text-sm text-slate-400">
          保存用URLから復元してください
        </p>
      </div>
    );
  }

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