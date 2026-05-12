export const THOUGHT_GARDEN_STORAGE_KEY =
  "thoughtgarden:seeds:v1";

export type GardenLayer = {
  id: string;
  createdAt: string;
  content: string;
};

export type GardenSeed = {
  id: string;
  title: string;
  state: "seed" | "growing" | "withered";
  createdAt: string;
  lastSeenAt: string;
  nextReviewAt: string;
  loopCount: number;
  rating: number;
  viewCount: number;
  totalDwellMs: number;
  activeLayerIndex: number;
  layers: GardenLayer[];
};

function addDays(value: string, days: number) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    date.setTime(Date.now());
  }

  date.setDate(date.getDate() + days);

  return date.toISOString();
}

function getNextReviewDate(
  loopCount: number,
) {
  const now = new Date();

  let days = 1;

  if (loopCount >= 4) {
    days = 30;
  } else if (loopCount >= 3) {
    days = 7;
  } else if (loopCount >= 2) {
    days = 3;
  }

  now.setDate(now.getDate() + days);

  return now.toISOString();
}

function generateSeedTitle(
  content: string,
) {
  const normalized = content.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return "Untitled Note";
  }

  if (normalized.length <= 20) {
    return normalized;
  }

  return `${normalized.slice(0, 20)}…`;
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[\s、。,.!?]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalizeLayer(value: Partial<GardenLayer>) {
  return {
    id: value.id || crypto.randomUUID(),
    createdAt: value.createdAt || new Date().toISOString(),
    content: value.content || "",
  };
}

function normalizeSeed(value: Partial<GardenSeed>) {
  const now = new Date().toISOString();
  const createdAt = value.createdAt || now;
  const layers = Array.isArray(value.layers)
    ? value.layers.map(normalizeLayer)
    : [];

  return {
    id: value.id || crypto.randomUUID(),
    title:
      value.title ||
      generateSeedTitle(layers.at(-1)?.content ?? ""),
    state:
      value.state === "growing" || value.state === "withered"
        ? value.state
        : "seed",
    createdAt,
    lastSeenAt: value.lastSeenAt || createdAt,
    nextReviewAt: value.nextReviewAt || addDays(createdAt, 1),
    loopCount: value.loopCount ?? 0,
    rating:
      typeof value.rating === "number"
        ? Math.min(5, Math.max(0, Math.round(value.rating)))
        : (value as Partial<GardenSeed> & { star?: boolean }).star
          ? 5
          : 0,
    viewCount:
      typeof value.viewCount === "number"
        ? Math.max(0, Math.round(value.viewCount))
        : 0,
    totalDwellMs:
      typeof value.totalDwellMs === "number"
        ? Math.max(0, Math.round(value.totalDwellMs))
        : 0,
    activeLayerIndex:
      typeof value.activeLayerIndex === "number" &&
      value.activeLayerIndex >= 0 &&
      value.activeLayerIndex < layers.length
        ? value.activeLayerIndex
        : 0,
    layers,
  } satisfies GardenSeed;
}

export function createGardenSeed(
  title: string,
  content: string,
) {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title:
      title.trim() ||
      generateSeedTitle(content),
    state: "seed",
    createdAt: now,
    lastSeenAt: now,
    nextReviewAt: getNextReviewDate(0),
    loopCount: 0,
    rating: 0,
    viewCount: 0,
    totalDwellMs: 0,
    activeLayerIndex: 0,
    layers: [
      {
        id: crypto.randomUUID(),
        createdAt: now,
        content: content.trim(),
      },
    ],
  } satisfies GardenSeed;
}

export function appendGardenLayer(
  seed: GardenSeed,
  content: string,
) {
  const now = new Date().toISOString();
  const nextLoopCount = seed.loopCount + 1;

  return {
    ...seed,
    state: "growing",
    lastSeenAt: now,
    nextReviewAt: getNextReviewDate(nextLoopCount),
    loopCount: nextLoopCount,
    activeLayerIndex: seed.layers.length,
    layers: [
      ...seed.layers,
      {
        id: crypto.randomUUID(),
        createdAt: now,
        content: content.trim(),
      },
    ],
  } satisfies GardenSeed;
}

