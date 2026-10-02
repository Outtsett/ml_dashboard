/**
 * Data hooks for the live hub. Snapshots come through TanStack Query; updates
 * through the tab's single shared hub stream (stream.ts), filtered here. (No
 * manual memoisation: the React Compiler does it.)
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHubEvents } from "./stream";
import type { LiveArticle, LiveBar, LiveQuote, LiveStatus, SentimentGrid } from "./types";

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string; detail?: string });
    throw new Error(body.detail ?? body.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function useLiveStatus() {
  return useQuery({
    queryKey: ["/api/live/status"],
    queryFn: ({ signal }) => getJson<LiveStatus>("/api/live/status", signal),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
}

export function useLiveQuotes() {
  const snapshot = useQuery({
    queryKey: ["/api/live/quotes"],
    queryFn: ({ signal }) => getJson<{ quotes: LiveQuote[] }>("/api/live/quotes", signal),
    staleTime: 30_000,
  });
  const [latest, setLatest] = useState<Record<string, LiveQuote>>({});
  const connected = useHubEvents((kind, raw) => {
    if (kind !== "quote") return;
    const quote = raw as LiveQuote;
    if (quote?.symbol) setLatest((prev) => ({ ...prev, [quote.symbol]: quote }));
  });
  const merged: Record<string, LiveQuote> = {};
  for (const quote of snapshot.data?.quotes ?? []) merged[quote.symbol] = quote;
  Object.assign(merged, latest);
  return { quotes: Object.values(merged), connected, isLoading: snapshot.isLoading, error: snapshot.error as Error | null };
}

export function useLiveNews(root: string | null, limit = 200) {
  const url = `/api/live/news?limit=${limit}${root ? `&root=${encodeURIComponent(root)}` : ""}`;
  const snapshot = useQuery({
    queryKey: ["/api/live/news", root, limit],
    queryFn: ({ signal }) => getJson<{ news: LiveArticle[] }>(url, signal),
    staleTime: 60_000,
  });
  const [fresh, setFresh] = useState<LiveArticle[]>([]);
  const connected = useHubEvents((kind, raw) => {
    if (kind !== "news") return;
    const article = raw as LiveArticle;
    if (!article?.articleId) return;
    if (root && !article.routes.some((r) => r.root === root)) return;
    setFresh((prev) => [article, ...prev.filter((a) => a.articleId !== article.articleId)].slice(0, limit));
  });
  const seen = new Set<string>();
  const news: LiveArticle[] = [];
  for (const article of [...fresh, ...(snapshot.data?.news ?? [])]) {
    if (seen.has(article.articleId) || (root && !article.routes.some((r) => r.root === root))) continue;
    seen.add(article.articleId);
    news.push(article);
  }
  return { news: news.slice(0, limit), connected, isLoading: snapshot.isLoading, error: snapshot.error as Error | null };
}

export function useLiveSentiment(root: string | null, hours = 24, step = 5) {
  return useQuery({
    queryKey: ["/api/live/sentiment", root, hours, step],
    enabled: Boolean(root),
    queryFn: ({ signal }) =>
      getJson<SentimentGrid>(`/api/live/sentiment?roots=${encodeURIComponent(root ?? "")}&hours=${hours}&step=${step}`, signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useLiveBarsSnapshot(symbol: string | null, sinceMs: number) {
  return useQuery({
    queryKey: ["/api/live/bars", symbol, sinceMs],
    enabled: Boolean(symbol),
    queryFn: ({ signal }) =>
      getJson<{ symbol: string; bars: LiveBar[] }>(
        `/api/live/bars?symbol=${encodeURIComponent(symbol ?? "")}&since=${Math.max(0, Math.floor(sinceMs))}`,
        signal,
      ),
    staleTime: 60_000,
  });
}

/** Every bar event for one symbol, as it arrives. */
export function useLiveBarStream(symbol: string | null, onBar: (bar: LiveBar) => void) {
  const connected = useHubEvents((kind, raw) => {
    if (kind === "bar" && (raw as LiveBar)?.symbol === symbol) onBar(raw as LiveBar);
  }, Boolean(symbol));
  return { connected };
}
