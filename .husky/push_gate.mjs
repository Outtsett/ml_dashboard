#!/usr/bin/env node
/**
 * The pre-push type gate: a push may not ADD type errors.
 *
 * What is checked
 *   The commit being pushed, in a clean checkout of exactly that commit, against the commit
 *   the remote branch holds now (for a branch the remote has never seen: the parent of the
 *   oldest commit the push sends). Each is type checked with the repository's own
 *   `tsc --noEmit`; an error is identified by its file, its TypeScript code and its message
 *   (line and column are dropped, so code moving inside a file is not a new error). The push
 *   is refused when some error occurs more often in the pushed commit than at the base.
 *
 * Why it is not `tsc --noEmit` on the working tree (what this replaced, 2026-10-08)
 *   Measured that day: the remote tip had 111 type errors, the commit to push 114, the working
 *   tree 156. A zero-tolerance check could not pass even for a push that changed nothing, and
 *   64 of the working tree's error lines came from other sessions' uncommitted files, which a
 *   push does not send. Every push therefore went out with `--no-verify`, so nothing was
 *   checked at all. Comparing the pushed commit with its base checks what the push carries and
 *   only that: errors already on the remote do not block, uncommitted work does not block, and
 *   a commit that imports a file nobody committed is caught ("Cannot find module").
 *
 * Why it lives in .husky
 *   Beside the hook that runs it, so a reorganisation of the source tree cannot move it away
 *   from the path the hook calls.
 *
 * Where the work happens
 *   <git dir>/push-gate/checkout   one detached worktree, reused, moved to the commit to check
 *   <git dir>/push-gate/errors     one file per checked commit (the base of a push is the
 *                                  commit the previous push checked, so a push runs tsc once)
 *   node_modules is linked into the checkout (a junction on Windows), never installed twice.
 *
 * Usage
 *   .husky/pre-push runs it with git's ref lines on standard input.
 *   node .husky/push_gate.mjs                     checks HEAD against its upstream
 *   node .husky/push_gate.mjs --head A --base B   checks commit A against commit B
 *   node .husky/push_gate.mjs --self-test         checks the comparison logic itself
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ZERO_HASH = /^0+$/;
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const GLOBAL_ERROR_LINE = /^error (TS\d+): (.*)$/;
const LOCK_STALE_MILLISECONDS = 15 * 60 * 1000;
const KEPT_RESULT_COUNT = 60;

/** Read tsc's output into one identity per error: "file: TScode: message". */
export function parseTypeErrors(output) {
  const errors = [];
  for (const raw of String(output).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const located = ERROR_LINE.exec(line);
    if (located) {
      const file = located[1].replace(/\\/g, "/");
      errors.push({ identity: `${file}: ${located[4]}: ${located[5]}`, shown: `${file}(${located[2]},${located[3]}): error ${located[4]}: ${located[5]}` });
      continue;
    }
    const unlocated = GLOBAL_ERROR_LINE.exec(line);
    if (unlocated) errors.push({ identity: `(no file): ${unlocated[1]}: ${unlocated[2]}`, shown: line });
  }
  return errors;
}

function countByIdentity(errors) {
  const counts = new Map();
  for (const error of errors) counts.set(error.identity, (counts.get(error.identity) ?? 0) + 1);
  return counts;
}

/**
 * The errors the pushed commit has beyond its base, and how many the push removed.
 * An identity that occurs 3 times at the base and 5 times in the pushed commit adds 2.
 */
export function compareTypeErrors(baseErrors, headErrors) {
  const baseCounts = countByIdentity(baseErrors);
  const headCounts = countByIdentity(headErrors);
  const added = [];
  const seen = new Map();
  for (const error of headErrors) {
    const position = (seen.get(error.identity) ?? 0) + 1;
    seen.set(error.identity, position);
    if (position > (baseCounts.get(error.identity) ?? 0)) added.push(error);
  }
  let removedCount = 0;
  for (const [identity, count] of baseCounts) removedCount += Math.max(0, count - (headCounts.get(identity) ?? 0));
  return { added, removedCount };
}

function git(arguments_, options = {}) {
  return execFileSync("git", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function gitOrNull(arguments_, options = {}) {
  try {
    return git(arguments_, options);
  } catch {
    return null;
  }
}

function fail(message) {
  process.stderr.write(`push gate: ${message}\n`);
  process.exit(1);
}

function locations() {
  const root = git(["rev-parse", "--show-toplevel"]);
  const common = path.resolve(root, git(["rev-parse", "--git-common-dir"], { cwd: root }));
  const state = path.join(common, "push-gate");
  return { root, state, checkout: path.join(state, "checkout"), results: path.join(state, "errors"), lock: path.join(state, "lock") };
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return () => fs.rmSync(lockPath, { force: true });
    } catch {
      const age = Date.now() - (fs.statSync(lockPath, { throwIfNoEntry: false })?.mtimeMs ?? 0);
      if (age < LOCK_STALE_MILLISECONDS) fail(`another push is being checked (${lockPath}, ${Math.round(age / 1000)} s old). Wait for it, or delete that file if no push is running.`);
      fs.rmSync(lockPath, { force: true });
    }
  }
  return fail(`could not take the lock ${lockPath}`);
}

