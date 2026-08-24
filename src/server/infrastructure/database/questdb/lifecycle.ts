import { logInfo } from "../../lib/log";
/**
 * QuestDB Process Manager - Desktop/Local Version
 *
 * Assumes QuestDB is already installed and running locally.
 * No auto-download or process spawning needed.
 * Just checks connectivity to the existing QuestDB instance.
 */

const QUESTDB_HTTP_PORT = process.env.QUESTDB_HTTP_PORT || '9000';
const QUESTDB_HOST = process.env.QUESTDB_HOST || 'localhost';

// Last-known connectivity, refreshed by every live probe. On desktop QuestDB is
// an externally-managed service (nssm), so this is never a process we own — the
// only honest "is it up" signal is a live HTTP probe, not a one-shot boot flag.
let connected = false;

/**
 * Single live connectivity probe with a hard timeout. The previous
 * implementation used a bare `fetch` with no AbortController, so a half-open
 * socket could hang the caller indefinitely. 2s is generous for a localhost
 * `SELECT 1`.
 */
async function probeQuestDB(timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `http://${QUESTDB_HOST}:${QUESTDB_HTTP_PORT}/exec?query=SELECT%201`,
      { signal: controller.signal }
    );
    connected = response.ok;
  } catch {
    connected = false;
  } finally {
    clearTimeout(timer);
  }
  return connected;
}

export async function startQuestDB(): Promise<{ started: boolean; error?: string }> {
  // For desktop: QuestDB should already be running as a local service.
  // We just verify connectivity.
  try {
    const isReady = await waitForQuestDB(10000);
    if (isReady) {
      connected = true;
      return { started: true };
    } else {
      return {
        started: false,
        error: 'QuestDB not reachable. Please ensure QuestDB is running locally.'
      };
    }
  } catch (error) {
    return {
      started: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function waitForQuestDB(timeout: number): Promise<boolean> {
  const start = Date.now();
  const checkInterval = 1000;

  while (Date.now() - start < timeout) {
    if (await probeQuestDB()) {
      logInfo('[QuestDB] Connection verified (external instance)');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  logInfo('[QuestDB] Could not connect to QuestDB - is it running?');
  return false;
}

export function stopQuestDB(): void {
  // No-op: we don't manage the QuestDB process on desktop
  logInfo('[QuestDB] Desktop mode: QuestDB lifecycle managed externally');
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
  // Live-probe rather than trusting a boot-time flag: QuestDB is an external
  // service we never spawn, so `connected` is only meaningful when refreshed
  // against the running instance. Without this, the dashboard reported
  // "not connected" on every boot even though QuestDB was fully serving,
  // because `connected` was only ever set by an explicit POST /questdb/start.
  const isUp = await probeQuestDB();
  return {
    running: isUp,
    pid: undefined,
    uptime: isUp ? 'running (external)' : 'not connected'
  };
}
