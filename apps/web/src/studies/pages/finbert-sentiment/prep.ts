/**
 * Pure data preparation for the finbert-sentiment page: stacked histograms and
 * hourly counts by vendor, tier counts, and a thinning of long series for
 * drawing. No React, so the test file can hold it to fixed inputs.
 */

import type { NewsRoute } from "@shared/studies/finbert-sentiment";

/** Vendors the lake has news from, in the order the notebook's legend used. */
export const KNOWN_VENDORS = ["gdelt", "rss", "alphavantage"] as const;

/** Okabe-Ito colour per vendor; every chart also hatches them (see VendorDefs) so colour never stands alone. */
export const VENDOR_COLORS: Record<string, string> = { gdelt: "#0072B2", rss: "#E69F00", alphavantage: "#CC79A7" };
export const VENDOR_GLYPHS: Record<string, string> = { gdelt: "■", rss: "▲", alphavantage: "◆" };

export function vendorsOf(headlines: readonly NewsRoute[]): string[] {
  const seen = new Set(headlines.map((headline) => headline.vendor));
  const known = KNOWN_VENDORS.filter((vendor) => seen.has(vendor));
  const other = [...seen].filter((vendor) => !(KNOWN_VENDORS as readonly string[]).includes(vendor)).sort();
  return [...known, ...other];
}

export interface ScoreBin {
  lower: number;
  upper: number;
  middle: number;
  total: number;
  [vendor: string]: number;
}

/** FinBERT scores lie in [-1, 1]: `bins` equal bins over that range, counted per vendor. */
export function scoreHistogram(headlines: readonly NewsRoute[], bins: number, vendors: readonly string[]): ScoreBin[] {
  const width = 2 / bins;
  const rows: ScoreBin[] = Array.from({ length: bins }, (_, i) => {
    const lower = -1 + i * width;
    const row: ScoreBin = { lower, upper: lower + width, middle: lower + width / 2, total: 0 };
    for (const vendor of vendors) row[vendor] = 0;
    return row;
  });
  for (const headline of headlines) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((headline.score + 1) / width)));
    const row = rows[index] as ScoreBin;
    row[headline.vendor] = ((row[headline.vendor] as number | undefined) ?? 0) + 1;
    row.total += 1;
  }
  return rows;
}

export interface HourBucket {
  startMs: number;
  total: number;
  [vendor: string]: number;
}

const BUCKET_HOURS = [1, 2, 3, 6, 12, 24, 48, 168] as const;

/** Headlines per hour (UTC) by vendor, zero-filled between the first and last; the bucket widens (up to a week) past `maximumBars` bars. */
export function hourlyCounts(headlines: readonly NewsRoute[], vendors: readonly string[], maximumBars = 400): { buckets: HourBucket[]; bucketHours: number } {
  if (headlines.length === 0) return { buckets: [], bucketHours: 1 };
  const hour = 3_600_000;
  let first = Infinity;
  let last = -Infinity;
  for (const headline of headlines) {
    first = Math.min(first, headline.seenMs);
    last = Math.max(last, headline.seenMs);
  }
  const firstHour = Math.floor(first / hour);
  const lastHour = Math.floor(last / hour);
  const span = lastHour - firstHour + 1;
  const bucketHours: number = BUCKET_HOURS.find((candidate) => Math.ceil(span / candidate) <= maximumBars) ?? 168;
  const origin = Math.floor(firstHour / bucketHours) * bucketHours;
  const count = Math.floor((lastHour - origin) / bucketHours) + 1;
  const buckets: HourBucket[] = Array.from({ length: count }, (_, i) => {
    const bucket: HourBucket = { startMs: (origin + i * bucketHours) * hour, total: 0 };
    for (const vendor of vendors) bucket[vendor] = 0;
    return bucket;
  });
  for (const headline of headlines) {
    const bucket = buckets[Math.floor((Math.floor(headline.seenMs / hour) - origin) / bucketHours)] as HourBucket;
    bucket[headline.vendor] = ((bucket[headline.vendor] as number | undefined) ?? 0) + 1;
    bucket.total += 1;
  }
  return { buckets, bucketHours };
}

/** Counts per category (tier, direction), most frequent first. */
export function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** At most `maximumPoints` points of a series for drawing, always keeping the first and the last. */
export function thinSeries(times: ArrayLike<number>, values: ArrayLike<number>, maximumPoints: number): Array<{ time: number; value: number }> {
  const n = times.length;
  if (n <= maximumPoints) return Array.from({ length: n }, (_, i) => ({ time: times[i] as number, value: values[i] as number }));
  const stride = (n - 1) / (maximumPoints - 1);
  const points: Array<{ time: number; value: number }> = [];
  for (let k = 0; k < maximumPoints; k += 1) {
    const i = Math.round(k * stride);
    points.push({ time: times[i] as number, value: values[i] as number });
  }
  return points;
}

/** An evenly strided sample of at most `maximum` rows. */
export function strideSample<T>(rows: readonly T[], maximum: number): T[] {
  if (rows.length <= maximum) return [...rows];
  const stride = rows.length / maximum;
  return Array.from({ length: maximum }, (_, k) => rows[Math.floor(k * stride)] as T);
}

/** A UTC calendar date `yyyy-mm-dd`, `daysBefore` days before `epochMs`. */
export function utcDate(epochMs: number, daysBefore = 0): string {
  return new Date(epochMs - daysBefore * 86_400_000).toISOString().slice(0, 10);
}
