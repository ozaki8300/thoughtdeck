"use client";

import { useRouter } from "next/navigation";
import {
  Fragment,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  appendGardenLayer,
  buildGardenMarkdown,
  createGardenSeed,
  findResonatingSeeds,
  isDormantSeed,
  loadGardenSeeds,
  parseGardenMarkdown,
  removeLatestGardenLayer,
  revisitGardenSeed,
  saveGardenSeeds,
  toggleGardenSeedStar,
  updateGardenSeedState,
  updateGardenSeedTitle,
  updateLatestGardenLayer,
  type GardenSeed,
} from "@/lib/thoughtGarden";

const GARDEN_DB_NAME = "thoughtgarden-vault";
const GARDEN_STORE_NAME = "settings";
const GARDEN_DIRECTORY_HANDLE_KEY =
  "thoughtgarden:directory-handle";
const GARDEN_FILE_NAME = "ThoughtGarden.md";

declare global {
  interface Window {
    showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemHandlePermissionDescriptor {
    mode?: "read" | "readwrite";
  }

  interface FileSystemDirectoryHandle {
    getFileHandle: (
      name: string,
      options?: { create?: boolean },
    ) => Promise<FileSystemFileHandle>;
    queryPermission: (
      descriptor?: FileSystemHandlePermissionDescriptor,
    ) => Promise<PermissionState>;
    requestPermission: (
      descriptor?: FileSystemHandlePermissionDescriptor,
    ) => Promise<PermissionState>;
  }
}

function formatUpdated(value: string) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function canUseDirectoryPicker() {
  return (
    typeof window !== "undefined" &&
    "showDirectoryPicker" in window
  );
}

function openGardenDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(GARDEN_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(GARDEN_STORE_NAME)) {
        db.createObjectStore(GARDEN_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveGardenDirectoryHandle(
  handle: FileSystemDirectoryHandle,
) {
  const db = await openGardenDB();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(GARDEN_STORE_NAME, "readwrite");

    tx
      .objectStore(GARDEN_STORE_NAME)
      .put(handle, GARDEN_DIRECTORY_HANDLE_KEY);
    tx.oncomplete = () => {
      localStorage.setItem(GARDEN_DIRECTORY_HANDLE_KEY, "saved");
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function loadGardenDirectoryHandle() {
  const db = await openGardenDB();

  return new Promise<FileSystemDirectoryHandle | null>(
    (resolve, reject) => {
      const tx = db.transaction(GARDEN_STORE_NAME, "readonly");
      const request = tx
        .objectStore(GARDEN_STORE_NAME)
        .get(GARDEN_DIRECTORY_HANDLE_KEY);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    },
  );
}

async function ensureGardenDirectoryPermission(
  handle: FileSystemDirectoryHandle,
) {
  const options = { mode: "readwrite" as const };
  const query = await handle.queryPermission(options);

  if (query === "granted") {
    return true;
  }

  const request = await handle.requestPermission(options);

  return request === "granted";
}

async function resolveGardenDirectoryHandle() {
  const savedHandle = await loadGardenDirectoryHandle();

  if (
    savedHandle &&
    (await ensureGardenDirectoryPermission(savedHandle))
  ) {
    return savedHandle;
  }

  if (!canUseDirectoryPicker()) {
    throw new Error(
      "File System Access API is not available in this browser.",
    );
  }

  const pickedHandle = await window.showDirectoryPicker();

  await saveGardenDirectoryHandle(pickedHandle);

  if (!(await ensureGardenDirectoryPermission(pickedHandle))) {
    throw new Error("Permission was not granted.");
  }

  return pickedHandle;
}

async function writeGardenMarkdownFile(
  directoryHandle: FileSystemDirectoryHandle,
  markdown: string,
) {
  const fileHandle = await directoryHandle.getFileHandle(
    GARDEN_FILE_NAME,
    { create: true },
  );
  const writable = await fileHandle.createWritable();

  await writable.write(markdown);
  await writable.close();
}

async function readGardenMarkdownFile(
  directoryHandle: FileSystemDirectoryHandle,
) {
  const fileHandle =
    await directoryHandle.getFileHandle(GARDEN_FILE_NAME);
  const file = await fileHandle.getFile();

  return file.text();
}

function previewLayer(seed: GardenSeed) {
  const latest = seed.layers.at(-1)?.content.trim() ?? "";

  if (latest.length <= 80) {
    return latest || "No layer yet.";
  }

  return `${latest.slice(0, 79)}…`;
}

function pickTodaySeeds(seeds: GardenSeed[]) {
  const activeSeeds = seeds.filter(
    (seed) => seed.state !== "withered",
  );
  const dormantSeeds = activeSeeds.filter(isDormantSeed);
  const now = Date.now();
  const dueSeeds = activeSeeds.filter((seed) => {
    const reviewTime = new Date(seed.nextReviewAt).getTime();

    return !Number.isNaN(reviewTime) && reviewTime <= now;
  });
  const candidateSeeds =
    dueSeeds.length > 0
      ? dueSeeds
      : activeSeeds;

  const starredSeeds = shuffleSeeds(
    candidateSeeds.filter((seed) => seed.star),
  );
  const unstarredSeeds = shuffleSeeds(
    candidateSeeds.filter((seed) => !seed.star),
  );
  const selectedSeeds = [
    ...starredSeeds,
    ...unstarredSeeds,
  ].slice(0, 3);

  if (
    selectedSeeds.length === 0 ||
    dormantSeeds.length === 0 ||
    selectedSeeds.some((selectedSeed) =>
      isDormantSeed(selectedSeed),
    ) ||
    Math.random() >= 0.1
  ) {
    return selectedSeeds;
  }

  const dormantSeed = shuffleSeeds(dormantSeeds).find(
    (seed) =>
      !selectedSeeds.some(
        (selectedSeed) => selectedSeed.id === seed.id,
      ),
  );

  if (!dormantSeed) {
    return selectedSeeds;
  }

  return [
    ...selectedSeeds.slice(0, Math.max(0, selectedSeeds.length - 1)),
    dormantSeed,
  ];
}

function shuffleSeeds(seeds: GardenSeed[]) {
  const shuffled = [...seeds];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];

    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }

  return shuffled;
}

function stateBadgeClass(state: GardenSeed["state"]) {
  if (state === "growing") {
    return "border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] text-[var(--td-accent)]";
  }

  if (state === "withered") {
    return "border-[var(--td-border)] bg-[var(--td-surface-soft)] text-[var(--td-muted)]";
  }

  return "border-[var(--td-border)] bg-[var(--td-bg)] text-[var(--td-text-soft)]";
}

export default function ThoughtGardenPage() {
  const router = useRouter();
  const [seeds, setSeeds] = useState<GardenSeed[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [expandedSeedId, setExpandedSeedId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [showWithered, setShowWithered] = useState(false);
  const [viewMode, setViewMode] =
    useState<"garden" | "table">("garden");
  const [isGardenBrowseOpen, setIsGardenBrowseOpen] =
    useState(false);
  const [editingLayerSeedId, setEditingLayerSeedId] = useState("");
  const [editingLayerContent, setEditingLayerContent] = useState("");
  const [expandedGrowSeedId, setExpandedGrowSeedId] = useState("");
  const [resolvedTodaySeedIds, setResolvedTodaySeedIds] = useState<
    string[]
  >([]);
  const [growTextBySeed, setGrowTextBySeed] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const loadedSeeds = loadGardenSeeds();

    setSeeds(loadedSeeds);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    saveGardenSeeds(seeds);
  }, [hydrated, seeds]);

  const sortedSeeds = useMemo(
    () =>
      seeds
        .filter((seed) => showWithered || seed.state !== "withered")
        .sort((a, b) =>
          b.lastSeenAt.localeCompare(a.lastSeenAt),
        ),
    [seeds, showWithered],
  );
  const todaySeeds = useMemo(
    () =>
      pickTodaySeeds(seeds).filter(
        (seed) => !resolvedTodaySeedIds.includes(seed.id),
      ),
    [resolvedTodaySeedIds, seeds],
  );

  const createSeed = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!content.trim()) {
      return;
    }

    const seed = createGardenSeed(title, content);

    setSeeds((current) => [seed, ...current]);
    setExpandedSeedId(seed.id);
    setExpandedGrowSeedId("");
    setTitle("");
    setContent("");
  };

  const openSeed = (seedId: string) => {
    const isExpanded = expandedSeedId === seedId;

    if (isExpanded) {
      setExpandedSeedId("");
      setExpandedGrowSeedId("");
      return;
    }

    setSeeds((current) =>
      current.map((seed) =>
        seed.id === seedId
          ? revisitGardenSeed(seed)
          : seed,
      ),
    );
    setExpandedSeedId(seedId);
    setExpandedGrowSeedId("");
  };

  const appendLayer = (seed: GardenSeed) => {
    const growText = growTextBySeed[seed.id]?.trim() ?? "";

    if (!growText) {
      return;
    }

    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? appendGardenLayer(currentSeed, growText)
          : currentSeed,
      ),
    );
    setGrowTextBySeed((current) => ({
      ...current,
      [seed.id]: "",
    }));
    setEditingLayerSeedId("");
    setEditingLayerContent("");
    setExpandedGrowSeedId("");
  };

  const startLatestLayerEdit = (seed: GardenSeed) => {
    setEditingLayerSeedId(seed.id);
    setEditingLayerContent(seed.layers.at(-1)?.content ?? "");
  };

  const cancelLatestLayerEdit = () => {
    setEditingLayerSeedId("");
    setEditingLayerContent("");
  };

  const saveLatestLayerEdit = (seed: GardenSeed) => {
    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? updateLatestGardenLayer(currentSeed, editingLayerContent)
          : currentSeed,
      ),
    );
    cancelLatestLayerEdit();
  };

  const deleteLatestLayer = (seed: GardenSeed) => {
    if (seed.layers.length <= 1) {
      return;
    }

    const confirmed = window.confirm(
      "Delete the latest layer? Earlier layers will stay untouched.",
    );

    if (!confirmed) {
      return;
    }

    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? removeLatestGardenLayer(currentSeed)
          : currentSeed,
      ),
    );
    cancelLatestLayerEdit();
  };

  const updateSeedState = (
    seed: GardenSeed,
    state: GardenSeed["state"],
  ) => {
    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? updateGardenSeedState(currentSeed, state)
          : currentSeed,
      ),
    );
  };

  const resolveTodaySeedState = (
    seed: GardenSeed,
    state: GardenSeed["state"],
  ) => {
    updateSeedState(seed, state);
    setResolvedTodaySeedIds((current) =>
      current.includes(seed.id)
        ? current
        : [...current, seed.id],
    );
  };

  const toggleSeedStar = (seed: GardenSeed) => {
    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? toggleGardenSeedStar(currentSeed)
          : currentSeed,
      ),
    );
  };

  const updateSeedTitle = (
    seed: GardenSeed,
    nextTitle: string,
  ) => {
    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? updateGardenSeedTitle(currentSeed, nextTitle)
          : currentSeed,
      ),
    );
  };

  const exportGarden = async () => {
    const markdown = buildGardenMarkdown(seeds);

    try {
      const directoryHandle =
        await resolveGardenDirectoryHandle();

      await writeGardenMarkdownFile(directoryHandle, markdown);
      alert(`Saved ${GARDEN_FILE_NAME}.`);
    } catch (error) {
      console.error(error);
      alert("Could not export Garden.");
    }
  };

  const restoreGardenFromMarkdown = async () => {
    const confirmed = window.confirm(
      "Replace current garden with exported garden?",
    );

    if (!confirmed) {
      return;
    }

    try {
      const directoryHandle =
        await loadGardenDirectoryHandle();

      if (!directoryHandle) {
        alert("Failed to restore garden.");
        return;
      }

      if (
        !(await ensureGardenDirectoryPermission(directoryHandle))
      ) {
        alert("Failed to restore garden.");
        return;
      }

      const markdown =
        await readGardenMarkdownFile(directoryHandle);
      const parsedSeeds = parseGardenMarkdown(markdown);

      setSeeds(parsedSeeds);
      setResolvedTodaySeedIds([]);
      setExpandedSeedId("");
      setExpandedGrowSeedId("");
      setEditingLayerSeedId("");
      setEditingLayerContent("");
      alert("Garden restored.");
    } catch (error) {
      console.error(error);
      alert("Failed to restore garden.");
    }
  };

  const changeGardenFolder = async () => {
    try {
      if (!canUseDirectoryPicker()) {
        alert(
          "File System Access API is not available in this browser.",
        );
        return;
      }

      const directoryHandle =
        await window.showDirectoryPicker();

      await saveGardenDirectoryHandle(directoryHandle);

      if (
        !(await ensureGardenDirectoryPermission(directoryHandle))
      ) {
        alert("Permission was not granted.");
        return;
      }

      alert("Garden folder updated.");
    } catch (error) {
      console.error(error);
      alert("Could not update Garden folder.");
    }
  };

  const renderExpandedSeed = (seed: GardenSeed) => {
    const resonatingSeeds =
      findResonatingSeeds(seed, seeds);
    const isGrowExpanded = expandedGrowSeedId === seed.id;

    return (
      <div className="grid gap-5">
        <label className="grid gap-2 text-sm text-[var(--td-text-soft)]">
          Title
          <input
            value={seed.title}
            onChange={(event) =>
              updateSeedTitle(seed, event.target.value)
            }
            className="rounded-lg border border-[var(--td-border)] bg-[var(--td-panel)] px-3 py-2 text-sm text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)]"
          />
        </label>

        <div className="relative grid gap-4 pl-5 before:absolute before:bottom-3 before:left-1.5 before:top-3 before:w-px before:bg-[var(--td-border)]">
          {seed.layers.map((layer, index) => (
            <article
              key={layer.id}
              className="relative rounded-xl border border-[var(--td-border)] bg-[var(--td-panel)] p-4 before:absolute before:-left-[1.25rem] before:top-5 before:h-2.5 before:w-2.5 before:rounded-full before:border before:border-[var(--td-border)] before:bg-[var(--td-bg)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 pr-20 text-xs leading-6 text-[var(--td-text-soft)] opacity-75 sm:pr-24">
                <span>Layer {index + 1}</span>
                <span>{formatUpdated(layer.createdAt)}</span>
              </div>
              {index === seed.layers.length - 1 &&
                editingLayerSeedId !== seed.id && (
                  <div className="absolute right-3 top-3 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => startLatestLayerEdit(seed)}
                      className="rounded-lg border border-[var(--td-border)] px-2 py-1 text-xs text-[var(--td-muted)] opacity-70 transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)] hover:text-[var(--td-text)] hover:opacity-100"
                    >
                      Edit
                    </button>
                    {seed.layers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => deleteLatestLayer(seed)}
                        className="rounded-lg border border-transparent px-2 py-1 text-xs text-red-300/60 opacity-70 transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-200 hover:opacity-100"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              {index === seed.layers.length - 1 &&
              editingLayerSeedId === seed.id ? (
                <div className="mt-3 grid gap-2">
                  <textarea
                    value={editingLayerContent}
                    onChange={(event) =>
                      setEditingLayerContent(event.target.value)
                    }
                    rows={5}
                    className="resize-y rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] px-3 py-2 text-sm leading-7 text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)] sm:leading-6"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => saveLatestLayerEdit(seed)}
                      className="rounded-lg border border-[var(--td-accent-border)] px-2.5 py-1.5 text-xs text-[var(--td-accent)] opacity-80 transition hover:bg-[var(--td-hover)] hover:opacity-100 sm:px-3 sm:py-2 sm:text-sm"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelLatestLayerEdit}
                      className="rounded-lg border border-[var(--td-border)] px-2.5 py-1.5 text-xs text-[var(--td-muted)] opacity-75 transition hover:border-[var(--td-border-strong)] hover:bg-[var(--td-hover)] hover:opacity-100 sm:px-3 sm:py-2 sm:text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-4 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-8 text-[var(--td-text)] sm:mt-3 sm:leading-7">
                  {layer.content}
                </p>
              )}
            </article>
          ))}
        </div>

        <div className="rounded-xl border border-[var(--td-border)] bg-[var(--td-bg)]/60 p-4">
          {isGrowExpanded ? (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm text-[var(--td-text-soft)]">
                  Grow this thought
                </p>
                <button
                  type="button"
                  onClick={() => setExpandedGrowSeedId("")}
                  className="rounded-lg border border-[var(--td-border)] px-2 py-1 text-xs text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
                >
                  Close
                </button>
              </div>
              <label className="grid gap-2 text-sm text-[var(--td-text-soft)]">
                <textarea
                  value={growTextBySeed[seed.id] ?? ""}
                  onChange={(event) =>
                    setGrowTextBySeed((current) => ({
                      ...current,
                      [seed.id]: event.target.value,
                    }))
                  }
                  rows={4}
                  className="resize-y rounded-lg border border-[var(--td-border)] bg-[var(--td-panel)] px-3 py-2 text-sm leading-7 text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)] sm:leading-6"
                />
              </label>
              <button
                type="button"
                onClick={() => appendLayer(seed)}
                disabled={!growTextBySeed[seed.id]?.trim()}
                className="mt-3 rounded-lg border border-[var(--td-accent-border)] px-3 py-1.5 text-xs text-[var(--td-accent)] opacity-85 transition hover:bg-[var(--td-hover)] hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4 sm:py-2 sm:text-sm"
              >
                Grow
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setExpandedGrowSeedId(seed.id)}
              className="text-sm text-[var(--td-text-soft)] transition hover:text-[var(--td-accent)]"
            >
              + Grow this thought
            </button>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => toggleSeedStar(seed)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs opacity-80 transition hover:bg-[var(--td-hover)] hover:opacity-100 sm:px-3 sm:py-2 sm:text-sm ${
                seed.star
                  ? "border-[var(--td-accent-border)] text-[var(--td-accent)]"
                  : "border-[var(--td-border)] text-[var(--td-text-soft)] hover:text-[var(--td-text)]"
              }`}
            >
              ★ Still Thinking
            </button>
            <button
              type="button"
              onClick={() => updateSeedState(seed, "growing")}
              className="rounded-lg border border-[var(--td-border)] px-2.5 py-1.5 text-xs text-[var(--td-text-soft)] opacity-80 transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)] hover:text-[var(--td-accent)] hover:opacity-100 sm:px-3 sm:py-2 sm:text-sm"
            >
              🌱 Keep Growing
            </button>
            <button
              type="button"
              onClick={() => updateSeedState(seed, "withered")}
              className="rounded-lg border border-[var(--td-border)] px-2.5 py-1.5 text-xs text-[var(--td-muted)] opacity-75 transition hover:border-[var(--td-border-strong)] hover:bg-[var(--td-hover)] hover:opacity-100 sm:px-3 sm:py-2 sm:text-sm"
            >
              🍂 Wither
            </button>
          </div>
        </div>

        {resonatingSeeds.length > 0 && (
          <section className="rounded-xl border border-[var(--td-border)] bg-[var(--td-panel)] p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--td-muted)]">
              Resonating Seeds
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {resonatingSeeds.map((resonatingSeed) => (
                <button
                  key={resonatingSeed.id}
                  type="button"
                  onClick={() => openSeed(resonatingSeed.id)}
                  className="rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] p-3 text-left transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)]"
                >
                  <p className="line-clamp-1 text-sm font-medium text-[var(--td-text)]">
                    {resonatingSeed.title}
                  </p>
                  <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--td-text)]">
                    {previewLayer(resonatingSeed)}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  };

  return (
    <main
      data-theme="auto"
      className="min-h-screen bg-[var(--td-bg)] px-4 py-6 text-[var(--td-text)] sm:px-5 sm:py-8"
    >
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="font-sans text-xl font-bold text-[var(--td-text)] transition hover:text-[var(--td-accent)]"
            >
              Thought Garden
            </button>
            <p className="mt-1 font-sans text-sm text-[var(--td-text-soft)]">
              Grow your thoughts.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportGarden}
              className="rounded-lg border border-[var(--td-accent-border)] px-3 py-2 text-sm text-[var(--td-accent)] transition hover:bg-[var(--td-hover)]"
            >
              Export Garden
            </button>
            <button
              type="button"
              onClick={restoreGardenFromMarkdown}
              className="rounded-lg border border-[var(--td-border)] px-3 py-2 text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
            >
              Restore Garden
            </button>
            <button
              type="button"
              onClick={changeGardenFolder}
              className="rounded-lg border border-[var(--td-border)] px-3 py-2 text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
            >
              Change Folder
            </button>
          </div>
        </header>

        <div className="grid gap-7 lg:grid-cols-[minmax(18rem,22rem)_1fr]">
          <section className="order-2 rounded-2xl border border-[var(--td-border)] bg-[var(--td-panel)] p-5 shadow-sm lg:order-1">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--td-muted)]">
              New Seed
            </p>
            <h1 className="mt-3 text-2xl font-semibold">
              Leave a thought lightly.
            </h1>

            <form onSubmit={createSeed} className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm text-[var(--td-text-soft)]">
                <span>
                  Title
                  <span className="ml-2 text-xs text-[var(--td-muted)]">
                    Optional
                  </span>
                </span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] px-3 py-2 text-sm text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)]"
                />
              </label>

              <label className="grid gap-2 text-sm text-[var(--td-text-soft)]">
                Content
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  rows={6}
                  className="resize-y rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] px-3 py-2 text-sm leading-6 text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)]"
                />
              </label>

              <button
                type="submit"
                disabled={!content.trim()}
                className="rounded-lg border border-[var(--td-accent-border)] px-4 py-2.5 text-sm text-[var(--td-accent)] transition hover:bg-[var(--td-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Plant Seed
              </button>
            </form>
          </section>

          <div className="order-1 grid gap-7 lg:order-2 lg:gap-6">
            <section className="rounded-2xl border border-[var(--td-border)] bg-[var(--td-panel)] p-5 shadow-sm sm:p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--td-muted)]">
                Today’s Seeds
              </p>
              <p className="mt-2 text-sm text-[var(--td-text-soft)]">
                Revisit thoughts that may still grow.
              </p>

              <div className="mt-5 grid gap-4 md:mt-4 md:grid-cols-3 md:gap-3">
                {todaySeeds.map((seed) => (
                  <article
                    key={seed.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openSeed(seed.id)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" ||
                        event.key === " "
                      ) {
                        event.preventDefault();
                        openSeed(seed.id);
                      }
                    }}
                    className="rounded-xl border border-[var(--td-border)] bg-[var(--td-bg)] p-5 text-left transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)] md:p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-medium text-[var(--td-text)]">
                        {seed.star && (
                          <span className="mr-1 text-[var(--td-accent)]">
                            ★
                          </span>
                        )}
                        {seed.title}
                      </p>
                      {seed.state === "growing" && (
                        <span className="rounded-full border border-[var(--td-accent-border)] bg-[var(--td-accent-bg)] px-2 py-0.5 text-[10px] text-[var(--td-accent)]">
                          still growing
                        </span>
                      )}
                    </div>
                    {isDormantSeed(seed) && seed.state !== "withered" && (
                      <p className="mt-1 text-xs text-[var(--td-muted)]">
                        Long time no revisit.
                      </p>
                    )}
                    <p className="mt-4 line-clamp-4 text-sm leading-7 text-[var(--td-text)] md:mt-3 md:line-clamp-3 md:leading-6">
                      {previewLayer(seed)}
                    </p>
                    <p className="mt-4 text-xs leading-5 text-[var(--td-text-soft)] opacity-70 md:mt-3">
                      {formatUpdated(seed.lastSeenAt)}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[var(--td-text-soft)] opacity-70">
                      Next review: {formatUpdated(seed.nextReviewAt)}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2 md:mt-4">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          resolveTodaySeedState(seed, "growing");
                        }}
                        className="rounded-lg border border-[var(--td-border)] px-2.5 py-1 text-xs text-[var(--td-text-soft)] opacity-75 transition hover:border-[var(--td-accent-border)] hover:bg-[var(--td-hover)] hover:text-[var(--td-accent)] hover:opacity-100"
                      >
                        🌱 Keep
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          resolveTodaySeedState(seed, "withered");
                        }}
                        className="rounded-lg border border-[var(--td-border)] px-2.5 py-1 text-xs text-[var(--td-muted)] opacity-70 transition hover:border-[var(--td-border-strong)] hover:bg-[var(--td-hover)] hover:text-[var(--td-text-soft)] hover:opacity-100"
                      >
                        🍂 Wither
                      </button>
                    </div>
                  </article>
                ))}

                {todaySeeds.length === 0 && (
                  <p className="text-sm text-[var(--td-muted)]">
                    Plant a seed to begin the loop.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  setIsGardenBrowseOpen((current) => !current)
                }
                className="mt-5 w-full rounded-xl border border-[var(--td-border)] px-4 py-3 text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)] lg:hidden"
              >
                {isGardenBrowseOpen
                  ? "Close Garden"
                  : "Browse Garden"}
              </button>
            </section>

            <section
              className={`overflow-hidden rounded-2xl border border-[var(--td-border)] bg-[var(--td-panel)] shadow-sm ${
                isGardenBrowseOpen ? "block" : "hidden"
              } lg:block`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--td-border)] px-5 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--td-muted)]">
                  Seeds
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] p-0.5">
                    {(["garden", "table"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setViewMode(mode)}
                        className={`rounded-md px-3 py-1.5 text-xs transition ${
                          viewMode === mode
                            ? "bg-[var(--td-accent-bg)] text-[var(--td-accent)]"
                            : "text-[var(--td-muted)] hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
                        }`}
                      >
                        {mode === "garden" ? "Garden" : "Table"}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[var(--td-muted)] opacity-70 lg:opacity-100">
                    <input
                      type="checkbox"
                      checked={showWithered}
                      onChange={(event) =>
                        setShowWithered(event.target.checked)
                      }
                      className="h-3.5 w-3.5 accent-[var(--td-accent)]"
                    />
                    Show Withered
                  </label>
                </div>
              </div>

              {viewMode === "garden" ? (
                <div className="grid gap-5 p-4 sm:p-5">
                  {sortedSeeds.map((seed) => {
                    const expanded = expandedSeedId === seed.id;
                    const dormant =
                      isDormantSeed(seed) &&
                      seed.state !== "withered";
                    const resonatingSeed =
                      findResonatingSeeds(seed, seeds)[0];

                    return (
                      <article key={seed.id} className="grid gap-3">
                        <button
                          type="button"
                          onClick={() => openSeed(seed.id)}
                          className={`rounded-2xl border bg-[var(--td-bg)] p-5 text-left transition hover:bg-[var(--td-hover)] md:p-4 ${
                            seed.state === "growing"
                              ? "border-[var(--td-accent-border)]"
                              : "border-[var(--td-border)]"
                          } ${dormant ? "opacity-80" : ""}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {seed.star && (
                              <span className="text-sm text-[var(--td-accent)]">
                                ★
                              </span>
                            )}
                            <p
                              className={`line-clamp-2 text-base font-medium ${
                                seed.star
                                  ? "text-[var(--td-accent)]"
                                  : "text-[var(--td-text)]"
                              }`}
                            >
                              {seed.title}
                            </p>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs leading-5 opacity-75 md:mt-3">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 ${stateBadgeClass(seed.state)}`}
                            >
                              {seed.state}
                            </span>
                            {dormant && (
                              <span className="inline-flex rounded-full border border-[var(--td-border)] bg-[var(--td-surface-soft)] px-2 py-0.5 text-[var(--td-muted)]">
                                🌙 dormant
                              </span>
                            )}
                            <span className="text-[var(--td-text-soft)]">
                              {seed.layers.length} layers
                            </span>
                            <span className="text-[var(--td-text-soft)]">
                              Next review {formatUpdated(seed.nextReviewAt)}
                            </span>
                          </div>

                          <p className="mt-4 line-clamp-4 text-sm leading-7 text-[var(--td-text)] md:mt-3 md:line-clamp-3 md:leading-6">
                            {previewLayer(seed)}
                          </p>

                          {resonatingSeed && (
                            <p className="mt-4 text-xs leading-5 text-[var(--td-muted)] opacity-75 md:mt-3">
                              Resonates with:{" "}
                              <span className="text-[var(--td-text)]">
                                {resonatingSeed.title}
                              </span>
                            </p>
                          )}
                        </button>

                        {expanded && (
                          <div className="rounded-2xl border border-[var(--td-border)] bg-[var(--td-bg)] p-4 sm:p-5">
                            {renderExpandedSeed(seed)}
                          </div>
                        )}
                      </article>
                    );
                  })}

                  {sortedSeeds.length === 0 && (
                    <p className="py-8 text-center text-sm text-[var(--td-muted)]">
                      No seeds yet.
                    </p>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                <thead className="bg-[var(--td-surface-soft)] text-[var(--td-muted)]">
                  <tr>
                    <th className="px-5 py-3 font-medium">★</th>
                    <th className="px-5 py-3 font-medium">state</th>
                    <th className="px-5 py-3 font-medium">title</th>
                    <th className="px-5 py-3 font-medium">layers</th>
                    <th className="px-5 py-3 font-medium">updated</th>
                    <th className="px-5 py-3 font-medium">next review</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSeeds.map((seed) => {
                    const expanded = expandedSeedId === seed.id;
                    const dormant =
                      isDormantSeed(seed) &&
                      seed.state !== "withered";

                    return (
                      <Fragment key={seed.id}>
                        <tr
                          onClick={() => openSeed(seed.id)}
                          className={`cursor-pointer border-t border-[var(--td-border)] transition hover:bg-[var(--td-hover)] ${
                            dormant ? "opacity-80" : ""
                          }`}
                        >
                          <td className="px-5 py-4 text-[var(--td-accent)]">
                            {seed.star ? "★" : ""}
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${stateBadgeClass(seed.state)}`}
                            >
                              {seed.state}
                            </span>
                            {dormant && (
                              <span className="ml-2 inline-flex rounded-full border border-[var(--td-border)] bg-[var(--td-surface-soft)] px-2 py-0.5 text-xs text-[var(--td-muted)]">
                                🌙 dormant
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 font-medium text-[var(--td-text)]">
                            {seed.title}
                          </td>
                          <td className="px-5 py-4 text-[var(--td-text-soft)]">
                            {seed.layers.length}
                          </td>
                          <td className="px-5 py-4 text-[var(--td-text-soft)]">
                            {formatUpdated(seed.lastSeenAt)}
                          </td>
                          <td className="px-5 py-4 text-[var(--td-text-soft)]">
                            {formatUpdated(seed.nextReviewAt)}
                          </td>
                        </tr>

                        {expanded && (
                          <tr>
                            <td
                              colSpan={6}
                              className="border-t border-[var(--td-border)] bg-[var(--td-bg)] px-5 py-5"
                            >
                              {renderExpandedSeed(seed)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}

                  {sortedSeeds.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-10 text-center text-sm text-[var(--td-muted)]"
                      >
                        No seeds yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
