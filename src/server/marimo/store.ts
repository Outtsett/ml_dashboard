/**
 * The notebook tab's small persistent state — which notebooks are pinned, how
 * long each environment took to start last time, and the last health check of
 * every notebook — as two JSON files under `data/`.
 *
 * App metadata, not analysis: nothing here is a research number, so it does not
 * go to the lake. A JSON file rather than a SQLite table because it is a few
 * kilobytes read at most once a second, and adding a table means a `db:push`,
 * which on this database also drops the orphaned `mw_file_states` table.
 *
 * Writes go to a temporary file first and are then renamed over the old one, so
 * a crash mid-write never leaves a half-written file that would lose every pin.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { Logger } from "@nestjs/common";

const logger = new Logger("MarimoStore");

const DATA_DIRECTORY = path.join(process.cwd(), "data");
const PREFERENCES_PATH = path.join(DATA_DIRECTORY, "notebook_preferences.json");
const HEALTH_PATH = path.join(DATA_DIRECTORY, "notebook_health.json");

export type HealthStatus = "passed" | "failed" | "queued" | "running" | "cancelled";

export interface HealthRecord {
  status: HealthStatus;
  /** When the check finished (or was queued / started, while it is not finished). */
  checkedAtIso: string;
  /** The notebook's modified time when it was checked: a newer file means the result is stale. */
  sourceModifiedAtIso: string;
  durationSeconds: number | null;
  /** What marimo said when cells failed — the exception lines, then the stderr tail. */
  error?: string;
  /** Size of the exported page, a second signal: a notebook that dies early exports far smaller. */
  outputSizeBytes?: number;
}

interface Preferences {
  pinnedPaths: string[];
  /** Seconds from spawn to healthy, the last time each group started, for the progress bar. */
  startupSecondsBySlug: Record<string, number>;
}

function readJson<T>(filePath: string, empty: T): T {
  try {
    return { ...empty, ...(JSON.parse(readFileSync(filePath, "utf8")) as T) };
  } catch {
    return empty;
  }
}

function writeJson(filePath: string, value: unknown): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2));
    renameSync(temporary, filePath);
  } catch (err) {
    logger.error(`could not write ${filePath}: ${(err as Error).message}`);
  }
}

let preferences: Preferences | null = null;

function loadPreferences(): Preferences {
  preferences ??= readJson<Preferences>(PREFERENCES_PATH, { pinnedPaths: [], startupSecondsBySlug: {} });
  return preferences;
}

/** Paths compare case-insensitively on Windows, where the filesystem does. */
export function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function pinnedPaths(): string[] {
  return [...loadPreferences().pinnedPaths];
}

export function isPinned(notebookPath: string): boolean {
  return loadPreferences().pinnedPaths.some((pinned) => samePath(pinned, notebookPath));
}

export function setPinned(notebookPath: string, pinned: boolean): string[] {
  const current = loadPreferences();
  const without = current.pinnedPaths.filter((existing) => !samePath(existing, notebookPath));
  current.pinnedPaths = pinned ? [...without, path.resolve(notebookPath)] : without;
  writeJson(PREFERENCES_PATH, current);
  return pinnedPaths();
}

export function lastStartupSeconds(slug: string): number | null {
  return loadPreferences().startupSecondsBySlug[slug] ?? null;
}

export function recordStartupSeconds(slug: string, seconds: number): void {
  const current = loadPreferences();
  current.startupSecondsBySlug[slug] = Math.round(seconds * 10) / 10;
  writeJson(PREFERENCES_PATH, current);
}

/** The state every notebook is in now (queued, running, cancelled or a result). */
let health: Record<string, HealthRecord> | null = null;
/** The last FINISHED result of every notebook — what is written to disk. Kept
 *  apart so queueing or running a check never erases the result before it: a
 *  restart halfway through "check all" still shows every earlier verdict. */
let lastFinished: Record<string, HealthRecord> = {};

function healthKey(notebookPath: string): string {
  const resolved = path.resolve(notebookPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isFinished(record: HealthRecord): boolean {
  return record.status === "passed" || record.status === "failed";
}

function loadHealth(): Record<string, HealthRecord> {
  if (!health) {
    const stored = readJson<{ byPath: Record<string, HealthRecord> }>(HEALTH_PATH, { byPath: {} }).byPath;
    lastFinished = Object.fromEntries(Object.entries(stored).filter(([, record]) => isFinished(record)));
    health = { ...lastFinished };
  }
  return health;
}

/** What the list shows: the check in progress, or else the last finished result.
 *  A cancelled check falls back to the result it would have replaced. */
export function healthOf(notebookPath: string): HealthRecord | undefined {
  const key = healthKey(notebookPath);
  const current = loadHealth()[key];
  if (current?.status === "cancelled") return lastFinished[key];
  return current;
}

/** The raw current record, including "cancelled" (health.ts needs to see it). */
export function currentHealthOf(notebookPath: string): HealthRecord | undefined {
  return loadHealth()[healthKey(notebookPath)];
}

export function recordHealth(notebookPath: string, record: HealthRecord): void {
  const all = loadHealth();
  const key = healthKey(notebookPath);
  all[key] = record;
  if (!isFinished(record)) return;
  lastFinished[key] = record;
  writeJson(HEALTH_PATH, { byPath: lastFinished });
}

/** Test seam: forget what was loaded so the next read goes back to disk. */
export function resetStoreCacheForTests(): void {
  preferences = null;
  health = null;
  lastFinished = {};
}
