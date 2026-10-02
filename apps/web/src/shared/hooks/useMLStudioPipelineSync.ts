/**
 * useMLStudioPipelineSync — push/pull the ML Studio Workshop pipeline blob to
 * the server, so "where I left off" survives a different browser or machine.
 *
 * Today `MLStudioContext` persists the whole six-stage reducer state to
 * `localStorage` under `mlstudio:pipeline:v2:<symbol>:<timeframe>`. That copy
 * is per-device and dies with cleared site data. This hook talks to the
 * server-side twin of that key:
 *
 *   GET    /api/settings/ml-studio-pipeline/:symbol/:timeframe
 *   PUT    /api/settings/ml-studio-pipeline/:symbol/:timeframe
 *   DELETE /api/settings/ml-studio-pipeline/:symbol/:timeframe
 *   GET    /api/settings/ml-studio-pipeline            (resume list, no blobs)
 *
 * ── NOT WIRED IN YET — deliberate ──────────────────────────────────────────
 *
 * This hook is inert until an orchestrator calls it. It is intentionally NOT
 * imported by `MLStudioContext.tsx`; that file is owned elsewhere and the
 * merge policy (server wins / local wins / newest wins) is a product decision,
 * not a transport one. When the time comes, the two call sites are:
 *
 *   INTEGRATION POINT A — pull on mount
 *     apps/web/packages/ml-engine/src/MLStudioContext.tsx:897
 *     The `useEffect(() => { saveToStorage(state); }, [state])` inside
 *     `MLStudioProvider` (declared at :884). Add a sibling effect ABOVE it
 *     that calls `pull()` once per (symbol, timeframe) and dispatches the
 *     returned document — the local seed from `loadFromStorage` (:830) stays
 *     as the instant first paint, and the server copy replaces it when it
 *     arrives and its `updatedAt` is newer.
 *
 *   INTEGRATION POINT B — push on change
 *     apps/web/packages/ml-engine/src/MLStudioContext.tsx:899
 *     The body of that same save effect. Add `push(state)` next to
 *     `saveToStorage(state)`. `push` is already debounced and drops a write
 *     whose payload is byte-identical to the last one it sent, so the
 *     every-keystroke reducer churn does not become every-keystroke HTTP.
 *
 * Nothing here throws at the caller: every failure resolves to a status the
 * caller can ignore, because losing the server copy must never break a
 * pipeline that is working fine out of localStorage.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/infrastructure/api/query_client";

/** The client's pipeline document, kept opaque on purpose — see the note above
 *  about not importing `MLStudioPipeline` from the context this hook must not
 *  depend on. The keys named are the ones the server denormalises. */
export interface MLStudioPipelineDocument {
  symbol?: string;
  timeframe?: string;
  activeStage?: string;
  experiments?: unknown[];
  [key: string]: unknown;
}

/**
 * `updatedAt` is an RFC3339 UTC string, not a number. The column is
 * `timestamp_ms`, Drizzle reads it back as a `Date`, and `res.json()` runs it
 * through `JSON.stringify` — verified on the wire:
 * `"updatedAt":"2026-09-23T01:58:04.000Z"`.
 */
export interface MLStudioPipelineSnapshot {
  found: true;
  symbol: string;
  timeframe: string;
  schemaVersion: number;
  activeStage: string | null;
  experimentCount: number;
  stateByteCount: number;
  clientRevision: number;
  updatedByClientId: string | null;
  updatedAt: string;
  pipelineState: MLStudioPipelineDocument;
}

export interface MLStudioPipelinePairSummary {
  symbol: string;
  timeframe: string;
  schemaVersion: number;
  activeStage: string | null;
  experimentCount: number;
  stateByteCount: number;
  clientRevision: number;
  updatedByClientId: string | null;
  updatedAt: string;
}

export type MLStudioPipelineSyncStatus =
  | "idle"
  | "pulling"
  | "pushing"
  | "synced"
  | "absent"
  | "conflict"
  | "error";

export interface UseMLStudioPipelineSyncOptions {
  /** Milliseconds of quiet before a `push` actually goes out. Default 1500. */
  debounceMilliseconds?: number;
  /** Send `expectedRevision` so a stale device gets a 409 instead of winning.
   *  Default false: single-operator last-write-wins, same as localStorage. */
  guardRevision?: boolean;
}

export interface MLStudioPipelineSync {
  status: MLStudioPipelineSyncStatus;
  /** Last error message, or null. Never thrown — read it if you want to show it. */
  errorMessage: string | null;
  /** Server revision this tab last saw. 0 means "never saved on the server". */
  serverRevision: number;
  /** When the server copy was last written (RFC3339 UTC), or null if none. */
  serverUpdatedAt: string | null;
  /** Fetch the server copy. Resolves null when the pair was never saved. */
  pull: () => Promise<MLStudioPipelineSnapshot | null>;
  /** Queue a debounced write. Identical consecutive payloads are dropped. */
  push: (document: MLStudioPipelineDocument) => void;
  /** Write immediately, bypassing the debounce (use on unmount / explicit save). */
  pushNow: (document: MLStudioPipelineDocument) => Promise<boolean>;
  /** Drop the server copy for this pair. */
  forget: () => Promise<boolean>;
  /** Every pair the server holds, newest first — the resume picker's data. */
  listPairs: () => Promise<MLStudioPipelinePairSummary[]>;
}

