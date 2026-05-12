"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
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
  loadGardenSeeds,
  parseGardenMarkdown,
  recordGardenSeedDwell,
  saveGardenSeeds,
  updateActiveGardenLayer,
  updateGardenSeedRating,
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

function activeLayerContent(seed: GardenSeed) {
  return (
    seed.layers[seed.activeLayerIndex]?.content.trim() ||
    seed.layers[0]?.content.trim() ||
    "No note yet."
  );
}

function ratingLabel(rating: number) {
  return `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`;
}

function formatDwellTime(totalDwellMs: number) {
  const totalMinutes = Math.floor(totalDwellMs / 60000);

  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (totalMinutes >= 1) {
    return `${totalMinutes}m`;
  }

  const seconds = Math.floor(totalDwellMs / 1000);

  return `${seconds}s`;
}

export default function ThoughtGardenPage() {
  const router = useRouter();
  const [seeds, setSeeds] = useState<GardenSeed[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isNewNoteOpen, setIsNewNoteOpen] = useState(false);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [editingSeedId, setEditingSeedId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [editingLayerContent, setEditingLayerContent] = useState("");
  const [noteTextBySeed, setNoteTextBySeed] = useState<
    Record<string, string>
  >({});
  const [expandedSeedIds, setExpandedSeedIds] = useState<
    Record<string, boolean>
  >({});
  const [transitioningSeedIds, setTransitioningSeedIds] = useState<
    Record<string, boolean>
  >({});
  const [transitionDirectionBySeed, setTransitionDirectionBySeed] =
    useState<Record<string, -1 | 1>>({});
  const swipeStartBySeedRef = useRef<
    Record<string, { x: number; y: number; pointerId: number }>
  >({});
  const suppressCardClickUntilBySeedRef = useRef<Record<string, number>>(
    {},
  );
  const dwellStartAtBySeedRef = useRef<Record<string, number>>({});

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
      [...seeds].sort((a, b) => {
        if (b.rating !== a.rating) {
          return b.rating - a.rating;
        }

        if (b.viewCount !== a.viewCount) {
          return b.viewCount - a.viewCount;
        }

        if (b.totalDwellMs !== a.totalDwellMs) {
          return b.totalDwellMs - a.totalDwellMs;
        }

        return b.lastSeenAt.localeCompare(a.lastSeenAt);
      }),
    [seeds],
  );

  const createSeed = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!content.trim()) {
      return;
    }

    const seed = createGardenSeed(title, content);

    setSeeds((current) => [seed, ...current]);
    setEditingSeedId("");
    setTitle("");
    setContent("");
    setIsNewNoteOpen(false);
  };

  const beginSeedDwell = (seedId: string) => {
    if (!dwellStartAtBySeedRef.current[seedId]) {
      dwellStartAtBySeedRef.current[seedId] = Date.now();
    }
  };

  const settleSeedDwell = (seedId: string) => {
    const dwellStartedAt = dwellStartAtBySeedRef.current[seedId];

    delete dwellStartAtBySeedRef.current[seedId];

    if (!dwellStartedAt) {
      return;
    }

    const dwellMs = Date.now() - dwellStartedAt;

    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seedId
          ? recordGardenSeedDwell(currentSeed, dwellMs)
          : currentSeed,
      ),
    );
  };

  const toggleSeedExpanded = (seed: GardenSeed) => {
    const willExpand = !(expandedSeedIds[seed.id] ?? false);

    setExpandedSeedIds((current) => ({
      ...current,
      [seed.id]: !current[seed.id],
    }));

    if (willExpand) {
      beginSeedDwell(seed.id);
    } else {
      settleSeedDwell(seed.id);
    }
  };

  const cycleVisibleNote = (seed: GardenSeed, direction: -1 | 1) => {
    if (seed.layers.length <= 1) {
      return;
    }

    setTransitioningSeedIds((current) => ({
      ...current,
      [seed.id]: true,
    }));
    setTransitionDirectionBySeed((current) => ({
      ...current,
      [seed.id]: direction,
    }));
    settleSeedDwell(seed.id);

    window.setTimeout(() => {
      setSeeds((current) =>
        current.map((currentSeed) =>
          currentSeed.id === seed.id
            ? currentSeed.layers.length <= 1
              ? currentSeed
              : direction === 1
                ? advanceGardenLayer(currentSeed)
                : {
                    ...currentSeed,
                    activeLayerIndex:
                      (currentSeed.activeLayerIndex -
                        1 +
                        currentSeed.layers.length) %
                      currentSeed.layers.length,
                  }
            : currentSeed,
        ),
      );
      beginSeedDwell(seed.id);

      window.setTimeout(() => {
        setTransitioningSeedIds((current) => ({
          ...current,
          [seed.id]: false,
        }));
      }, 120);
    }, 90);
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
    setEditingSeedId("");
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
    setEditingSeedId("");
    cancelLatestLayerEdit();
  };

  const deleteSeed = (seed: GardenSeed) => {
    const confirmed = window.confirm(
      "Delete this note?",
    );

    if (!confirmed) {
      return;
    }

    setSeeds((current) =>
      current.filter((currentSeed) => currentSeed.id !== seed.id),
    );
    setEditingSeedId((current) => (current === seed.id ? "" : current));
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

  const cycleSeedRating = (seed: GardenSeed) => {
    const nextRating = seed.rating >= 5 ? 0 : seed.rating + 1;

    setSeeds((current) =>
      current.map((currentSeed) =>
        currentSeed.id === seed.id
          ? updateGardenSeedRating(currentSeed, nextRating)
          : currentSeed,
      ),
    );
  };

  const toggleEditor = (seed: GardenSeed) => {
    setEditingSeedId((current) => {
      if (current === seed.id) {
        cancelLatestLayerEdit();
        return "";
      }

      startLatestLayerEdit(seed);
      return seed.id;
    });
  };

  const captureSwipeStart = (
    seed: GardenSeed,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    swipeStartBySeedRef.current[seed.id] = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  };

  const finishSwipe = (
    seed: GardenSeed,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const start = swipeStartBySeedRef.current[seed.id];

    delete swipeStartBySeedRef.current[seed.id];

    if (!start || start.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const isIntentionalHorizontalSwipe =
      Math.abs(deltaX) >= 64 &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.35;

    if (!isIntentionalHorizontalSwipe) {
      return;
    }

    suppressCardClickUntilBySeedRef.current[seed.id] =
      Date.now() + 500;
    cycleVisibleNote(seed, deltaX < 0 ? 1 : -1);
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
      setEditingSeedId("");
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

  const renderEditorPanel = (seed: GardenSeed) => {
    return (
      <div
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        className="mt-5 grid gap-5 rounded-xl border border-[var(--td-border)]/70 bg-[var(--td-panel)]/55 p-4"
      >
        <div className="grid gap-4">
          <p className="text-xs text-[var(--td-muted)] opacity-80">
            Viewed {seed.viewCount} times
          </p>
          <p className="text-xs text-[var(--td-muted)] opacity-80">
            Stayed {formatDwellTime(seed.totalDwellMs)}
          </p>
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
          <label className="grid gap-2 text-sm text-[var(--td-text-soft)]">
            Current note
            <textarea
              value={editingLayerContent}
              onChange={(event) =>
                setEditingLayerContent(event.target.value)
              }
              rows={6}
              className="resize-y rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] px-3 py-2 text-sm leading-7 text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)] sm:leading-6"
            />
          </label>
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
                setEditingSeedId("");
              }}
              className="rounded-lg border border-[var(--td-border)] px-4 py-2 text-sm text-[var(--td-muted)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
            >
              Cancel
            </button>
          </div>
        </div>

        <div className="grid gap-3 border-t border-[var(--td-border)]/60 pt-4">
          <label className="grid gap-2 text-sm text-[var(--td-text-soft)]">
            Add Note
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
          </label>
          <button
            type="button"
            onClick={() => appendLayer(seed)}
            disabled={!noteTextBySeed[seed.id]?.trim()}
            className="justify-self-start rounded-lg border border-[var(--td-accent-border)] px-4 py-2 text-sm text-[var(--td-accent)] transition hover:bg-[var(--td-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add Note
          </button>
        </div>
      </div>
    );
  };

  const renderSeedCard = (seed: GardenSeed) => {
    const isEditing = editingSeedId === seed.id;
    const isExpanded = expandedSeedIds[seed.id] ?? false;
    const isTransitioning =
      transitioningSeedIds[seed.id] ?? false;
    const lastSeenAt = new Date(seed.lastSeenAt).getTime();
    const daysSinceSeen = Number.isNaN(lastSeenAt)
      ? 30
      : Math.max(0, (Date.now() - lastSeenAt) / 86400000);
    const recencyWeight = Math.max(0.35, 1 / (1 + daysSinceSeen / 14));
    const dwellWeight = Math.log1p(seed.totalDwellMs / 10000);
    const revisitWeight = Math.log1p(seed.viewCount) * 0.8;
    const heatScore = (dwellWeight + revisitWeight) * recencyWeight;
    const viewHeatClass =
      heatScore >= 4
        ? "-translate-y-px ring-1 ring-[var(--td-border)]/25 shadow-[0_18px_44px_rgba(0,0,0,0.14)]"
        : heatScore >= 1.8
          ? "ring-1 ring-[var(--td-border)]/15 shadow-[0_14px_34px_rgba(0,0,0,0.1)]"
          : "shadow-none";
    const titleHeatClass =
      heatScore >= 4
        ? "brightness-[1.06]"
        : heatScore >= 1.8
          ? "brightness-[1.03]"
          : "brightness-100";
    const recencyClass =
      recencyWeight <= 0.45
        ? "brightness-[0.985]"
        : "brightness-100";
    const cardWeightClass =
      seed.rating >= 5
        ? "border-[var(--td-border-strong)]/80 bg-[var(--td-card-bg)]/100 opacity-100"
        : seed.rating >= 3
          ? "border-[var(--td-card-border)]/95 bg-[var(--td-card-bg)]/98 opacity-[0.99]"
          : seed.rating === 0
            ? "border-[var(--td-card-border)]/70 bg-[var(--td-card-bg)]/94 opacity-[0.965]"
            : "border-[var(--td-card-border)]/85 bg-[var(--td-card-bg)]/96 opacity-[0.98]";
    const titleWeightClass =
      seed.rating >= 5
        ? "text-sky-200"
        : seed.rating === 0
          ? "text-sky-300/90"
          : "text-sky-300";
    const activeLayerIndex = Math.min(
      seed.activeLayerIndex,
      Math.max(seed.layers.length - 1, 0),
    );

    return (
      <article
        key={seed.id}
        onClick={(event) => {
          if (
            Date.now() <
            (suppressCardClickUntilBySeedRef.current[seed.id] ?? 0)
          ) {
            return;
          }

          toggleSeedExpanded(seed);
        }}
        onPointerDown={(event) => captureSwipeStart(seed, event)}
        onPointerUp={(event) => {
          finishSwipe(seed, event);
        }}
        onPointerCancel={() => {
          delete swipeStartBySeedRef.current[seed.id];
        }}
        onPointerLeave={() => settleSeedDwell(seed.id)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            cycleVisibleNote(seed, -1);
          }

          if (event.key === "ArrowRight") {
            cycleVisibleNote(seed, 1);
          }

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleSeedExpanded(seed);
          }
        }}
        tabIndex={0}
        className={[
          "group relative touch-pan-y rounded-2xl border p-6 outline-none transition-[border-color,background-color,opacity,box-shadow,transform] duration-300 ease-out hover:border-[var(--td-border-strong)] focus:border-[var(--td-accent-border)] sm:p-7",
          cardWeightClass,
          viewHeatClass,
          recencyClass,
        ].join(" ")}
      >
        {seed.layers.length > 1 && (
          <div
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            className="pointer-events-none absolute inset-y-0 left-3 right-3 hidden items-center justify-between lg:flex"
          >
            <button
              type="button"
              aria-label="Previous note"
              title="Previous note"
              onClick={(event) => {
                event.stopPropagation();
                cycleVisibleNote(seed, -1);
              }}
              className="pointer-events-auto grid h-10 w-10 -translate-x-1 place-items-center rounded-full bg-[var(--td-bg)]/35 text-2xl leading-none text-[var(--td-text-soft)] opacity-0 backdrop-blur transition duration-300 ease-out hover:bg-[var(--td-bg)]/55 hover:text-[var(--td-text)] group-hover:translate-x-0 group-hover:opacity-35 group-focus:translate-x-0 group-focus:opacity-35 group-focus-within:translate-x-0 group-focus-within:opacity-35 focus-visible:translate-x-0 focus-visible:opacity-70"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next note"
              title="Next note"
              onClick={(event) => {
                event.stopPropagation();
                cycleVisibleNote(seed, 1);
              }}
              className="pointer-events-auto grid h-10 w-10 translate-x-1 place-items-center rounded-full bg-[var(--td-bg)]/35 text-2xl leading-none text-[var(--td-text-soft)] opacity-0 backdrop-blur transition duration-300 ease-out hover:bg-[var(--td-bg)]/55 hover:text-[var(--td-text)] group-hover:translate-x-0 group-hover:opacity-35 group-focus:translate-x-0 group-focus:opacity-35 group-focus-within:translate-x-0 group-focus-within:opacity-35 focus-visible:translate-x-0 focus-visible:opacity-70"
            >
              ›
            </button>
          </div>
        )}

        <h2
          className={[
            "min-w-0 text-xl font-semibold leading-8 transition-colors duration-300",
            titleWeightClass,
            titleHeatClass,
          ].join(" ")}
        >
          {seed.title}
        </h2>

        <div
          className={[
            "relative mt-6 overflow-hidden transition-[max-height] duration-350 ease-[cubic-bezier(0.22,1,0.36,1)]",
            isExpanded ? "max-h-[42rem]" : "max-h-40 sm:max-h-44",
          ].join(" ")}
        >
          <p
            className={[
              "whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-8 text-[var(--td-text)] transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:text-base sm:leading-8",
              isTransitioning
                ? transitionDirectionBySeed[seed.id] === 1
                  ? "-translate-x-3 opacity-30"
                  : "translate-x-3 opacity-30"
                : "translate-x-0 opacity-100",
            ].join(" ")}
          >
            {activeLayerContent(seed)}
          </p>
          {!isExpanded && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--td-card-bg)] via-[var(--td-card-bg)]/95 to-transparent" />
          )}
        </div>

        <div
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          className="mt-6 flex flex-wrap items-center justify-end gap-3 opacity-55 transition hover:opacity-90"
        >
          <button
            type="button"
            aria-label="Edit note"
            title="Edit note"
            onClick={(event) => {
              event.stopPropagation();
              toggleEditor(seed);
            }}
            className="grid h-11 w-11 place-items-center rounded-lg bg-transparent text-sm text-[var(--td-text-soft)] transition hover:text-[var(--td-text)]"
          >
            ✎
          </button>
          <button
            type="button"
            aria-label={`Rating ${seed.rating} of 5`}
            title="Click to cycle rating"
            onClick={(event) => {
              event.stopPropagation();
              cycleSeedRating(seed);
            }}
            className="grid h-11 place-items-center rounded-lg bg-transparent px-2 text-sm text-[var(--td-text-soft)] transition hover:text-[var(--td-text)]"
          >
            {ratingLabel(seed.rating)}
          </button>
          <button
            type="button"
            aria-label="Delete note"
            title="Delete note"
            onClick={(event) => {
              event.stopPropagation();
              deleteSeed(seed);
            }}
            className="grid h-11 w-11 place-items-center rounded-lg bg-transparent text-sm text-[var(--td-text-soft)] transition hover:text-[var(--td-text)]"
          >
            🗑
          </button>
        </div>

        {seed.layers.length > 1 && (
          <div
            aria-label={`Viewing note ${activeLayerIndex + 1} of ${seed.layers.length}`}
            className="mt-2 flex justify-end"
          >
            <div className="flex items-center gap-1.5 pr-1 text-[9px] leading-none text-[var(--td-muted)] opacity-55">
              {seed.layers.map((layer, index) => (
                <span
                  key={layer.id}
                  aria-hidden="true"
                  className={[
                    "inline-block h-1.5 w-1.5 rounded-full transition duration-200",
                    index === activeLayerIndex
                      ? "bg-current opacity-100"
                      : "border border-current opacity-55",
                  ].join(" ")}
                />
              ))}
            </div>
          </div>
        )}

        {isEditing && renderEditorPanel(seed)}
      </article>
    );
  };

  return (
    <main
      data-theme="auto"
      className="min-h-screen bg-[var(--td-bg)] px-3 pb-28 pt-4 text-[var(--td-text)] sm:px-4 sm:pb-32 sm:pt-5"
    >
      <div className="mx-auto max-w-5xl">
        <header className="sticky top-3 z-30 mb-7 flex items-center justify-between gap-4 rounded-2xl bg-[var(--td-bg)]/78 px-4 py-3 backdrop-blur-md sm:top-4 sm:mb-8">
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

        <div>
          <div className="grid gap-7 sm:gap-8">
            {sortedSeeds.map((seed) => renderSeedCard(seed))}

            {sortedSeeds.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--td-muted)]">
                No notes yet.
              </p>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-label="New note"
        title="New note"
        onClick={() => setIsNewNoteOpen(true)}
        className="fixed bottom-5 right-4 z-30 grid h-12 w-12 place-items-center rounded-full border border-[var(--td-accent-border)] bg-[var(--td-panel)]/88 text-2xl font-light leading-none text-[var(--td-accent)] opacity-90 shadow-md shadow-black/20 backdrop-blur transition hover:bg-[var(--td-hover)] hover:opacity-100 sm:bottom-7 sm:right-7"
      >
        +
      </button>

      {isNewNoteOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 px-3 pb-3 pt-16 backdrop-blur-[2px] sm:items-center sm:px-4 sm:pb-4"
          onClick={() => setIsNewNoteOpen(false)}
        >
          <section
            aria-label="New note"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-xl rounded-2xl border border-[var(--td-border)] bg-[var(--td-panel)] p-5 shadow-2xl sm:p-6"
          >
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
                  onChange={(event) => setContent(event.target.value)}
                  rows={7}
                  className="resize-y rounded-lg border border-[var(--td-border)] bg-[var(--td-bg)] px-3 py-3 text-sm leading-7 text-[var(--td-text)] outline-none transition focus:border-[var(--td-accent-border)]"
                />
              </label>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewNoteOpen(false)}
                  className="rounded-lg border border-[var(--td-border)] px-4 py-2 text-sm text-[var(--td-muted)] transition hover:bg-[var(--td-hover)] hover:text-[var(--td-text)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!content.trim()}
                  className="rounded-lg border border-[var(--td-accent-border)] px-4 py-2 text-sm text-[var(--td-accent)] transition hover:bg-[var(--td-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
