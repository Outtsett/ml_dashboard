/**
 * Serving-layer lifecycle.
 *
 * There is no process to manage any more. QuestDB was an externally-managed
 * Windows service on :9000; the replacement is an in-process DuckDB over the
 * lake, so "is it running" collapses to "is the lake reachable and are the
 * views defined" — a live probe, never a boot-time flag.
 *
 * The function names are the QuestDB ones because callers outside this
 * directory import them; a later pass handles renaming.
 */

import { checkQuestDBHealth, getServingLocation, getServingViewNames } from "./connection";
import { logInfo } from "../../lib/log";

/** Last-known reachability, refreshed by every live probe. */
let connected = false;

async function probe(): Promise<boolean> {
  connected = await checkQuestDBHealth();
  return connected;
}

/**
 * Verify the serving layer can answer.
 *
 * Nothing is started — the first probe builds the DuckDB catalog if it has not
 * been built yet, which is the whole of "startup" now.
 */
export async function startQuestDB(): Promise<{ started: boolean; error?: string }> {
  try {
    if (await probe()) {
      const { snapshot } = getServingLocation();
      logInfo(`[lake] Serving layer verified: ${getServingViewNames().length} views over ${snapshot}`);
      return { started: true };
    }
    const { endpoint, snapshot } = getServingLocation();
    return {
      started: false,
      error:
        `Lake not reachable at ${endpoint} (snapshot ${snapshot}). ` +
        "QuestDB was retired on 2026-09-10; ensure AIStor is running.",
    };
  } catch (error) {
    return {
      started: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Drop the cached reachability flag.
 *
 * The DuckDB instance itself is deliberately left open — `closeQuestDB()` in
 * connection.ts owns that, and tearing the catalog down here would make the
 * next read pay a full rebuild for a status toggle.
 */
export function stopQuestDB(): void {
  logInfo("[lake] Serving layer is in-process; nothing to stop");
  connected = false;
}

export function isQuestDBRunning(): boolean {
  return connected;
}

export async function getQuestDBProcessStatus(): Promise<{
  running: boolean;
  pid: number | undefined;
  uptime: string;
}> {
  // Live-probe rather than trusting a cached flag: the lake is an external
  // service this process never spawns, so `connected` is only meaningful when
  // refreshed against it.
  const isUp = await probe();
  return {
    running: isUp,
    // In-process DuckDB — this server's own pid, not a database daemon's.
    pid: isUp ? process.pid : undefined,
    uptime: isUp ? "running (in-process DuckDB over the lake)" : "lake not reachable",
  };
}
