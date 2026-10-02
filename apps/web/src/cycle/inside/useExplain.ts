/**
 * "Inside the model" data — TanStack Query hooks over the explain routes
 * (`apps/api/training/cycleExplain.router.ts`), every reply parsed with the
 * `@shared/cycle/explain` schemas, every fetch carrying the query's
 * AbortSignal.
 *
 *   GET /api/training/cycle/:modelId/explain                               manifest
 *   GET /api/training/cycle/:modelId/explain/structure?fold&role           one fold's fitted model
 *   GET /api/training/cycle/:modelId/explain/tree?fold&role&tree           one whole tree
 *   GET /api/training/cycle/:modelId/explain/bar?timestamp&role&fold       one bar, input to output
 *
 * Structure, tree and bar replies describe a saved model, which never
 * changes, so they are cached for the session. Bar requests are debounced
 * (80 ms) so a crosshair sweeping the chart asks only for where it stops, and
 * the neighbouring test bars are prefetched so ← / → answer from the cache.
 * The manifest re-polls while a fold is still training.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import {
  cycleExplainBarSchema,
  cycleExplainManifestSchema,
  cycleExplainStructureSchema,
  cycleExplainTreeSchema,
  type CycleExplainBar,
  type CycleExplainManifest,
  type CycleExplainRole,
  type CycleExplainStructure,
  type CycleExplainTree,
} from "@shared/cycle/explain";

/** Debounce for bar requests while the crosshair moves. */
export const BAR_REQUEST_DEBOUNCE_MILLISECONDS = 80;
/** Manifest re-poll while a fold's model is still being fitted. */
export const MANIFEST_TRAINING_POLL_MILLISECONDS = 3_000;

export function explainPath(modelId: string): string {
  return `/api/training/cycle/${encodeURIComponent(modelId)}/explain`;
}

/** A non-2xx reply, carrying the route's own sentence (`body.error`) and status (409 = still training). */
export class ExplainRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExplainRequestError";
  }
}

async function getJson<T>(url: string, schema: z.ZodType<T>, signal: AbortSignal | undefined): Promise<T> {
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) {
    let message = `${url} answered ${response.status}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error) message = body.error;
    } catch {
      // No JSON body: keep the status sentence.
    }
    throw new ExplainRequestError(message, response.status);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ExplainRequestError(`The explainer's reply is not in the shape this view reads: ${parsed.error.issues[0]?.message ?? "invalid"}`, 502);
  }
  return parsed.data;
}

export const explainKeys = {
  all: (modelId: string) => ["cycle-explain", modelId] as const,
  manifest: (modelId: string) => ["cycle-explain", modelId, "manifest"] as const,
  structure: (modelId: string, fold: number, role: CycleExplainRole) => ["cycle-explain", modelId, "structure", fold, role] as const,
  tree: (modelId: string, fold: number, role: CycleExplainRole, tree: number) => ["cycle-explain", modelId, "tree", fold, role, tree] as const,
  bar: (modelId: string, fold: number, role: CycleExplainRole, timestamp: number) => ["cycle-explain", modelId, "bar", fold, role, timestamp] as const,
};

function retryUnlessAnswered(failureCount: number, error: unknown): boolean {
  // A route's own answer (404 no fold, 409 training, 422 declined) will not change on retry.
  if (error instanceof ExplainRequestError && error.status > 0 && error.status < 500) return false;
  return failureCount < 1;
}

// ─── fetchers ────────────────────────────────────────────────────────────────

export function fetchExplainManifest(modelId: string, signal?: AbortSignal): Promise<CycleExplainManifest> {
  return getJson(explainPath(modelId), cycleExplainManifestSchema, signal);
}

export function fetchExplainStructure(modelId: string, fold: number, role: CycleExplainRole, signal?: AbortSignal): Promise<CycleExplainStructure> {
  const query = new URLSearchParams({ fold: String(fold), role });
  return getJson(`${explainPath(modelId)}/structure?${query}`, cycleExplainStructureSchema, signal);
}

export function fetchExplainTree(modelId: string, fold: number, role: CycleExplainRole, tree: number, signal?: AbortSignal): Promise<CycleExplainTree> {
  const query = new URLSearchParams({ fold: String(fold), role, tree: String(tree) });
  return getJson(`${explainPath(modelId)}/tree?${query}`, cycleExplainTreeSchema, signal);
}