export function updateLatestGardenLayer(
  seed: GardenSeed,
  content: string,
) {
  const latestLayer =
    seed.layers.at(-1);

  if (!latestLayer) {
    return seed;
  }

  return {
    ...seed,
    layers: seed.layers.map((layer) =>
      layer.id === latestLayer.id
        ? {
            ...layer,
            content,
          }
        : layer,
    ),
  } satisfies GardenSeed;
}

export function updateActiveGardenLayer(
  seed: GardenSeed,
  content: string,
) {
  const activeLayer =
    seed.layers[seed.activeLayerIndex] ?? seed.layers[0];

  if (!activeLayer) {
    return seed;
  }

  return {
    ...seed,
    lastSeenAt: new Date().toISOString(),
    layers: seed.layers.map((layer) =>
      layer.id === activeLayer.id
        ? {
            ...layer,
            content,
          }
        : layer,
    ),
  } satisfies GardenSeed;
}

export function removeLatestGardenLayer(
  seed: GardenSeed,
) {
  if (seed.layers.length <= 1) {
    return seed;
  }

  return {
    ...seed,
    activeLayerIndex: Math.min(
      seed.activeLayerIndex,
      seed.layers.length - 2,
    ),
    layers: seed.layers.slice(0, -1),
  } satisfies GardenSeed;
}

export function updateGardenSeedTitle(
  seed: GardenSeed,
  title: string,
) {
  return {
    ...seed,
    lastSeenAt: new Date().toISOString(),
    title:
      title.trim() ||
      generateSeedTitle(
        seed.layers[seed.activeLayerIndex]?.content ??
          seed.layers.at(-1)?.content ??
          "",
      ),
  } satisfies GardenSeed;
}

export function advanceGardenLayer(seed: GardenSeed) {
  if (seed.layers.length <= 1) {
    return seed;
  }

  return {
    ...seed,
    activeLayerIndex:
      (seed.activeLayerIndex + 1) % seed.layers.length,
  } satisfies GardenSeed;
}

export function recordGardenSeedDwell(
  seed: GardenSeed,
  dwellMs: number,
) {
  const normalizedDwellMs = Math.max(0, Math.round(dwellMs));

  if (normalizedDwellMs < 3000) {
    return seed;
  }

  return {
    ...seed,
    viewCount: seed.viewCount + 1,
    totalDwellMs: seed.totalDwellMs + normalizedDwellMs,
    lastSeenAt: new Date().toISOString(),
  } satisfies GardenSeed;
}

export function updateGardenSeedState(
  seed: GardenSeed,
  state: GardenSeed["state"],
) {
  return {
    ...seed,
    state,
    lastSeenAt: new Date().toISOString(),
    nextReviewAt:
      state === "growing"
        ? getNextReviewDate(seed.loopCount + 1)
        : seed.nextReviewAt,
  } satisfies GardenSeed;
}

export function updateGardenSeedRating(
  seed: GardenSeed,
  rating: number,
) {
  return {
    ...seed,
    rating: Math.min(5, Math.max(0, Math.round(rating))),
    lastSeenAt: new Date().toISOString(),
  } satisfies GardenSeed;
}

export function revisitGardenSeed(seed: GardenSeed) {
  const nextLoopCount = seed.loopCount + 1;

  return {
    ...seed,
    loopCount: nextLoopCount,
    lastSeenAt: new Date().toISOString(),
    nextReviewAt: getNextReviewDate(nextLoopCount),
  } satisfies GardenSeed;
}

export function isDormantSeed(
  seed: GardenSeed,
) {
  const lastSeen = new Date(seed.lastSeenAt).getTime();

  if (Number.isNaN(lastSeen)) {
    return false;
  }

  const THIRTY_DAYS =
    1000 * 60 * 60 * 24 * 30;

  return Date.now() - lastSeen >= THIRTY_DAYS;
}

