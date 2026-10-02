/**
 * What the live data hub (live/ — a sidecar proxied at /api/live) serves.
 * Mirrors live/hub.py and live/app.py.
 */

export type LiveSourceName = "oanda" | "yahoo" | string;

export interface LiveQuote {
  symbol: string;
  assetClass: "forex" | "futures" | "index";
  bid: number | null;
  ask: number | null;
  last: number | null;
  mid: number | null;
  spread: number | null;
  /** True-UTC epoch ms of the quote (for Yahoo: the newest bar's open). */
  time: number;
  source: LiveSourceName;
  /** Measured delay behind the exchange; 0 for a real-time source. */
  delaySeconds: number;
}

export interface LiveBar {
  symbol: string;
  assetClass: "forex" | "futures" | "index";
  timeframe: "1m";
  /** Bar OPEN, true-UTC epoch ms. */
  t: number;
  /** The same open in the chart's stamping (futures: Pacific wall clock as UTC). */
  tChart: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
  source: LiveSourceName;
  delaySeconds: number;
  backfill?: boolean;
}

export interface LiveRoute {
  root: string;
  direction: 1 | -1;
  relevance: number;
  tier: string;
}

export interface LiveArticle {
  articleId: string;
  title: string;
  url: string;
  domain: string;
  vendor: string;
  source: string;
  /** First sight, epoch ms. */
  seenTs: number;
  /** When a model may use it (GDELT: the end of its 15-minute crawl bucket). */
  knownTs: number;
  publishedTs: number | null;
  routes: LiveRoute[];
  tags: string[];
  /** FinBERT p(positive) - p(negative), in [-1, 1]. */
  score: number;
  label: "positive" | "negative" | "neutral";
  pPositive: number;
  pNegative: number;
  pNeutral: number;
  confidence: number;
}

export interface LiveSourceHealth {
  name: string;
  kind: "prices" | "news";
  label: string;
  realtime: boolean;
  delaySeconds: number | null;
  connected: boolean;
  lastMessageAgeSeconds: number | null;
  messages: number;
  errors: number;
  lastError: string | null;
  note: string | null;
  [extra: string]: unknown;
}

export interface LiveStatus {
  status: "ok";
  pid: number;
  startedAt: string;
  sources: LiveSourceHealth[];
  quotes: number;
  barSymbols: number;
  news: number;
  subscribers: number;
  landing: {
    rawLanded: number;
    rawBytes: number;
    daysLanded: number;
    lastRawLand: number | null;
    lastSpoolFlush: number | null;
    lastError: string | null;
    day: string;
    openRawFiles: number;
    todayRows: Record<string, number>;
  } | null;
  scoring: {
    model: string;
    device: string | null;
    loaded: boolean;
    queued: number;
    scored: number;
    batches: number;
    lastBatchSeconds: number | null;
    lastError: string | null;
  } | null;
}

export interface SentimentGrid {
  roots: Record<string, { t: number[]; features: Record<string, number[]>; articles: number }>;
  names: string[];
  displayNames: Record<string, string>;
  stepMinutes: number;
}
