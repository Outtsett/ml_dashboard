/**
 * The contract of the link between the Market chart and the notebooks beside it
 * (server: apps/api/market/chartLink.ts; browser: apps/web/src/market/lib/).
 *
 * Times are epoch MILLISECONDS in the stamps the chart itself uses — the values
 * `/api/charts/ohlcv` returns (futures: CME Pacific wall clock stored as UTC;
 * forex: true UTC). Colours are "#rrggbb", "#rrggbbaa" or rgba(...).
 */

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
    kind: z.literal("band"),
    id: z.string().min(1).max(80),
    label,
    color,
    bands: z.array(z.object({
      start: time,
      end: time.nullable().default(null),
      top: z.number().finite(),
      bottom: z.number().finite(),
      text: z.string().max(40).optional(),
    })).max(2_000),
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

/** postMessage types between the dashboard page and a notebook iframe. */
/** A request to move the Market chart's view: the newest bar, or a time range (epoch ms in the chart's stamps). */
export const ChartViewSchema = z.union([
  z.object({ target: z.literal("latest") }),
  z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() }).refine((v) => v.endMs > v.startMs, {
    message: "endMs must be after startMs",
  }),
]);
export type ChartView = z.infer<typeof ChartViewSchema>;

export const CHART_CONTEXT_MESSAGE = "dashboard:chart-context";
export const NOTEBOOK_READY_MESSAGE = "dashboard:notebook-ready";