export function findResonatingSeeds(
  target: GardenSeed,
  seeds: GardenSeed[],
) {
  const targetText = [
    target.title,
    target.layers.at(-1)?.content ?? "",
  ].join(" ");

  const targetTokens = new Set(
    tokenize(targetText),
  );

  return seeds
    .filter((seed) => seed.id !== target.id)
    .map((seed) => {
      const compareText = [
        seed.title,
        seed.layers.at(-1)?.content ?? "",
      ].join(" ");

      const compareTokens = tokenize(compareText);

      const overlap = compareTokens.filter((token) =>
        targetTokens.has(token),
      ).length;

      return {
        seed,
        overlap,
      };
    })
    .filter((item) => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 2)
    .map((item) => item.seed);
}

export function buildGardenMarkdown(
  seeds: GardenSeed[],
) {
  const lines = ["# Notes", ""];

  seeds.forEach((seed) => {
    lines.push("## Note");
    lines.push("");
    lines.push(`id: ${seed.id}`);
    lines.push(`title: ${seed.title}`);
    lines.push(`state: ${seed.state}`);
    lines.push(`rating: ${seed.rating}`);
    lines.push(`viewCount: ${seed.viewCount}`);
    lines.push(`totalDwellMs: ${seed.totalDwellMs}`);
    lines.push(`activeLayerIndex: ${seed.activeLayerIndex}`);
    lines.push(`loopCount: ${seed.loopCount}`);
    lines.push(`updated: ${seed.lastSeenAt}`);
    lines.push(`nextReviewAt: ${seed.nextReviewAt}`);
    lines.push("");

    seed.layers.forEach((layer) => {
      lines.push("### Layer");
      lines.push("");
      lines.push(layer.content);
      lines.push("");
    });
  });

  return lines.join("\n").trimEnd() + "\n";
}

function readGardenMeta(
  text: string,
  key: string,
) {
  const match = text.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));

  return match?.[1]?.trim() ?? "";
}

export function parseGardenMarkdown(
  markdown: string,
): GardenSeed[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const seedBlocks = normalized
    .split(/^## (?:Seed|Note)\s*$/m)
    .slice(1);

  return seedBlocks
    .map((block) => {
      const [metaBlock = "", ...layerBlocks] =
        block.split(/^### Layer\s*$/m);
      const updated = readGardenMeta(metaBlock, "updated");
      const title = readGardenMeta(metaBlock, "title");
      const layers = layerBlocks
        .map((layerBlock) => layerBlock.trim())
        .filter(Boolean)
        .map((content) => ({
          id: crypto.randomUUID(),
          createdAt: updated || new Date().toISOString(),
          content,
        }));

      return normalizeSeed({
        id: readGardenMeta(metaBlock, "id"),
        title,
        state: readGardenMeta(metaBlock, "state") as GardenSeed["state"],
        createdAt: updated || undefined,
        lastSeenAt: updated || undefined,
        nextReviewAt:
          readGardenMeta(metaBlock, "nextReviewAt") || undefined,
        loopCount:
          Number(readGardenMeta(metaBlock, "loopCount")) || 0,
        rating:
          Number(readGardenMeta(metaBlock, "rating")) ||
          (readGardenMeta(metaBlock, "star") === "true" ? 5 : 0),
        viewCount:
          Number(readGardenMeta(metaBlock, "viewCount")) || 0,
        totalDwellMs:
          Number(readGardenMeta(metaBlock, "totalDwellMs")) || 0,
        activeLayerIndex:
          Number(readGardenMeta(metaBlock, "activeLayerIndex")) ||
          0,
        layers,
      });
    })
    .filter((seed) => seed.layers.length > 0);
}

export function loadGardenSeeds() {
  if (typeof window === "undefined") return [];

  try {
    const saved = localStorage.getItem(
      THOUGHT_GARDEN_STORAGE_KEY,
    );
    const parsed = JSON.parse(saved || "[]") as Partial<GardenSeed>[];

    return Array.isArray(parsed)
      ? parsed.map(normalizeSeed)
      : [];
  } catch {
    return [];
  }
}

export function saveGardenSeeds(
  seeds: GardenSeed[],
) {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    THOUGHT_GARDEN_STORAGE_KEY,
    JSON.stringify(seeds),
  );
}
