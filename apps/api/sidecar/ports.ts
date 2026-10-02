/**
 * Port and process helpers for sidecars (Windows: netstat / tasklist / taskkill).
 */

import { execFileSync } from "child_process";
import net from "net";

export function isPortOpen(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** PID and image name of whatever is LISTENING on `port`, for adoption and for
 *  naming the offender when the port is held by something else. */
export function resolvePortOwner(port: number): { pid: number | null; description: string } {
  try {
    const netstat = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true });
    const line = netstat.split(/\r?\n/).find((l) => new RegExp(`[:.]${port}\\s+.*LISTENING`).test(l));
    if (!line) return { pid: null, description: `port ${port}: no LISTENING owner` };
    const pid = Number.parseInt(line.trim().split(/\s+/).pop() ?? "", 10);
    if (!Number.isFinite(pid)) return { pid: null, description: `port ${port}: unparseable netstat row` };
    let name = "unknown process";
    try {
      const tasklist = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
      });
      name = tasklist.split(/\r?\n/)[0]?.split('","')[0]?.replace(/^"/, "") || name;
    } catch {
      // the PID alone is still actionable
    }
    return { pid, description: `port ${port} is held by PID ${pid} (${name})` };
  } catch (err) {
    return { pid: null, description: `port ${port}: netstat failed (${(err as Error).message})` };
  }
}

/** Tree-kill: a Python sidecar may have worker children, `node --import tsx`
 *  always does. */
/** The parent process id of `pid`, or null when it cannot be read. */
export function parentPid(pid: number): number | null {
  try {
    const out = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").ParentProcessId`],
      { encoding: "utf8", windowsHide: true, timeout: 10_000 },
    );
    const parent = Number(out.trim());
    return Number.isFinite(parent) && parent > 0 ? parent : null;
  } catch {
    return null;
  }
}

export function killTree(pid: number): void {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {
    // already gone
  }
}
