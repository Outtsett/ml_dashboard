/**
 * FinBERT news sentiment: the body of GET /api/studies/finbert-sentiment and
 * the pure compute the handler and the page share.
 *
 * The compute is a line-for-line port of datalake `lake.sentiment`
 * (collapse_rows, merge_spans, _decayed_sums, compute_from_stream), the one
 * implementation every model trains with. The parity test
 * (apps/api/tests/studies/finbert-sentiment.test.ts) holds it to that module's
 * own output on a frozen fixture to 1e-9. Times here are true-UTC epoch
 * SECONDS, as in the Python. Nothing in this file touches a lake or a DOM.
 */

export const MODEL = "ProsusAI/finbert";
export const GDELT_BUCKET_SECONDS = 15 * 60;
export const SYNDICATION_WINDOW_SECONDS = 2 * 3600;
export const MAX_RECENCY_MINUTES = 7 * 24 * 60;
export const LOOKBACK_BEFORE_FIRST_BAR_DAYS = 45;
export const COVERAGE_MERGE_GAP_SECONDS = 30 * 60;

export const FEATURE_NAMES = [
  "finbert_sentiment_decayed_short",
  "finbert_sentiment_decayed_long",
  "finbert_news_intensity_decayed",
  "finbert_news_burst_ratio",
  "finbert_sentiment_mean_window",
  "finbert_article_count_window_log",
  "finbert_minutes_since_article_log",
  "finbert_macro_sentiment_decayed_short",
  "finbert_news_coverage_flag",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export const DISPLAY_NAMES: Record<FeatureName, string> = {
  finbert_sentiment_decayed_short: "FinBERT sentiment, short decay (signed log)",
  finbert_sentiment_decayed_long: "FinBERT sentiment, long decay (signed log)",
  finbert_news_intensity_decayed: "News intensity, short decay (log)",
  finbert_news_burst_ratio: "News burst ratio (short rate / long rate, log)",
  finbert_sentiment_mean_window: "FinBERT mean sentiment over the window",
  finbert_article_count_window_log: "Articles in the window (log count)",
  finbert_minutes_since_article_log: "Minutes since the last article (log)",
  finbert_macro_sentiment_decayed_short: "FinBERT macro-news sentiment, short decay (signed log)",
  finbert_news_coverage_flag: "News coverage (1 = a source was collecting)",
};

/** The plain-words definition of each column (lake.sentiment's module doc). */
export const FEATURE_DEFINITIONS: Record<FeatureName, string> = {
  finbert_sentiment_decayed_short: "signed log(1 + |S|) of S = sum of weight x score x 2^(-age / h_short)",
  finbert_sentiment_decayed_long: "the same with the long half-life h_long",
  finbert_news_intensity_decayed: "log(1 + sum of |weight| x 2^(-age / h_short)): how much news, not its sign",
  finbert_news_burst_ratio: "log(1 + short news rate / (long news rate + 1e-9)): the rate against its own recent norm",
  finbert_sentiment_mean_window: "mean of weight x score over the window (0 when the window is empty)",
  finbert_article_count_window_log: "log(1 + headlines known in the window)",
  finbert_minutes_since_article_log: "log(1 + minutes since the last headline), capped at 7 days",
  finbert_macro_sentiment_decayed_short: "the short decayed sum over macro-tier routes only (signed log)",
  finbert_news_coverage_flag: "1 when the bar opens inside a span some source was collecting, else 0",
};

// ── response body ─────────────────────────────────────────────────────────

/** One scored route (article x root) seen in the window. */
export interface NewsRoute {
  articleId: string;
  vendor: string;
  tier: string;
  relevance: number;
  /** +1, or -1 when the story's subject is a forex pair's quote currency. */
  direction: number;
  title: string;
  /** When the article was first seen (epoch milliseconds, true UTC). */
  seenMs: number;
  /** FinBERT score: p(positive) - p(negative). */
  score: number;
}

/** One distinct headline after routes are collapsed and syndicated copies counted once. */
export interface NewsStory {
  /** When it became knowable (epoch seconds): seen time, plus 15 minutes for GDELT. */
  knownAt: number;
  /** relevance x direction, collapsed over routes: max(+1 relevances) - max(-1 relevances). */
  weight: number;
  score: number;
  macroWeight: number;
  title: string;
}

export interface FinbertBody {
  root: string;
  roots: string[];
  windowStartMs: number;
  windowEndMs: number;
  lookbackDays: number;
  /** Distinct scored headlines in the window, and their routes. */
  distinctHeadlineCount: number;
  routeCount: number;
  /** Distinct headlines in the window (one row each), capped. */
  headlines: NewsRoute[];
  /** The newest routes in the window, for the table, capped. */
  routes: NewsRoute[];
  /** Stories known from `window start - lookback` to the window's end: what every bar's decayed sum reads. */
  stories: NewsStory[];
  /** Merged [start, end] epoch-second spans when some source that reaches this root was collecting. */
  coverage: Array<[number, number]>;
  truncated: { headlines: boolean; routes: boolean };
}

export const EMPTY_BODY: FinbertBody = {
  root: "",
  roots: [],
  windowStartMs: 0,
  windowEndMs: 0,
  lookbackDays: LOOKBACK_BEFORE_FIRST_BAR_DAYS,
  distinctHeadlineCount: 0,
  routeCount: 0,
  headlines: [],
  routes: [],
  stories: [],
  coverage: [],
  truncated: { headlines: false, routes: false },
};

// ── collapse_rows, merge_spans ────────────────────────────────────────────

export interface RouteRow {
  articleId: string;
  vendor: string | null;
  tier: string | null;
  relevance: number;
  direction: number | null;
  title: string | null;
  seenEpoch: number;
  score: number;
}

export function knownAtOf(row: { vendor: string | null; seenEpoch: number }): number {
  return row.seenEpoch + (row.vendor === "gdelt" ? GDELT_BUCKET_SECONDS : 0);
}

export function normaliseTitle(title: string | null | undefined): string {
  return (title ?? "").toLowerCase().match(/[a-z0-9]+/g)?.join(" ") ?? "";
}

interface ArticleEntry {
  known: number;
  pos: number;
  neg: number;
  macroPos: number;
  macroNeg: number;
  score: number;
  title: string;
  rawTitle: string;
}

/**
 * Article x route rows -> one story per distinct headline, never using a row
 * before it was known. A row for the same article that became known later
 * never raises the weight at the earlier time; syndicated copies (the same
 * normalised title within two hours of its first copy) count once, at the first.
 */
export function collapseRows(rows: readonly RouteRow[]): NewsStory[] {
  const ordered = [...rows].sort((a, b) => knownAtOf(a) - knownAtOf(b));
  const perArticle = new Map<string, ArticleEntry>();
  for (const row of ordered) {
    const known = knownAtOf(row);
    let entry = perArticle.get(row.articleId);
    if (entry === undefined) {
      entry = {
        known, pos: 0, neg: 0, macroPos: 0, macroNeg: 0, score: row.score,
        title: normaliseTitle(row.title), rawTitle: row.title ?? "",
      };
      perArticle.set(row.articleId, entry);
    } else if (known > entry.known) {
      continue; // a route learned later: not knowable at entry.known
    }
    const positive = (Number(row.direction ?? 0) || 1) > 0;
    const relevance = Number(row.relevance);
    if (positive) {
      entry.pos = Math.max(entry.pos, relevance);
      if (row.tier === "macro") entry.macroPos = Math.max(entry.macroPos, relevance);
    } else {
      entry.neg = Math.max(entry.neg, relevance);
      if (row.tier === "macro") entry.macroNeg = Math.max(entry.macroNeg, relevance);
    }
  }

  const stories: ArticleEntry[] = [];
  const openStory = new Map<string, ArticleEntry>();
  const byKnown = [...perArticle.entries()].sort((a, b) => a[1].known - b[1].known);
  for (const [articleId, entry] of byKnown) {
    const title = entry.title || articleId;
    const first = openStory.get(title);
    if (first !== undefined && entry.known - first.known <= SYNDICATION_WINDOW_SECONDS) continue;
    openStory.set(title, entry);
    stories.push(entry);
  }
  return stories.map((entry) => ({
    knownAt: entry.known,
    weight: entry.pos - entry.neg,
    score: entry.score,
    macroWeight: entry.macroPos - entry.macroNeg,
    title: entry.rawTitle,
  }));
}

/** Coverage spans closer than `gap` seconds are one span. */
export function mergeSpans(spans: ReadonlyArray<readonly [number, number]>, gap = COVERAGE_MERGE_GAP_SECONDS): Array<[number, number]> {
  const ordered = spans.filter(([a, b]) => b > a).map(([a, b]) => [a, b] as [number, number]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ordered) {
    const last = merged[merged.length - 1];
    if (last !== undefined && start <= last[1] + gap) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * Whether a coverage span of (vendor, source) says anything about `root`: a
 * GDELT span covers only the roots its query maps to; a feed read with
 * headline routing (rss, alphavantage) can route a story to any root.
 */
export function sourceReaches(vendor: string, source: string, root: string, gdeltQueryRoots: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  if (vendor === "gdelt") return gdeltQueryRoots.get(source)?.has(root) ?? false;
  return true;
}

// ── the features ──────────────────────────────────────────────────────────

/** numpy.searchsorted(side="left") over an ascending array. */
export function searchLeft(sorted: ArrayLike<number>, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sorted[middle] as number) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** numpy.searchsorted(side="right"). */
export function searchRight(sorted: ArrayLike<number>, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sorted[middle] as number) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * S(t) = sum over articles known strictly before t of value * 2^(-(t - a)/h),
 * by the one-pass recurrence A_k = A_(k-1) * 2^(-(a_k - a_(k-1))/h) + v_k, read
 * at every bar. 2^(-dt/h) lies in (0, 1]; it underflows to 0, never inf.
 */
export function decayedSums(barTimes: ArrayLike<number>, articleTimes: ArrayLike<number>, values: ArrayLike<number>, halfLifeSeconds: number): Float64Array {
  const barCount = barTimes.length;
  const out = new Float64Array(barCount);
  const articleCount = articleTimes.length;
  if (articleCount === 0) return out;
  const rate = Math.LN2 / halfLifeSeconds;
  const accumulated = new Float64Array(articleCount);
  let total = 0;
  let previous = articleTimes[0] as number;
  for (let k = 0; k < articleCount; k += 1) {
    const time = articleTimes[k] as number;
    total = total * Math.exp(-rate * (time - previous)) + (values[k] as number);
    accumulated[k] = total;
    previous = time;
  }
  for (let b = 0; b < barCount; b += 1) {
    const barTime = barTimes[b] as number;
    const last = searchLeft(articleTimes, barTime) - 1; // strictly before the open
    out[b] = last >= 0 ? (accumulated[last] as number) * Math.exp(-rate * (barTime - (articleTimes[last] as number))) : 0;
  }
  return out;
}

export function signedLog(x: number): number {
  return Math.sign(x) * Math.log1p(Math.abs(x));
}

export interface StreamInput {
  stories: readonly NewsStory[];
  /** Merged [start, end] spans in epoch seconds. */
  coverage: ReadonlyArray<readonly [number, number]>;
}

/** The half-lives and window (seconds) the models use for a bar grid of `barMinutes`. */
export function featureScales(barMinutes: number): { shortSeconds: number; longSeconds: number; windowSeconds: number } {
  return {
    shortSeconds: Math.max(20, 4 * barMinutes) * 60,
    longSeconds: Math.max(1440, 32 * barMinutes) * 60,
    windowSeconds: Math.max(60, 8 * barMinutes) * 60,
  };
}

/** The nine columns, one Float64Array per column, for bar opens `barTimes` (true-UTC epoch seconds, ascending). */
export function computeFeatures(barTimes: ArrayLike<number>, stream: StreamInput, barMinutes: number): Record<FeatureName, Float64Array> {
  const n = barTimes.length;
  const { shortSeconds, longSeconds, windowSeconds } = featureScales(barMinutes);
  const articleTimes = Float64Array.from(stream.stories, (story) => story.knownAt);
  const weight = Float64Array.from(stream.stories, (story) => story.weight);
  const score = Float64Array.from(stream.stories, (story) => story.score);
  const macro = Float64Array.from(stream.stories, (story) => story.macroWeight);
  const signed = weight.map((w, i) => w * (score[i] as number));
  const absolute = weight.map((w) => Math.abs(w));
  const macroSigned = macro.map((m, i) => m * (score[i] as number));

  const short = decayedSums(barTimes, articleTimes, signed, shortSeconds);
  const long = decayedSums(barTimes, articleTimes, signed, longSeconds);
  const intensityShort = decayedSums(barTimes, articleTimes, absolute, shortSeconds);
  const intensityLong = decayedSums(barTimes, articleTimes, absolute, longSeconds);
  const macroShort = decayedSums(barTimes, articleTimes, macroSigned, shortSeconds);

  const cumulative = new Float64Array(signed.length + 1);
  for (let i = 0; i < signed.length; i += 1) cumulative[i + 1] = (cumulative[i] as number) + (signed[i] as number);

  const starts = stream.coverage.map((span) => span[0]);
  const ends = stream.coverage.map((span) => span[1]);

  const columns = Object.fromEntries(FEATURE_NAMES.map((name) => [name, new Float64Array(n)])) as Record<FeatureName, Float64Array>;
  for (let b = 0; b < n; b += 1) {
    const barTime = barTimes[b] as number;
    const high = searchLeft(articleTimes, barTime);
    const low = searchLeft(articleTimes, barTime - windowSeconds);
    const count = high - low;
    const mean = count > 0 ? ((cumulative[high] as number) - (cumulative[low] as number)) / Math.max(count, 1) : 0;
    const minutesSince = high > 0
      ? Math.min(Math.max((barTime - (articleTimes[high - 1] as number)) / 60, 0), MAX_RECENCY_MINUTES)
      : MAX_RECENCY_MINUTES;
    const rateShort = (intensityShort[b] as number) / shortSeconds;
    const rateLong = (intensityLong[b] as number) / longSeconds;
    const burst = Math.log1p(rateShort / (rateLong + 1e-9));
    const position = starts.length > 0 ? searchRight(starts, barTime) - 1 : -1;
    const inside = position >= 0 && barTime < (ends[position] as number) + COVERAGE_MERGE_GAP_SECONDS;

    const row = [
      signedLog(short[b] as number),
      signedLog(long[b] as number),
      Math.log1p(intensityShort[b] as number),
      burst,
      mean,
      Math.log1p(count),
      Math.log1p(minutesSince),
      signedLog(macroShort[b] as number),
      inside ? 1 : 0,
    ];
    for (let c = 0; c < FEATURE_NAMES.length; c += 1) {
      const value = row[c] as number;
      (columns[FEATURE_NAMES[c] as FeatureName] as Float64Array)[b] = Number.isFinite(value) ? value : 0;
    }
  }
  return columns;
}

/** Bar opens from `startSeconds` (inclusive) to `stopSeconds` (exclusive), every `stepMinutes`, like numpy.arange. */
export function barGrid(startSeconds: number, stopSeconds: number, stepMinutes: number, maximumBars = 50_000): { times: Float64Array; truncated: boolean } {
  const step = stepMinutes * 60;
  const total = Math.max(0, Math.ceil((stopSeconds - startSeconds) / step));
  const count = Math.min(total, maximumBars);
  const first = total > maximumBars ? total - maximumBars : 0;
  const times = new Float64Array(count);
  for (let i = 0; i < count; i += 1) times[i] = startSeconds + (first + i) * step;
  return { times, truncated: total > maximumBars };
}

// ── the stepper: S(t) term by term ────────────────────────────────────────

export interface DecayTerm {
  knownAt: number;
  ageMinutes: number;
  weight: number;
  score: number;
  decay: number;
  term: number;
  title: string;
}

export interface DecayStep {
  /** Every headline known strictly before the bar opened, newest first. */
  terms: DecayTerm[];
  knownCount: number;
  /** S(t), before the signed log. */
  sum: number;
  /** sign(S) * log(1 + |S|): what the model sees. */
  modelValue: number;
}

export function decayStep(stories: readonly NewsStory[], barTime: number, halfLifeMinutes: number): DecayStep {
  const halfLife = halfLifeMinutes * 60;
  const terms: DecayTerm[] = [];
  let sum = 0;
  for (const story of stories) {
    if (!(story.knownAt < barTime)) continue;
    const decay = Math.pow(2, -(barTime - story.knownAt) / halfLife);
    const term = story.weight * story.score * decay;
    sum += term;
    terms.push({ knownAt: story.knownAt, ageMinutes: (barTime - story.knownAt) / 60, weight: story.weight, score: story.score, decay, term, title: story.title });
  }
  terms.sort((a, b) => a.ageMinutes - b.ageMinutes);
  return { terms, knownCount: terms.length, sum, modelValue: signedLog(sum) };
}

// ── eight numbers, as the notebook defines them ───────────────────────────

export interface EightNumbers {
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  excessKurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
}

function percentileSorted(sorted: Float64Array, fraction: number): number {
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const base = sorted[lower] as number;
  return lower === upper ? base : base + ((sorted[upper] as number) - base) * (position - lower);
}

/**
 * The notebook's eight numbers: standard deviation with ddof = 1, skewness
 * m3 / m2^1.5 and excess kurtosis m4 / m2^2 - 3 with POPULATION moments
 * (centred on the mean, divided by n), percentiles by linear interpolation
 * (numpy's default). Null where a moment is undefined (n < 3 for skewness,
 * n < 4 for kurtosis, or zero variance); a column with no finite value has count 0.
 */
export function eightNumbers(values: ArrayLike<number>): EightNumbers {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] as number;
    if (Number.isFinite(value)) finite.push(value);
  }
  const n = finite.length;
  if (n === 0) {
    return { count: 0, mean: null, median: null, standardDeviation: null, skewness: null, excessKurtosis: null, percentile25: null, percentile75: null, minimum: null, maximum: null };
  }
  const mean = finite.reduce((a, b) => a + b, 0) / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let sumSquares = 0;
  for (const value of finite) {
    const d = value - mean;
    sumSquares += d * d;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const sorted = Float64Array.from(finite).sort();
  return {
    count: n,
    mean,
    median: percentileSorted(sorted, 0.5),
    standardDeviation: n > 1 ? Math.sqrt(sumSquares / (n - 1)) : null,
    skewness: n > 2 && m2 > 0 ? m3 / Math.pow(m2, 1.5) : null,
    excessKurtosis: n > 3 && m2 > 0 ? m4 / (m2 * m2) - 3 : null,
    percentile25: percentileSorted(sorted, 0.25),
    percentile75: percentileSorted(sorted, 0.75),
    minimum: sorted[0] as number,
    maximum: sorted[n - 1] as number,
  };
}
