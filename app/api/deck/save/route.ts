import { updateDeck } from "../../../../lib/deckService";

type SaveDeckRequest = {
  id?: unknown;
  title?: unknown;
  raw?: unknown;
  memo?: unknown;
  output?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaveDeckRequest;

    if (
      typeof body.id !== "string" ||
      typeof body.title !== "string" ||
      typeof body.raw !== "string" ||
      typeof body.memo !== "string" ||
      typeof body.output !== "string"
    ) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    await updateDeck(body.id, {
      title: body.title,
      raw: body.raw,
      memo: body.memo,
      output: body.output,
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("deck save route error:", error);
    return Response.json({ error: "Failed to save deck" }, { status: 500 });
  }
}