/** Every node_modules directory the repository has at its root or one workspace down. */
function installedModuleDirectories(root) {
  const found = [];
  if (fs.existsSync(path.join(root, "node_modules"))) found.push("node_modules");
  for (const group of ["apps", "packages"]) {
    const groupPath = path.join(root, group);
    if (!fs.existsSync(groupPath)) continue;
    for (const entry of fs.readdirSync(groupPath, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(groupPath, entry.name, "node_modules"))) found.push(`${group}/${entry.name}/node_modules`);
    }
  }
  return found;
}

function prepareCheckout(place, commit) {
  fs.mkdirSync(place.state, { recursive: true });
  if (!fs.existsSync(path.join(place.checkout, ".git"))) {
    gitOrNull(["worktree", "prune"], { cwd: place.root });
    git(["worktree", "add", "--detach", "--force", place.checkout, commit], { cwd: place.root });
  } else {
    git(["checkout", "--detach", "--force", commit], { cwd: place.checkout });
  }
  if (git(["rev-parse", "HEAD"], { cwd: place.checkout }) !== commit) fail(`the checkout at ${place.checkout} is not at ${commit}`);
  for (const relative of installedModuleDirectories(place.root)) {
    const link = path.join(place.checkout, relative);
    if (fs.existsSync(link)) continue;
    if (!fs.existsSync(path.dirname(link))) continue; // the workspace does not exist in this commit
    fs.symlinkSync(path.join(place.root, relative), link, "junction");
  }
}

