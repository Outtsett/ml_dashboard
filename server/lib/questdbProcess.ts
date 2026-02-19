/**
 * QuestDB Process Manager - Desktop/Local Version
 *
 * Assumes QuestDB is already installed and running locally.
 * No auto-download or process spawning needed.
 * Just checks connectivity to the existing QuestDB instance.
 */

const QUESTDB_HTTP_PORT = process.env.QUESTDB_HTTP_PORT || '9000';
const QUESTDB_HOST = process.env.QUESTDB_HOST || 'localhost';

let connected = false;

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
    try {
      const response = await fetch(`http://${QUESTDB_HOST}:${QUESTDB_HTTP_PORT}/exec?query=SELECT%201`);
      if (response.ok) {
        console.log('[QuestDB] Connection verified (external instance)');
        return true;
      }
    } catch (e) {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  console.log('[QuestDB] Could not connect to QuestDB - is it running?');
  return false;
}

export function stopQuestDB(): void {
  // No-op: we don't manage the QuestDB process on desktop
  console.log('[QuestDB] Desktop mode: QuestDB lifecycle managed externally');
  connected = false;
}

export function isQuestDBRunning(): boolean {
  return connected;
}

export function getQuestDBStatus(): {
  running: boolean;
  pid: number | undefined;
  uptime: string;
} {
  return {
    running: connected,
    pid: undefined,
    uptime: connected ? 'running (external)' : 'not connected'
  };
}
