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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import type { z } from "zod";
import { Logger } from "@nestjs/common";
import {
  ChartContextSchema,
  OverlaySetSchema,
  type ChartContext,
  type OverlaySet,
} from "@shared/chartLink";

export { ChartContextSchema, OverlaySchema, OverlaySetSchema } from "@shared/chartLink";
export type { ChartContext, Overlay, OverlaySet } from "@shared/chartLink";

const MAX_SOURCES = 40;
const logger = new Logger("ChartLink");

/** Kept on disk as well as in memory: the dev server restarts on every save
 *  (tsx --watch), and without this each restart wiped every notebook's drawings
 *  and left notebooks without a context until the chart next moved. */
const STATE_PATH = path.join(process.cwd(), "data", "chart_link.json");
const WRITE_DELAY_MS = 500;

let context: ChartContext | null = null;
let sequence = 0;
const overlaySets = new Map<string, OverlaySet>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Tests run in this repository's working directory: never touch the real state file there. */
const PERSIST = !process.env.VITEST;

function writeState(): void {
  if (!PERSIST || writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      mkdirSync(path.dirname(STATE_PATH), { recursive: true });
      const temporary = `${STATE_PATH}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ context, sets: [...overlaySets.values()] }));
      renameSync(temporary, STATE_PATH);
    } catch (err) {
      logger.warn(`could not save the chart link state: ${(err as Error).message}`);
    }
  }, WRITE_DELAY_MS);
  writeTimer.unref?.();
}

/** Restores what was on screen before the last restart; anything unreadable or
 *  no longer valid under the contract is dropped, never guessed at. */
function readState(): void {
  if (!PERSIST) return;
  let stored: { context?: unknown; sets?: unknown[] };
  try {
    stored = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { context?: unknown; sets?: unknown[] };
  } catch {
    return;
  }
  const storedContext = ChartContextSchema.safeParse(stored.context);
  if (storedContext.success && stored.context && typeof stored.context === "object") {
    const extra = stored.context as { updatedAtIso?: unknown; sequence?: unknown };
    sequence = typeof extra.sequence === "number" ? extra.sequence : 0;
    context = { ...storedContext.data, updatedAtIso: typeof extra.updatedAtIso === "string" ? extra.updatedAtIso : new Date().toISOString(), sequence };
  }
  for (const entry of stored.sets ?? []) {
    const parsed = OverlaySetSchema.safeParse(entry);
    if (!parsed.success) continue;
    const updatedAtIso = typeof (entry as { updatedAtIso?: unknown }).updatedAtIso === "string" ? (entry as { updatedAtIso: string }).updatedAtIso : new Date().toISOString();
    overlaySets.set(parsed.data.source, { ...parsed.data, updatedAtIso });
  }
}

readState();

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
  writeState();
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
  writeState();
  return stored;
}

export function clearOverlaySet(source: string): boolean {
  const removed = overlaySets.delete(source);
  if (removed) {
    chartLinkEvents.emit("overlays", listOverlaySets());
    writeState();
  }
  return removed;
}

export function clearAllOverlaySets(): number {
  const count = overlaySets.size;
  overlaySets.clear();
  if (count > 0) {
    chartLinkEvents.emit("overlays", listOverlaySets());
    writeState();
  }
  return count;
}

/** Test seam. */
export function resetChartLinkForTests(): void {
  context = null;
  sequence = 0;
  overlaySets.clear();
}