function typeErrorsOf(place, commit) {
  const resultPath = path.join(place.results, `${commit}.txt`);
  if (fs.existsSync(resultPath)) return { errors: parseTypeErrors(fs.readFileSync(resultPath, "utf8")), seconds: 0, cached: true };
  const compiler = path.join(place.root, "node_modules", "typescript", "bin", "tsc");
  if (!fs.existsSync(compiler)) fail(`TypeScript is not installed at ${compiler}; run npm install --legacy-peer-deps.`);
  prepareCheckout(place, commit);
  const started = Date.now();
  const run = spawnSync(process.execPath, [compiler, "--noEmit", "--incremental", "false", "--pretty", "false"], {
    cwd: place.checkout, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const errors = parseTypeErrors(output);
  // tsc exits 0 with no errors and 1 or 2 with errors; anything else, or a failure that printed
  // no error line, means the compiler did not run and the result must not be trusted or kept
  if (run.error || run.status === null || run.status > 2 || (run.status !== 0 && errors.length === 0)) {
    fail(`the type check of ${commit.slice(0, 7)} did not run (exit ${run.status}): ${run.error?.message ?? output.slice(0, 600)}`);
  }
  fs.mkdirSync(place.results, { recursive: true });
  fs.writeFileSync(resultPath, errors.map((error) => error.shown).join("\n"));
  const kept = fs.readdirSync(place.results).map((name) => ({ name, time: fs.statSync(path.join(place.results, name)).mtimeMs })).sort((a, b) => b.time - a.time);
  for (const old of kept.slice(KEPT_RESULT_COUNT)) fs.rmSync(path.join(place.results, old.name), { force: true });
  return { errors, seconds: (Date.now() - started) / 1000, cached: false };
}

/** The commit a push of `head` is compared with: what the remote holds, else the parent of the oldest commit it sends. */
function baseOf(root, head, remoteHash) {
  if (remoteHash && !ZERO_HASH.test(remoteHash) && gitOrNull(["cat-file", "-e", `${remoteHash}^{commit}`], { cwd: root }) !== null) return remoteHash;
  const unsent = gitOrNull(["rev-list", head, "--not", "--remotes"], { cwd: root });
  const oldest = unsent ? unsent.split("\n").filter(Boolean).pop() : null;
  if (!oldest) return null; // every commit is already on a remote: nothing new is being sent
  return gitOrNull(["rev-parse", `${oldest}^`], { cwd: root });
}

function pushesFromArguments(root, argv) {
  const value = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const head = git(["rev-parse", value("--head") ?? "HEAD"], { cwd: root });
  const named = value("--base");
  const upstream = named ?? gitOrNull(["rev-parse", "--abbrev-ref", "@{upstream}"], { cwd: root });
  const remoteHash = upstream ? gitOrNull(["rev-parse", upstream], { cwd: root }) : null;
  return [{ name: value("--head") ?? "HEAD", head, remoteHash }];
}

function pushesFromStandardInput(input) {
  const pushes = [];
  for (const line of input.split(/\r?\n/)) {
    const [localName, localHash, , remoteHash] = line.trim().split(/\s+/);
    if (!localHash || ZERO_HASH.test(localHash)) continue; // an empty line, or a branch being deleted
    if (localName.startsWith("refs/tags/")) continue;
    pushes.push({ name: localName.replace(/^refs\/heads\//, ""), head: localHash, remoteHash });
  }
  return pushes;
}

function selfTest() {
  const assert = (condition, message) => {
    if (!condition) fail(`self-test failed: ${message}`);
  };
  const base = parseTypeErrors(["a.ts(1,1): error TS1: x", "a.ts(9,1): error TS1: x", "b.ts(2,2): error TS2: y", "error TS5: z", "  continuation of a message"].join("\n"));
  assert(base.length === 4, "four errors are read, the continuation line is not one");
  const moved = parseTypeErrors(["a.ts(40,7): error TS1: x", "a.ts(41,7): error TS1: x", "b.ts(2,2): error TS2: y", "error TS5: z"].join("\n"));
  assert(compareTypeErrors(base, moved).added.length === 0, "errors that only moved are not new");
  const more = parseTypeErrors(["a.ts(1,1): error TS1: x", "a.ts(2,1): error TS1: x", "a.ts(3,1): error TS1: x", "c.ts(1,1): error TS2307: Cannot find module './d'"].join("\n"));
  const difference = compareTypeErrors(base, more);
  assert(difference.added.length === 2, "a third occurrence and a new file's error are both new");
  assert(difference.added[0].shown.startsWith("a.ts(3,1)") && difference.added[1].identity.startsWith("c.ts: TS2307"), "the new errors are the right ones");
  assert(difference.removedCount === 2, "two base errors are gone");
  assert(parseTypeErrors("apps\\web\\x.tsx(1,1): error TS1: q")[0].identity === "apps/web/x.tsx: TS1: q", "paths are compared with forward slashes");
  const kept = parseTypeErrors(base.map((error) => error.shown).join("\n"));
  assert(compareTypeErrors(base, kept).added.length === 0 && kept.length === base.length, "a kept result reads back as the same errors");
  process.stdout.write("push gate: self-test passed (7 checks)\n");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();
  const place = locations();
  const piped = !process.stdin.isTTY && !argv.includes("--head") && !argv.includes("--base");
  const input = piped ? fs.readFileSync(0, "utf8") : "";
  const pushes = input.trim() ? pushesFromStandardInput(input) : pushesFromArguments(place.root, argv);
  if (pushes.length === 0) return undefined;
  const release = acquireLock(place.lock);
  let refused = false;
  try {
    for (const push of pushes) {
      const base = baseOf(place.root, push.head, push.remoteHash);
      if (!base) {
        process.stdout.write(`push gate: ${push.name} sends no commit a remote does not already hold; nothing to check.\n`);
        continue;
      }
      if (base === push.head) {
        process.stdout.write(`push gate: ${push.name} is already at ${base.slice(0, 7)} on the remote; nothing to check.\n`);
        continue;
      }
      const baseResult = typeErrorsOf(place, base);
      const headResult = typeErrorsOf(place, push.head);
      const { added, removedCount } = compareTypeErrors(baseResult.errors, headResult.errors);
      const timing = (result) => (result.cached ? "checked earlier" : `${result.seconds.toFixed(0)} s`);
      process.stdout.write([
        `push gate: type check of what ${push.name} adds (clean checkout, uncommitted work is not part of it)`,
        `  pushed commit  ${push.head.slice(0, 7)}  ${headResult.errors.length} type errors  (${timing(headResult)})`,
        `  compared with  ${base.slice(0, 7)}  ${baseResult.errors.length} type errors  (${timing(baseResult)})`,
        `  added by this push: ${added.length}    removed by this push: ${removedCount}`,
        "",
      ].join("\n"));
      if (added.length > 0) {
        refused = true;
        process.stderr.write(`push gate: REFUSED. These ${added.length} type errors are in the pushed commit and not in ${base.slice(0, 7)}:\n`);
        for (const error of added) process.stderr.write(`  ${error.shown}\n`);
        process.stderr.write("  A \"Cannot find module\" here usually means a commit imports a file that was never committed: commit that file.\n");
      }
    }
  } finally {
    release();
  }
  if (refused) process.exit(1);
  return undefined;
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) main();
