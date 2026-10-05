/**
 * Whether each notebook has changes git has not recorded — one
 * `git status --porcelain` per notebook root.
 *
 * Measured 2026-09-28: 40 ms per root, nine roots. The calls are asynchronous
 * and run for every root at once, refreshed at most every 15 seconds and awaited
 * by the list route before it answers — never on the request path of anything
 * else, where a synchronous git would stall every request the dashboard serves.
 * A root outside any repository, or a git that fails, gives `not_in_git` / no
 * marker rather than an error: this is a hint on a list, never a reason for the
 * list to fail.
 */

import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type GitState = "clean" | "modified" | "untracked" | "not_in_git";

const GIT_TIMEOUT_MS = 5_000;

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

function key(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** The porcelain v1 `-z` output as absolute path → two-letter status.
 *  Exported for the unit test; `-z` keeps paths unquoted and NUL-separated. */
export function parsePorcelain(output: string, repositoryTop: string): Map<string, string> {
  const states = new Map<string, string>();
  const records = output.split("\0");
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    states.set(key(path.join(repositoryTop, record.slice(3))), status);
    // A rename or copy carries its old path as the next record.
    if (status[0] === "R" || status[0] === "C") index++;
  }
  return states;
}

/** The git state of every file under `root`, keyed by normalised absolute path,
 *  or null when the root is not inside a repository. */
export async function readRootStatus(root: string): Promise<Map<string, string> | null> {
  const top = (await git(["rev-parse", "--show-toplevel"], root))?.trim();
  if (!top) return null;
  const output = await git(["status", "--porcelain=v1", "-z", "-uall", "--", "."], root);
  if (output === null) return null;
  return parsePorcelain(output, top);
}

const REFRESH_TTL_MS = 15_000;
/** Root path (normalised) -> its file states, or null when it is not in git. */
const statusByRoot = new Map<string, Map<string, string> | null>();
let refreshedAtMs = 0;
let refreshing: Promise<void> | null = null;

/** Re-reads every root's git status when the cache is older than 15 s. Concurrent
 *  callers share one refresh. */
export function refreshGitStatus(roots: string[], force = false): Promise<void> {
  if (!force && Date.now() - refreshedAtMs < REFRESH_TTL_MS && roots.every((root) => statusByRoot.has(key(root)))) {
    return Promise.resolve();
  }
  refreshing ??= Promise.all(
    roots.map(async (root) => {
      statusByRoot.set(key(root), await readRootStatus(root));
    }),
  ).then(() => {
    refreshedAtMs = Date.now();
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** A notebook's git state from the last refresh, by the deepest root that holds it. */
export function cachedGitState(filePath: string): GitState {
  const file = key(filePath);
  let best: { length: number; status: Map<string, string> | null } | null = null;
  for (const [root, status] of statusByRoot) {
    if ((file.startsWith(root + path.sep) || file.startsWith(root + "/")) && (!best || root.length > best.length)) {
      best = { length: root.length, status };
    }
  }
  if (!best) return "not_in_git";
  return gitStateOf(filePath, best.status);
}

export function gitStateOf(filePath: string, rootStatus: Map<string, string> | null): GitState {
  if (!rootStatus) return "not_in_git";
  const status = rootStatus.get(key(filePath));
  if (!status) return "clean";
  if (status === "??") return "untracked";
  if (status === "!!") return "clean"; // ignored: git will never record it, so nothing is pending
  return "modified";
}
