/**
 * The link between the Market chart and the notebooks shown beside it.
 *
 * Two things travel, both kept in memory (they describe what is on screen now,
 * not a record, so nothing is persisted):
 *
 *  - The chart CONTEXT, written by the browser whenever the chart changes:
 *    symbol, timeframe, the visible time range, the bar under the crosshair and
 *    the bar last clicked. A notebook reads it (GET or the stream) and analyses
 *    exactly what the chart shows.
 *
 *  - OVERLAYS, written by notebooks: lines, markers, horizontal levels, shaded
 *    time zones and vertical lines, drawn on the Market chart. Each notebook
 *    (a `source`) replaces its own set on every push, so a re-run cell never
 *    piles duplicates on the chart; each overlay names the symbol and timeframe
 *    it belongs to, and the chart draws only those matching what it shows.
 *
 * Times are epoch MILLISECONDS in the stamps the chart itself uses — the same
 * values `/api/charts/ohlcv` returns (for futures, CME Pacific wall clock stored
 * as UTC; for forex, true UTC).
 */

import { EventEmitter } from "events";
import { z } from "zod";

export const ChartContextSchema = z.object({
  symbol: z.string().min(1).max(40),
  /** The chart's timeframe key, as `/api/charts/ohlcv` takes it: 1m, 5m, 1h, 1d … */
  timeframe: z.string().min(1).max(8),
  assetClass: z.enum(["futures", "forex"]),
  visibleStartMs: z.number().int().nullable(),
  visibleEndMs: z.number().int().nullable(),
  /** The bar under the crosshair, or null when the pointer is off the chart. */
  cursorMs: z.number().int().nullable(),
  /** The bar last clicked on the chart: a notebook can focus on it. */
  selectedMs: z.number().int().nullable(),
  firstBarMs: z.number().int().nullable(),
  lastBarMs: z.number().int().nullable(),
  barCount: z.number().int().min(0),
});
export type ChartContext = z.infer<typeof ChartContextSchema> & { updatedAtIso: string; sequence: number };

const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$|^rgba?\([\d\s.,]+\)$/).optional();
const label = z.string().max(120).optional();
const time = z.number().int();

export const OverlaySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("line"),
    id: z.string().min(1).max(80),
    label,
    color,
    /** "price" draws on the candles' price scale; "pane" in its own panel below. */
    pane: z.enum(["price", "pane"]).default("price"),
    points: z.array(z.object({ time, value: z.number().finite() })).max(20_000),
  }),
  z.object({
    kind: z.literal("marker"),
    id: z.string().min(1).max(80),
    label,
    color,
    markers: z.array(z.object({
      time,
      position: z.enum(["above", "below", "on"]).default("above"),
      shape: z.enum(["arrowUp", "arrowDown", "circle", "square"]).default("circle"),
      text: z.string().max(40).optional(),
    })).max(2_000),
  }),
  z.object({
    kind: z.literal("level"),
    id: z.string().min(1).max(80),
    label,
    color,
    price: z.number().finite(),
    style: z.enum(["solid", "dashed", "dotted"]).default("dashed"),
  }),
  z.object({
    kind: z.literal("zone"),
    id: z.string().min(1).max(80),
    label,
    color,
    zones: z.array(z.object({ start: time, end: time, text: z.string().max(40).optional() })).max(2_000),
  }),
  z.object({
    kind: z.literal("vline"),
    id: z.string().min(1).max(80),
    label,
    color,
    times: z.array(time).max(2_000),
  }),
]);
export type Overlay = z.infer<typeof OverlaySchema>;

export const OverlaySetSchema = z.object({
  /** Who drew it — a notebook's file stem or title. One set per source. */
  source: z.string().min(1).max(120),
  symbol: z.string().min(1).max(40),
  timeframe: z.string().min(1).max(8),
  overlays: z.array(OverlaySchema).max(50),
});
export type OverlaySet = z.infer<typeof OverlaySetSchema> & { updatedAtIso: string };

const MAX_SOURCES = 40;

let context: ChartContext | null = null;
let sequence = 0;
const overlaySets = new Map<string, OverlaySet>();

/** "context" (ChartContext) and "overlays" (OverlaySet[]) — what the stream forwards. */
export const chartLinkEvents = new EventEmitter();
chartLinkEvents.setMaxListeners(200);

/** Stores the chart context. Returns true when it changed (identical writes are
 *  common: the chart publishes on every range settle). */
export function setChartContext(next: z.infer<typeof ChartContextSchema>): boolean {
  if (context) {
    const { updatedAtIso: _u, sequence: _s, ...previous } = context;
    if (JSON.stringify(previous) === JSON.stringify(next)) return false;
  }
  sequence += 1;
  context = { ...next, updatedAtIso: new Date().toISOString(), sequence };
  chartLinkEvents.emit("context", context);
  return true;
}

export function getChartContext(): ChartContext | null {
  return context;
}

export function listOverlaySets(): OverlaySet[] {
  return [...overlaySets.values()].sort((a, b) => a.source.localeCompare(b.source));
}

/** Replaces one source's overlays. The oldest source is dropped past MAX_SOURCES. */
export function putOverlaySet(set: z.infer<typeof OverlaySetSchema>): OverlaySet {
  const stored: OverlaySet = { ...set, updatedAtIso: new Date().toISOString() };
  overlaySets.delete(set.source);
  overlaySets.set(set.source, stored);
  while (overlaySets.size > MAX_SOURCES) {
    const oldest = overlaySets.keys().next().value as string;
    overlaySets.delete(oldest);
  }
  chartLinkEvents.emit("overlays", listOverlaySets());
  return stored;
}

export function clearOverlaySet(source: string): boolean {
  const removed = overlaySets.delete(source);
  if (removed) chartLinkEvents.emit("overlays", listOverlaySets());
  return removed;
}

export function clearAllOverlaySets(): number {
  const count = overlaySets.size;
  overlaySets.clear();
  if (count > 0) chartLinkEvents.emit("overlays", listOverlaySets());
  return count;
}

/** Test seam. */
export function resetChartLinkForTests(): void {
  context = null;
  sequence = 0;
  overlaySets.clear();
}
