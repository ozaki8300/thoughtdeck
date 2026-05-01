"use client";

import { useCallback, useEffect, useRef } from "react";
import { updateDeck } from "./deckService";

type CloudDeckSnapshot = {
  title: string;
  raw: string;
  memo: string;
  output: string;
};

type UseCloudSaveOptions = {
  deckId: string | null;
  getLatest: () => CloudDeckSnapshot;
};

export function useCloudSave({ deckId, getLatest }: UseCloudSaveOptions) {
  const cloudDirtyRef = useRef(false);
  const cloudSaveInFlightRef = useRef(false);
  const latestCloudDeckRef = useRef<CloudDeckSnapshot>({
    title: "",
    raw: "",
    memo: "",
    output: "",
  });

  const markDirty = useCallback(
    (nextDirty = true) => {
      cloudDirtyRef.current = nextDirty;
    },
    [],
  );

  useEffect(() => {
    latestCloudDeckRef.current = getLatest();
  }, [getLatest]);

  useEffect(() => {
    const sendCloudSave = (reason: "beforeunload" | "visibilitychange") => {
      if (!deckId || !cloudDirtyRef.current) return;
      if (reason === "visibilitychange" && cloudSaveInFlightRef.current) return;

      const payload = JSON.stringify({
        id: deckId,
        ...latestCloudDeckRef.current,
      });

      if (navigator.sendBeacon) {
        const queued = navigator.sendBeacon(
          "/api/deck/save",
          new Blob([payload], { type: "application/json" }),
        );
        if (queued) {
          cloudDirtyRef.current = false;
          return;
        }
      }

      if (reason === "beforeunload") return;

      cloudSaveInFlightRef.current = true;
      fetch("/api/deck/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      })
        .then(() => {
          cloudDirtyRef.current = false;
        })
        .catch((error) => {
          console.error(`${reason} save error:`, error);
        })
        .finally(() => {
          cloudSaveInFlightRef.current = false;
        });
    };

    const saveOnUnload = () => {
      sendCloudSave("beforeunload");
    };

    const saveOnHidden = () => {
      if (document.visibilityState === "hidden") {
        sendCloudSave("visibilitychange");
      }
    };

    window.addEventListener("beforeunload", saveOnUnload);
    document.addEventListener("visibilitychange", saveOnHidden);
    return () => {
      window.removeEventListener("beforeunload", saveOnUnload);
      document.removeEventListener("visibilitychange", saveOnHidden);
    };
  }, [deckId]);

  useEffect(() => {
    if (!deckId) return;

    const timer = window.setTimeout(async () => {
      if (!cloudDirtyRef.current) return;

      try {
        await updateDeck(deckId, latestCloudDeckRef.current);
        cloudDirtyRef.current = false;
      } catch (e) {
        console.error("idle save error:", e);
      }
    }, 60000);

    return () => window.clearTimeout(timer);
  }, [deckId]);

  return { markDirty };
}
