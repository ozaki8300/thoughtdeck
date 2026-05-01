import { notFound } from "next/navigation";

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

export default async function DeckPage({ params }: DeckPageProps) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("decks")
    .select("title, raw, output, memo")
    .eq("id", id)
    .maybeSingle<SharedDeck>();

  if (error) {
    console.error("deck page fetch error:", error);
    return (
      <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-100">
        <section className="mx-auto max-w-4xl rounded-xl border border-slate-700 bg-slate-900 p-6">
          <h1 className="text-xl font-bold">Deckの取得に失敗しました</h1>
          <p className="mt-3 text-sm text-slate-300">時間をおいてもう一度開いてください。</p>
        </section>
      </main>
    );
  }

  if (!data) notFound();

  const title = data.title?.trim() || "タイトル未設定";
  const raw = data.raw?.trim() || "（Inputなし）";
  const output = data.output?.trim() || "（投稿文なし）";
  const memo = data.memo?.trim() || "（メモなし）";

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 border-b border-slate-800 pb-5">
          <p className="text-sm text-blue-300">ThoughtDeck</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{title}</h1>
        </header>

        <div className="grid gap-5">
          <ReadOnlySection title="Input" value={raw} />
          <ReadOnlySection title="投稿文" value={output} />
          <ReadOnlySection title="メモ" value={memo} />
        </div>
      </div>
    </main>
  );
}

function ReadOnlySection({ title, value }: { title: string; value: string }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="mb-3 text-base font-bold text-blue-300">{title}</h2>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-slate-100">
        {value}
      </pre>
    </section>
  );
}