/** Stable per-tab id, so a 409 can name the device that wrote last. Lives in
 *  sessionStorage; a fresh tab is a fresh device for conflict-reporting. */
function tabClientId(): string {
  const KEY = "mlstudio:sync:client-id";
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) return existing;
    const minted =
      typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(KEY, minted);
    return minted;
  } catch {
    return "unknown-tab";
  }
}

function pipelineUrl(symbol: string, timeframe: string): string {
  return `/api/settings/ml-studio-pipeline/${encodeURIComponent(symbol)}/${encodeURIComponent(timeframe)}`;
}

export function useMLStudioPipelineSync(
  symbol: string,
  timeframe: string,
  options: UseMLStudioPipelineSyncOptions = {},
): MLStudioPipelineSync {
  const { debounceMilliseconds = 1500, guardRevision = false } = options;

  const [status, setStatus] = useState<MLStudioPipelineSyncStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [serverRevision, setServerRevision] = useState(0);
  const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null);

  const clientId = useMemo(() => tabClientId(), []);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<string | null>(null);
  const revisionRef = useRef(0);

  // A pair swap invalidates everything this hook remembers about the server.
  useEffect(() => {
    lastSentRef.current = null;
    revisionRef.current = 0;
    setServerRevision(0);
    setServerUpdatedAt(null);
    setStatus("idle");
    setErrorMessage(null);
  }, [symbol, timeframe]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const pull = useCallback(async (): Promise<MLStudioPipelineSnapshot | null> => {
    setStatus("pulling");
    setErrorMessage(null);
    try {
      // Raw fetch, not `apiRequest`: a 404 here means "never saved", which is a
      // normal answer, and `apiRequest` turns every non-2xx into a throw.
      const response = await fetch(pipelineUrl(symbol, timeframe), {
        credentials: "include",
      });
      if (response.status === 404) {
        setStatus("absent");
        return null;
      }
      if (!response.ok) {
        setStatus("error");
        setErrorMessage(`${response.status}: ${response.statusText}`);
        return null;
      }
      const snapshot = (await response.json()) as MLStudioPipelineSnapshot;
      revisionRef.current = snapshot.clientRevision;
      setServerRevision(snapshot.clientRevision);
      setServerUpdatedAt(snapshot.updatedAt);
      setStatus("synced");
      return snapshot;
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [symbol, timeframe]);

  const pushNow = useCallback(
    async (document: MLStudioPipelineDocument): Promise<boolean> => {
      const serialized = JSON.stringify(document);
      setStatus("pushing");
      setErrorMessage(null);
      try {
        const response = await fetch(pipelineUrl(symbol, timeframe), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            pipelineState: document,
            schemaVersion: 2,
            clientId,
            ...(guardRevision ? { expectedRevision: revisionRef.current } : {}),
          }),
        });

        if (response.status === 409) {
          const conflict = (await response.json()) as {
            clientRevision?: number;
            updatedAt?: string;
          };
          revisionRef.current = conflict.clientRevision ?? revisionRef.current;
          setServerRevision(revisionRef.current);
          setServerUpdatedAt(conflict.updatedAt ?? null);
          setStatus("conflict");
          setErrorMessage("Another device saved this pipeline first");
          return false;
        }
        if (!response.ok) {
          setStatus("error");
          setErrorMessage(`${response.status}: ${response.statusText}`);
          return false;
        }

        const saved = (await response.json()) as { clientRevision: number };
        revisionRef.current = saved.clientRevision;
        lastSentRef.current = serialized;
        setServerRevision(saved.clientRevision);
        setServerUpdatedAt(new Date().toISOString());
        setStatus("synced");
        return true;
      } catch (error) {
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [symbol, timeframe, clientId, guardRevision],
  );

  const push = useCallback(
    (document: MLStudioPipelineDocument) => {
      // Byte-identical to what we last sent: the reducer fired, the document
      // did not change. Dropping it is what keeps a per-keystroke effect from
      // becoming a per-keystroke PUT.
      if (JSON.stringify(document) === lastSentRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void pushNow(document);
      }, debounceMilliseconds);
    },
    [pushNow, debounceMilliseconds],
  );

  const forget = useCallback(async (): Promise<boolean> => {
    try {
      await apiRequest("DELETE", pipelineUrl(symbol, timeframe));
      lastSentRef.current = null;
      revisionRef.current = 0;
      setServerRevision(0);
      setServerUpdatedAt(null);
      setStatus("absent");
      return true;
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [symbol, timeframe]);

  const listPairs = useCallback(async (): Promise<MLStudioPipelinePairSummary[]> => {
    try {
      const response = await apiRequest("GET", "/api/settings/ml-studio-pipeline");
      const body = (await response.json()) as {
        pairs?: MLStudioPipelinePairSummary[];
      };
      return Array.isArray(body.pairs) ? body.pairs : [];
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return [];
    }
  }, []);

  return {
    status,
    errorMessage,
    serverRevision,
    serverUpdatedAt,
    pull,
    push,
    pushNow,
    forget,
    listPairs,
  };
}
