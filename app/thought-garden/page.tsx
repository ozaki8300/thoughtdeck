"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  advanceGardenLayer,
  appendGardenLayer,
  buildGardenMarkdown,
  createGardenSeed,
  isDormantSeed,
  loadGardenSeeds,
  parseGardenMarkdown,
  removeLatestGardenLayer,
  revisitGardenSeed,
  saveGardenSeeds,
  toggleGardenSeedStar,
  updateActiveGardenLayer,
  updateGardenSeedState,
  updateGardenSeedTitle,
  type GardenSeed,
} from "@/lib/thoughtGarden";

const GARDEN_DB_NAME = "thoughtgarden-vault";
const GARDEN_STORE_NAME = "settings";
const GARDEN_DIRECTORY_HANDLE_KEY =
  "thoughtgarden:directory-handle";
const GARDEN_FILE_NAME = "Notes.md";

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

function activeLayerContent(seed: GardenSeed) {
  return (
    seed.layers[seed.activeLayerIndex]?.content.trim() ||
    seed.layers[0]?.content.trim() ||
    "No layer yet."
  );
}

type DeepAction = "add-note" | "edit";

export default function ThoughtGardenPage() {
  const router = useRouter();
  const [seeds, setSeeds] = useState<GardenSeed[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isNewNoteOpen, setIsNewNoteOpen] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [deepModeSeedId, setDeepModeSeedId] = useState("");
  const [deepAction, setDeepAction] = useState<{
    seedId: string;
    action: DeepAction;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isGardenBrowseOpen, setIsGardenBrowseOpen] =
    useState(false);
  const [editingLayerContent, setEditingLayerContent] = useState("");
  const [noteTextBySeed, setNoteTextBySeed] = useState<
    Record<string, string>
  >({});
  const longPressTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const longPressTriggeredRef = useRef(false);
  const lastTapAtBySeedRef = useRef<Record<string, number>>({});

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
        .filter((seed) => seed.state !== "withered")
        .sort((a, b) =>
          b.lastSeenAt.localeCompare(a.lastSeenAt),
        ),
    [seeds],
  );
  const todaySeeds = useMemo(() => pickTodaySeeds(seeds), [seeds]);

  const createSeed = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!content.trim()) {
      return;
    }

    const seed = createGardenSeed(title, content);

    setSeeds((current) => [seed, ...current]);
    setDeepAction(null);
    setDeepModeSeedId("");
    setTitle("");
    setContent("");
    setIsNewNoteOpen(false);
  };

  const openDeepAction = (seed: GardenSeed, action: DeepAction) => {
    setDeepModeSeedId(seed.id);
    setDeepAction((current) =>
      current?.seedId === seed.id && current.action === action
        ? null
        : { seedId: seed.id, action },
    );

    if (action === "edit") {
      startLatestLayerEdit(seed);
    } else {
      cancelLatestLayerEdit();
    }
  };

  const clearLongPressTimer = () => {
    if (!longPressTimerRef.current) {
      return;
    }

    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const enterDeepMode = (seed: GardenSeed) => {
    setDeepModeSeedId(seed.id);
    setDeepAction(null);
    cancelLatestLayerEdit();
  };

  const advanceLayer = (seed: GardenSeed) => {
    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? advanceGardenLayer(currentSeed)
          : currentSeed,
      ),
    );
    setDeepModeSeedId("");
    setDeepAction(null);
    cancelLatestLayerEdit();
  };

  const startLongPress = (seed: GardenSeed) => {
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      enterDeepMode(seed);
      longPressTimerRef.current = null;
    }, 520);
  };

  const appendLayer = (seed: GardenSeed) => {
    const noteText = noteTextBySeed[seed.id]?.trim() ?? "";

    if (!noteText) {
      return;
    }

    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? appendGardenLayer(currentSeed, noteText)
          : currentSeed,
      ),
    );
    setNoteTextBySeed((current) => ({
      ...current,
      [seed.id]: "",
    }));
    setEditingLayerContent("");
  };

  const startLatestLayerEdit = (seed: GardenSeed) => {
    setEditingLayerContent(
      seed.layers[seed.activeLayerIndex]?.content ??
        seed.layers[0]?.content ??
        "",
    );
  };

  const cancelLatestLayerEdit = () => {
    setEditingLayerContent("");
  };

  const saveLatestLayerEdit = (seed: GardenSeed) => {
    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? updateActiveGardenLayer(currentSeed, editingLayerContent)
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

  const keepSeed = (seed: GardenSeed) => {
    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? revisitGardenSeed(toggleGardenSeedStar(currentSeed))
          : currentSeed,
      ),
    );
  };

  const witherSeed = (seed: GardenSeed) => {
    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? updateGardenSeedState(currentSeed, "withered")
          : currentSeed,
      ),
    );
    setDeepModeSeedId("");
    setDeepAction(null);
  };

  const handleTouchTap = (seed: GardenSeed) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }

    const now = Date.now();
    const lastTapAt = lastTapAtBySeedRef.current[seed.id] ?? 0;

    if (now - lastTapAt < 320) {
      lastTapAtBySeedRef.current[seed.id] = 0;
      advanceLayer(seed);
      return;
    }

    lastTapAtBySeedRef.current[seed.id] = now;
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
      alert("Could not export Notes.");
    }
  };

  const restoreGardenFromMarkdown = async () => {
    const confirmed = window.confirm(
      "Replace current notes with exported notes?",
    );

    if (!confirmed) {
      return;
    }

    try {
      const directoryHandle =
        await loadGardenDirectoryHandle();

      if (!directoryHandle) {
        alert("Failed to restore notes.");
        return;
      }

      if (
        !(await ensureGardenDirectoryPermission(directoryHandle))
      ) {
        alert("Failed to restore notes.");
        return;
      }

      const markdown =
        await readGardenMarkdownFile(directoryHandle);
      const parsedSeeds = parseGardenMarkdown(markdown);

      setSeeds(parsedSeeds);
      setDeepAction(null);
      setDeepModeSeedId("");
      setEditingLayerContent("");
      alert("Notes restored.");
    } catch (error) {
      console.error(error);
      alert("Failed to restore notes.");
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

      alert("Notes folder updated.");
    } catch (error) {
      console.error(error);
      alert("Could not update Notes folder.");
    }
  };

  const renderDeepPanel = (seed: GardenSeed, action: DeepAction) => {
    return (
      <div className="mt-4 rounded-xl bg-[var(--td-panel)]/35 px-2 py-3">
        {action === "add-note" && (
          <div className="grid gap-3">
            <textarea
              value={noteTextBySeed[seed.id] ?? ""}
              onChange={(event) =>
                setNoteTextBySeed((current) => ({
                  ...current,
                  [seed.id]: event.target.value,
                }))
              }
              rows={4}
              className="resize-y rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] px-3 py-2 text-sm leading-7 text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)] sm:leading-6"
            />
            <button
              type="button"
              onClick={() => appendLayer(seed)}
              disabled={!noteTextBySeed[seed.id]?.trim()}
              className="justify-self-start rounded-lg border border-[var(--td-accent-border)] px-4 py-2 text-sm text-[var(--td-accent)] transition hover:bg-[var(--td-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add note
            </button>
          </div>
        )}

        {action === "edit" && (
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm text-[var(--td-text-soft)]">
              Title
              <input
                value={seed.title}
                onChange={(event) =>
                  updateSeedTitle(seed, event.target.value)
                }
                className="rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] px-3 py-2 text-sm text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)]"
              />
            </label>
            <textarea
              value={editingLayerContent}
              onChange={(event) =>
                setEditingLayerContent(event.target.value)
              }
              rows={6}
              className="resize-y rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] px-3 py-2 text-sm leading-7 text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)] sm:leading-6"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => saveLatestLayerEdit(seed)}
                className="rounded-lg border border-[var(--td-accent-border)] px-4 py-2 text-sm text-[var(--td-accent)] transition hover:bg-[var(--td-hover)]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  cancelLatestLayerEdit();
                  setDeepAction(null);
                }}
                className="rounded-lg border border-[var(--td-border)] px-4 py-2 text-sm text-[var(--td-muted)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSeedCard = (seed: GardenSeed) => {
    const activeAction =
      deepAction?.seedId === seed.id ? deepAction.action : null;
    const isDeepMode = deepModeSeedId === seed.id;

    return (
      <article
        key={seed.id}
        onDoubleClick={() => advanceLayer(seed)}
        onPointerDown={(event) => {
          if (event.pointerType === "touch") {
            startLongPress(seed);
          }
        }}
        onPointerUp={(event) => {
          clearLongPressTimer();

          if (event.pointerType === "touch") {
            handleTouchTap(seed);
          }
        }}
        onPointerCancel={clearLongPressTimer}
        onPointerLeave={clearLongPressTimer}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            advanceLayer(seed);
          }
        }}
        tabIndex={0}
        className="rounded-2xl border border-[var(--td-border)]/35 bg-[var(--td-bg)] p-6 outline-none transition hover:border-[var(--td-border)]/50 hover:bg-[var(--td-hover)]/20 focus:border-[var(--td-border)]/60 md:p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            className={`min-w-0 flex-1 text-lg font-semibold leading-8 ${
              seed.star
                ? "text-[var(--td-accent)]"
                : "text-[var(--td-text)]"
            }`}
          >
            {seed.title}
          </h2>
          <button
            type="button"
            aria-label="Open note actions"
            title="Open note actions"
            onClick={(event) => {
              event.stopPropagation();
              enterDeepMode(seed);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--td-border)]/25 bg-[var(--td-bg)]/20 text-sm leading-none text-[var(--td-text-soft)] opacity-45 transition hover:bg-[var(--td-hover)]/25 hover:opacity-75"
          >
            ⋯
          </button>
        </div>

        <p className="mt-5 whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-9 text-[var(--td-text)] sm:leading-8">
          {activeLayerContent(seed)}
        </p>

        {isDeepMode && (
          <div
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className="mt-4 inline-flex items-center gap-1 rounded-full border border-[var(--td-border)]/20 bg-[var(--td-panel)]/55 p-1 opacity-65 shadow-sm backdrop-blur-sm"
          >
            <button
              type="button"
              aria-label="Add note"
              title="Add note"
              onClick={(event) => {
                event.stopPropagation();
                openDeepAction(seed, "add-note");
              }}
              className="grid h-8 w-8 place-items-center rounded-full border border-[var(--td-border)]/25 bg-[var(--td-bg)]/20 text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)]/35 hover:text-[var(--td-text)]"
            >
              ＋
            </button>
            <button
              type="button"
              aria-label="Edit current layer"
              title="Edit current layer"
              onClick={(event) => {
                event.stopPropagation();
                openDeepAction(seed, "edit");
              }}
              className="grid h-8 w-8 place-items-center rounded-full border border-[var(--td-border)]/25 bg-[var(--td-bg)]/20 text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)]/35 hover:text-[var(--td-text)]"
            >
              ✎
            </button>
            <button
              type="button"
              aria-label="Wither"
              title="Wither"
              onClick={(event) => {
                event.stopPropagation();
                witherSeed(seed);
              }}
              className="grid h-8 w-8 place-items-center rounded-full border border-[var(--td-border)]/25 bg-[var(--td-bg)]/20 text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)]/35 hover:text-[var(--td-text)] disabled:cursor-not-allowed disabled:opacity-30"
            >
              🍂
            </button>
            <button
              type="button"
              aria-label="Keep"
              title="Keep"
              onClick={(event) => {
                event.stopPropagation();
                keepSeed(seed);
              }}
              className="grid h-8 w-8 place-items-center rounded-full border border-[var(--td-border)]/25 bg-[var(--td-bg)]/20 text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)]/35 hover:text-[var(--td-text)]"
            >
              ✦
            </button>
            <button
              type="button"
              aria-label="Delete latest layer"
              title="Delete latest layer"
              onClick={(event) => {
                event.stopPropagation();
                deleteLatestLayer(seed);
              }}
              disabled={seed.layers.length <= 1}
              className="grid h-8 w-8 place-items-center rounded-full border border-[var(--td-border)]/25 bg-[var(--td-bg)]/20 text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)]/35 hover:text-[var(--td-text)] disabled:cursor-not-allowed disabled:opacity-30"
            >
              🗑
            </button>
          </div>
        )}

        {activeAction && renderDeepPanel(seed, activeAction)}
      </article>
    );
  };

  return (
    <main
      data-theme="auto"
      className="min-h-screen bg-[var(--td-bg)] px-4 py-6 text-[var(--td-text)] sm:px-5 sm:py-8"
    >
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="font-sans text-xl font-bold text-[var(--td-text)] transition hover:text-[var(--td-accent)]"
            >
              Notes
            </button>
          </div>
          <div className="relative">
            <button
              type="button"
              aria-label="Notes menu"
              title="Notes menu"
              onClick={() =>
                setIsHeaderMenuOpen((current) => !current)
              }
              className="grid h-10 w-10 place-items-center rounded-full border border-[var(--td-border)] text-xl leading-none text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
            >
              ⋯
            </button>
            {isHeaderMenuOpen && (
              <div className="absolute right-0 top-12 z-20 grid min-w-40 gap-1 rounded-xl border border-[var(--td-border)] bg-[var(--td-panel)] p-2 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setIsHeaderMenuOpen(false);
                    exportGarden();
                  }}
                  className="rounded-lg px-3 py-2 text-left text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
                >
                  ⬆ Export
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsHeaderMenuOpen(false);
                    restoreGardenFromMarkdown();
                  }}
                  className="rounded-lg px-3 py-2 text-left text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
                >
                  ↺ Restore
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsHeaderMenuOpen(false);
                    changeGardenFolder();
                  }}
                  className="rounded-lg px-3 py-2 text-left text-sm text-[var(--td-text-soft)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
                >
                  📁 Folder
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="grid gap-7 lg:grid-cols-[minmax(18rem,22rem)_1fr]">
          <section className="order-2 rounded-2xl border border-[var(--td-border)]/70 bg-[var(--td-panel)] p-5 lg:order-1">
            {!isNewNoteOpen ? (
              <button
                type="button"
                onClick={() => setIsNewNoteOpen(true)}
                className="w-full rounded-xl border border-[var(--td-accent-border)] px-4 py-3 text-sm text-[var(--td-accent)] transition hover:bg-[var(--td-hover)]"
              >
                ＋ New note
              </button>
            ) : (
              <form onSubmit={createSeed} className="grid gap-4">
                <label className="grid gap-2 text-sm text-[var(--td-text-soft)]">
                  Title
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] px-3 py-2 text-sm text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)]"
                  />
                </label>

                <label className="grid gap-2 text-sm text-[var(--td-text-soft)]">
                  <textarea
                    value={content}
                    onChange={(event) =>
                      setContent(event.target.value)
                    }
                    rows={6}
                    className="resize-y rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] px-3 py-2 text-sm leading-7 text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)]"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={!content.trim()}
                    className="rounded-lg border border-[var(--td-accent-border)] px-4 py-2 text-sm text-[var(--td-accent)] transition hover:bg-[var(--td-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsNewNoteOpen(false)}
                    className="rounded-lg border border-[var(--td-border)] px-4 py-2 text-sm text-[var(--td-muted)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>

          <div className="order-1 grid gap-7 lg:order-2 lg:gap-6">
            <section className="rounded-2xl border border-[var(--td-border)]/70 bg-[var(--td-panel)] p-5 sm:p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--td-muted)]">
                Recent Notes
              </p>

              <div className="mt-5 grid gap-4 md:mt-4 md:grid-cols-3 md:gap-3">
                {todaySeeds.map((seed) => renderSeedCard(seed))}

                {todaySeeds.length === 0 && (
                  <p className="text-sm text-[var(--td-muted)]">
                    New note to begin.
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
                  ? "Close notes"
                  : "All notes"}
              </button>
            </section>

            <section
              className={`overflow-hidden rounded-2xl border border-[var(--td-border)]/70 bg-[var(--td-panel)] ${
                isGardenBrowseOpen ? "block" : "hidden"
              } lg:block`}
            >
              <div className="border-b border-[var(--td-border)] px-5 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--td-muted)]">
                  Notes
                </p>
              </div>

              <div className="grid gap-5 p-4 sm:p-5">
                {sortedSeeds.map((seed) => renderSeedCard(seed))}

                {sortedSeeds.length === 0 && (
                  <p className="py-8 text-center text-sm text-[var(--td-muted)]">
                    No notes yet.
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