export function fetchExplainBar(modelId: string, fold: number, role: CycleExplainRole, timestamp: number, signal?: AbortSignal): Promise<CycleExplainBar> {
  const query = new URLSearchParams({ timestamp: String(timestamp), role, fold: String(fold) });
  return getJson(`${explainPath(modelId)}/bar?${query}`, cycleExplainBarSchema, signal);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

export type CycleExplainManifestFold = CycleExplainManifest["folds"][number];

/** The manifest fold whose test span holds the bar (what the route would pick); null when no fold tested it. */
export function foldForTimestamp(manifest: CycleExplainManifest | undefined, timestamp: number | null): CycleExplainManifestFold | null {
  if (!manifest || timestamp === null) return null;
  return manifest.folds.find((fold) => timestamp >= fold.testStart && timestamp <= fold.testEnd) ?? null;
}

/** The value, held back until it has stopped changing for `delay` milliseconds. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, settled, delay]);
  return settled;
}

// ─── hooks ───────────────────────────────────────────────────────────────────

export function useExplainManifest(modelId: string | null, runIsLive: boolean) {
  return useQuery<CycleExplainManifest>({
    queryKey: explainKeys.manifest(modelId ?? ""),
    queryFn: ({ signal }) => fetchExplainManifest(modelId!, signal),
    enabled: modelId !== null,
    staleTime: runIsLive ? 0 : 30_000,
    retry: retryUnlessAnswered,
    refetchInterval: (query) => {
      const manifest = query.state.data;
      const training = manifest?.folds.some((fold) => fold.direction === "training" || fold.price === "training") ?? false;
      return training || (runIsLive && manifest !== undefined && manifest.available) ? MANIFEST_TRAINING_POLL_MILLISECONDS : false;
    },
  });
}

export function useExplainStructure(modelId: string | null, fold: number | null, role: CycleExplainRole, enabled: boolean) {
  return useQuery<CycleExplainStructure>({
    queryKey: explainKeys.structure(modelId ?? "", fold ?? -1, role),
    queryFn: ({ signal }) => fetchExplainStructure(modelId!, fold!, role, signal),
    enabled: enabled && modelId !== null && fold !== null,
    staleTime: Infinity,
    retry: retryUnlessAnswered,
  });
}

/**
 * One bar, debounced. While the next bar loads, the previous bar of the same
 * fold and role stays on screen (never a bar of the other role, whose numbers
 * mean something else).
 */
export function useExplainBar(modelId: string | null, fold: number | null, role: CycleExplainRole, timestamp: number | null, enabled: boolean) {
  const settled = useDebouncedValue(timestamp, BAR_REQUEST_DEBOUNCE_MILLISECONDS);
  const query = useQuery<CycleExplainBar>({
    queryKey: explainKeys.bar(modelId ?? "", fold ?? -1, role, settled ?? -1),
    queryFn: ({ signal }) => fetchExplainBar(modelId!, fold!, role, settled!, signal),
    enabled: enabled && modelId !== null && fold !== null && settled !== null,
    staleTime: Infinity,
    retry: retryUnlessAnswered,
    placeholderData: (previous) => (previous && previous.role === role && previous.foldIndex === fold ? previous : undefined),
  });
  return { ...query, settledTimestamp: settled, settling: settled !== timestamp };
}

/** Warm the cache for the bars ← / → would step to. */
export function usePrefetchBars(modelId: string | null, fold: number | null, role: CycleExplainRole, timestamps: readonly (number | null)[], enabled: boolean) {
  const queryClient = useQueryClient();
  const key = timestamps.join(",");
  useEffect(() => {
    if (!enabled || modelId === null || fold === null) return;
    for (const timestamp of timestamps) {
      if (timestamp === null) continue;
      void queryClient.prefetchQuery({
        queryKey: explainKeys.bar(modelId, fold, role, timestamp),
        queryFn: ({ signal }) => fetchExplainBar(modelId, fold, role, timestamp, signal),
        staleTime: Infinity,
      });
    }
    // `key` stands for `timestamps` (a fresh array each render).
     
  }, [enabled, modelId, fold, role, key, queryClient]);
}

export function loadExplainTree(queryClient: QueryClient, modelId: string, fold: number, role: CycleExplainRole, tree: number): Promise<CycleExplainTree> {
  return queryClient.fetchQuery({
    queryKey: explainKeys.tree(modelId, fold, role, tree),
    queryFn: ({ signal }) => fetchExplainTree(modelId, fold, role, tree, signal),
    staleTime: Infinity,
  });
}

/** `loadTree` for the kind views: one whole tree of this fold and role, cached. */
export function useTreeLoader(modelId: string | null, fold: number | null, role: CycleExplainRole): ((tree: number) => Promise<CycleExplainTree>) | undefined {
  const queryClient = useQueryClient();
  if (modelId === null || fold === null) return undefined;
  return (tree: number) => loadExplainTree(queryClient, modelId, fold, role, tree);
}

/**
 * The value, passed through at most once per `interval` milliseconds, the
 * latest one always arriving (trailing edge). For following the model's
 * cursor, which moves up to 20 times a second.
 */
export function useThrottledValue<T>(value: T, interval: number): T {
  const [shown, setShown] = useState(value);
  const lastRef = useRef(0);
  const latestRef = useRef(value);
  const timerRef = useRef<number | null>(null);
  latestRef.current = value;
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const wait = interval - (Date.now() - lastRef.current);
    const publish = () => {
      timerRef.current = null;
      lastRef.current = Date.now();
      setShown(latestRef.current);
    };
    if (wait <= 0) publish();
    else if (timerRef.current === null) timerRef.current = window.setTimeout(publish, wait);
  }, [value, shown, interval]);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );
  return shown;
}
