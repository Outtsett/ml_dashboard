#!/usr/bin/env node
/**
 * scripts/verify.mjs — single source of truth for "is the repo healthy".
 *
 * Callable by: the PostToolUse hook (.claude/hooks/problem_scan.py, --files),
 * the Stop hook (.claude/hooks/quality_gate.py, --changed), a human
 * (`npm run verify`, --changed), and CI (--full).
 *
 * This script only DETECTS problems — it never mutates files. Auto-fixing
 * (ruff --fix / eslint --fix) is a separate concern owned by the hook that
 * calls this script (see problem_scan.py), so that a "detect" run here is
 * always safe to call repeatedly, from any caller, with no side effects.
 *
 * Modes (exactly one):
 *   --files <a,b,c>   Check only the given files. Fast path (~<2s). Never
 *                      runs tsc (whole-program, can't check a single file)
 *                      or vitest (needs a changed-file set to relate tests).
 *   --changed         Check files changed vs `git diff HEAD` (+ untracked).
 *                      Runs eslint+ruff scoped to those files, tsc
 *                      whole-program (see "pre-existing tsc debt" below),
 *                      and `vitest related` for affected tests only.
 *   --full            Whole-repo check: eslint over src/, ruff over
 *                      src/ml/+scripts/, tsc whole-program, full vitest run.
 *
 * Flags:
 *   --json            Emit a single machine-readable JSON object to stdout.
 *                      Without --json, prints a human-readable report.
 *
 * Exit code: 0 when clean (no ERROR-severity problems), 1 otherwise.
 * Warnings (e.g. eslint "warn" rules) are reported but never fail the run —
 * only genuine errors (eslint error-severity, ruff violations, tsc errors,
 * vitest test failures) are blocking. This keeps the tool usable on a repo
 * that already carries some warning-level debt.
 *
 * Pre-existing tsc debt (--changed mode only): tsc cannot be scoped to a
 * file list (it's a whole-program check), so on a repo with known in-flight
 * type errors elsewhere, every `--changed` run would otherwise re-report
 * all of them regardless of what this session touched. To keep the Stop
 * hook usable, diagnostics whose file is NOT in the changed-file set are
 * counted in `preExistingCount` (informational, never blocking); only
 * diagnostics in files this session actually touched are treated as
 * problems. `--full` reports everything (no such split — there's no
 * "changed set" to scope against).
 *
 * Any check whose tool is missing (eslint/typescript/vitest not installed,
 * ruff not on PATH) is skipped with an explicit `skipReason` — never
 * silently dropped.
 */

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// Build/cache artifacts: safe to ignore at any depth, since a directory with
// one of these names is never a legitimate source directory anywhere in the repo.
const IGNORE_SEGMENTS_ANYWHERE = new Set([
  'node_modules', 'dist', 'build', '.venv', 'venv', '.cache', '.git',
  '.questdb', '__pycache__', '.pytest_cache', 'coverage',
]);

// Repo-root ML-artifact directories only. `data` and `optuna_studies` also
// name real source directories (src/server/data/, src/ml/data/,
// src/client/src/data/) -- matching them at any depth silently excluded that
// source from verify.mjs entirely. Root-relative gitignore-style globs, not
// bare names, so only the top-level artifact dir is excluded.
const IGNORE_GLOBS_ROOT = [/^data\//, /^optuna_studies\//];

// ── generic helpers ──────────────────────────────────────────────────────

function toRel(absOrPath) {
  const abs = path.isAbsolute(absOrPath) ? absOrPath : path.resolve(REPO_ROOT, absOrPath);
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

function isIgnoredRel(rel) {
  const segs = rel.split('/');
  if (segs.some((s) => IGNORE_SEGMENTS_ANYWHERE.has(s))) return true;
  return IGNORE_GLOBS_ROOT.some((re) => re.test(rel));
}

function run(cmd, args, { cwd = REPO_ROOT, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true });
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: String(err), timedOut: false, spawnError: true });
      return;
    }
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already dead */ }
      resolve({ code: null, stdout, stderr, timedOut: true, spawnError: false });
    }, timeoutMs);
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: String(err), timedOut: false, spawnError: true });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false, spawnError: false });
    });
  });
}

function nodeBin(pkg, relBinPath) {
  const p = path.join(REPO_ROOT, 'node_modules', pkg, relBinPath);
  return existsSync(p) ? p : null;
}

const ESLINT_BIN = nodeBin('eslint', 'bin/eslint.js');
const TSC_BIN = nodeBin('typescript', 'bin/tsc');
const VITEST_BIN = nodeBin('vitest', 'vitest.mjs');

function toolProblem(tool, message) {
  return { tool, file: '(tool)', line: 0, col: 0, rule: 'tool-error', message, severity: 'error' };
}

function newCheck(name) {
  return { name, ran: false, skipped: false, skipReason: null, ok: true, durationMs: 0, problems: [] };
}

// Windows caps the total CreateProcess command line at ~32K chars, and on a
// branch with a large in-flight diff (hundreds of renamed/changed files)
// `--changed` mode can legitimately pass that many file args to eslint /
// ruff / vitest at once -- spawn() fails with ENAMETOOLONG well before the
// nominal 32K limit (other argv/env overhead eats into it). Chunk any file
// list into safely-sized batches and run the tool once per batch instead of
// once with everything; a single-directory target (`['src']`, full mode)
// or a short list (the common `--files`/small `--changed` case) always
// collapses to exactly one chunk, so this changes nothing for the fast path.
const MAX_CHUNK_CHARS = 6000;

function chunkFiles(files, fixedOverheadChars = 500) {
  const chunks = [];
  let cur = [];
  let curLen = fixedOverheadChars;
  for (const f of files) {
    const len = f.length + 1;
    if (cur.length > 0 && curLen + len > MAX_CHUNK_CHARS) {
      chunks.push(cur);
      cur = [];
      curLen = fixedOverheadChars;
    }
    cur.push(f);
    curLen += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks.length ? chunks : [[]];
}

function extractJsonBlob(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

// vitest's JSON reporter writes to stdout by default, but stdout is not a
// safe channel for it: `vitest related` executes real application code
// (e.g. the codegen path that spawns `python scripts/generate_model.py` and
// logs the spawned command line via NestJS's logger), and any brace-bearing
// line printed by that code — logs, warnings, whatever — corrupts a
// first-brace-to-last-brace stdout scrape. Route the report to a file via
// `--outputFile` instead so interleaved process logging on stdout can never
// touch it. Each invocation gets its own uniquely-named file under
// node_modules/.cache/verify/ (chunked --changed mode runs multiple vitest
// invocations that must not clobber each other's report), and the file is
// always removed after being read — including on every error path — so
// repeated Stop-hook runs don't accumulate temp files.
const VITEST_REPORT_DIR = path.join(REPO_ROOT, 'node_modules', '.cache', 'verify');

function newVitestReportPath() {
  mkdirSync(VITEST_REPORT_DIR, { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;
  return path.join(VITEST_REPORT_DIR, `vitest-report-${unique}.json`);
}

// Reads the report file if present and always deletes it afterward (best
// effort — a failed cleanup is not itself a problem to surface). Returns
// null if the file was never written (e.g. vitest crashed before the
// reporter flushed, or genuinely found nothing to report).
function readAndCleanupVitestReport(reportPath) {
  let jsonText = null;
  try {
    if (existsSync(reportPath)) {
      jsonText = readFileSync(reportPath, 'utf8');
    }
  } catch {
    jsonText = null;
  }
  try {
    rmSync(reportPath, { force: true });
  } catch {
    // best-effort cleanup only — a stray temp file is not a detection failure
  }
  return jsonText;
}

// ── args ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { mode: null, files: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') {
      out.mode = 'files';
      out.files = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--changed') {
      out.mode = 'changed';
    } else if (a === '--full') {
      out.mode = 'full';
    } else if (a === '--json') {
      out.json = true;
    }
  }
  if (!out.mode) out.mode = 'changed';
  return out;
}

function resolveScopeFiles(rawFiles) {
  const abs = rawFiles.map((f) => (path.isAbsolute(f) ? f : path.resolve(REPO_ROOT, f)));
  return abs.filter((f) => {
    const rel = toRel(f);
    return existsSync(f) && !isIgnoredRel(rel);
  });
}

async function gatherChangedFiles() {
  const [diff, untracked] = await Promise.all([
    run('git', ['diff', '--name-only', 'HEAD'], { timeoutMs: 10000 }),
    run('git', ['ls-files', '--others', '--exclude-standard'], { timeoutMs: 10000 }),
  ]);
  if (diff.spawnError && untracked.spawnError) return []; // git unavailable — fail open, empty scope
  const names = new Set();
  for (const out of [diff.stdout, untracked.stdout]) {
    for (const line of out.split(/\r?\n/)) {
      const t = line.trim();
      if (t) names.add(t);
    }
  }
  return resolveScopeFiles([...names]);
}

// ── checks ───────────────────────────────────────────────────────────────

async function checkEslint(targets) {
  const check = newCheck('eslint');
  if (!ESLINT_BIN) {
    check.skipped = true;
    check.skipReason = 'eslint not installed (node_modules/eslint missing)';
    return check;
  }
  if (!targets.length) {
    check.skipped = true;
    check.skipReason = 'no .ts/.tsx files in scope';
    return check;
  }
  const cacheDir = path.join(REPO_ROOT, 'node_modules', '.cache', 'eslint');
  mkdirSync(cacheDir, { recursive: true });
  const cacheLocation = `${path.join('node_modules', '.cache', 'eslint')}${path.sep}`;
  const t0 = Date.now();
  check.ran = true;
  for (const chunk of chunkFiles(targets)) {
    const res = await run(
      process.execPath,
      [ESLINT_BIN, '--cache', '--cache-location', cacheLocation, '--format', 'json', ...chunk],
      { timeoutMs: 30000 },
    );
    if (res.timedOut) {
      check.ok = false;
      check.problems.push(toolProblem('eslint', 'timed out after 30s'));
      continue;
    }
    if (res.spawnError) {
      check.ok = false;
      check.problems.push(toolProblem('eslint', `failed to launch: ${res.stderr}`));
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(res.stdout || '[]');
    } catch {
      check.ok = false;
      check.problems.push(
        toolProblem('eslint', `failed to parse output (exit ${res.code}): ${(res.stderr || res.stdout).slice(0, 500)}`),
      );
      continue;
    }
    for (const fileResult of parsed) {
      const relFile = toRel(fileResult.filePath);
      for (const m of fileResult.messages || []) {
        check.problems.push({
          tool: 'eslint',
          file: relFile,
          line: m.line ?? 0,
          col: m.column ?? 0,
          rule: m.ruleId || '(parse-error)',
          message: m.message,
          severity: m.severity === 2 ? 'error' : 'warning',
        });
      }
    }
  }
  check.durationMs = Date.now() - t0;
  check.ok = !check.problems.some((p) => p.severity === 'error');
  return check;
}

async function checkRuff(targets) {
  const check = newCheck('ruff');
  if (!targets.length) {
    check.skipped = true;
    check.skipReason = 'no .py files in scope';
    return check;
  }
  const chunks = chunkFiles(targets);
  async function runRuffChunk(chunk) {
    let res = await run('ruff', ['check', '--output-format=json', ...chunk], { timeoutMs: 20000 });
    if (res.spawnError) {
      res = await run('python', ['-m', 'ruff', 'check', '--output-format=json', ...chunk], { timeoutMs: 20000 });
    }
    return res;
  }
  // Probe availability once (first chunk) so a genuinely-missing tool skips
  // cleanly instead of reporting N identical "not found" errors per chunk.
  const probe = await runRuffChunk(chunks[0]);
  if (probe.spawnError) {
    check.skipped = true;
    check.skipReason = 'ruff not found (tried `ruff` and `python -m ruff`)';
    return check;
  }
  const t0 = Date.now();
  check.ran = true;
  for (let i = 0; i < chunks.length; i++) {
    const res = i === 0 ? probe : await runRuffChunk(chunks[i]);
    if (res.timedOut) {
      check.ok = false;
      check.problems.push(toolProblem('ruff', 'timed out after 20s'));
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(res.stdout || '[]');
    } catch {
      check.ok = false;
      check.problems.push(
        toolProblem('ruff', `failed to parse output (exit ${res.code}): ${(res.stderr || res.stdout).slice(0, 500)}`),
      );
      continue;
    }
    for (const item of parsed) {
      check.problems.push({
        tool: 'ruff',
        file: toRel(item.filename),
        line: item.location?.row ?? 0,
        col: item.location?.column ?? 0,
        rule: item.code || '(unknown)',
        message: item.message,
        severity: 'error',
      });
    }
  }
  check.durationMs = Date.now() - t0;
  check.ok = check.problems.length === 0;
  return check;
}

const TSC_DIAG_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

async function checkTsc(mode, changedRelSet) {
  const check = newCheck('tsc');
  if (!TSC_BIN) {
    check.skipped = true;
    check.skipReason = 'typescript not installed (node_modules/typescript missing)';
    return check;
  }
  const t0 = Date.now();
  const res = await run(
    process.execPath,
    [TSC_BIN, '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'],
    { timeoutMs: 150000 },
  );
  check.durationMs = Date.now() - t0;
  check.ran = true;
  if (res.timedOut) {
    check.ok = false;
    check.problems.push(toolProblem('tsc', 'timed out after 150s'));
    return check;
  }
  const all = [];
  for (const raw of (res.stdout || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = TSC_DIAG_RE.exec(line);
    if (!m) continue;
    const [, file, lineNo, col, sev, code, msg] = m;
    all.push({
      tool: 'tsc',
      file: toRel(path.resolve(REPO_ROOT, file)),
      line: Number(lineNo),
      col: Number(col),
      rule: code,
      message: msg,
      severity: sev,
    });
  }
  if (mode === 'full' || !changedRelSet) {
    check.problems = all;
  } else {
    let preExisting = 0;
    for (const d of all) {
      if (changedRelSet.has(d.file)) check.problems.push(d);
      else preExisting++;
    }
    check.preExistingCount = preExisting;
  }
  check.ok = !check.problems.some((p) => p.severity === 'error');
  return check;
}

async function checkVitestRelated(targets) {
  const check = newCheck('vitest');
  if (!VITEST_BIN) {
    check.skipped = true;
    check.skipReason = 'vitest not installed (node_modules/vitest missing)';
    return check;
  }
  if (!targets.length) {
    check.skipped = true;
    check.skipReason = 'no changed files to relate tests to';
    return check;
  }
  const t0 = Date.now();
  check.ran = true;
  for (const chunk of chunkFiles(targets)) {
    const reportPath = newVitestReportPath();
    const res = await run(
      process.execPath,
      [VITEST_BIN, 'related', ...chunk, '--run', '--reporter=json', `--outputFile=${reportPath}`],
      { timeoutMs: 90000 },
    );
    applyVitestResult(check, res, reportPath);
  }
  check.durationMs = Date.now() - t0;
  check.ok = !check.problems.some((p) => p.severity === 'error');
  return check;
}

async function checkVitestFull() {
  const check = newCheck('vitest');
  if (!VITEST_BIN) {
    check.skipped = true;
    check.skipReason = 'vitest not installed (node_modules/vitest missing)';
    return check;
  }
  const t0 = Date.now();
  check.ran = true;
  const reportPath = newVitestReportPath();
  const res = await run(
    process.execPath,
    [VITEST_BIN, 'run', '--reporter=json', `--outputFile=${reportPath}`],
    { timeoutMs: 180000 },
  );
  applyVitestResult(check, res, reportPath);
  check.durationMs = Date.now() - t0;
  check.ok = !check.problems.some((p) => p.severity === 'error');
  return check;
}

// Mutates `check.problems` with whatever one vitest invocation's result
// contributes. Used both for a single --full run and per-chunk in
// --changed mode (so one bad chunk doesn't discard results from the rest).
// The report is read from `reportPath` (written via `--outputFile`), never
// scraped from stdout — see the comment above newVitestReportPath().
function applyVitestResult(check, res, reportPath) {
  if (res.timedOut) {
    check.problems.push(toolProblem('vitest', 'timed out'));
    readAndCleanupVitestReport(reportPath);
    return;
  }
  if (res.spawnError) {
    check.problems.push(toolProblem('vitest', `failed to launch: ${res.stderr}`));
    readAndCleanupVitestReport(reportPath);
    return;
  }
  const jsonText = readAndCleanupVitestReport(reportPath);
  if (!jsonText) {
    // No related/matching test files is a valid clean outcome (exit 0) —
    // vitest exits 0 and never writes a report file when there's nothing to
    // run. A non-zero exit with no report file written is a real failure
    // (e.g. a crash before the reporter could flush) and must be surfaced,
    // never silently swallowed.
    if (res.code !== 0) {
      check.problems.push(
        toolProblem('vitest', `exit ${res.code}, no report file written: ${(res.stderr || res.stdout).slice(0, 800)}`),
      );
    }
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    if (res.code !== 0) {
      check.problems.push(toolProblem('vitest', `unparseable report (exit ${res.code}): ${jsonText.slice(0, 800)}`));
    }
    return;
  }
  for (const tf of parsed.testResults || []) {
    const relFile = tf.name ? toRel(tf.name) : (tf.file || '(unknown test file)');
    for (const a of tf.assertionResults || []) {
      if (a.status === 'failed') {
        check.problems.push({
          tool: 'vitest',
          file: relFile,
          line: 0,
          col: 0,
          rule: a.fullName || a.title || 'test',
          message: (a.failureMessages || []).join('\n').slice(0, 2000),
          severity: 'error',
        });
      }
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));

  let scopeFiles = [];
  if (args.mode === 'files') {
    scopeFiles = resolveScopeFiles(args.files);
  } else if (args.mode === 'changed') {
    scopeFiles = await gatherChangedFiles();
  }
  const relScope = new Set(scopeFiles.map(toRel));

  const checks = [];

  // ESLint
  const tsTargets = args.mode === 'full'
    ? ['src']
    : scopeFiles.filter((f) => /\.(ts|tsx)$/.test(f)).map(toRel);
  checks.push(await checkEslint(tsTargets));

  // Ruff
  const pyTargets = args.mode === 'full'
    ? ['src/ml', 'scripts']
    : scopeFiles.filter((f) => f.endsWith('.py')).map(toRel);
  checks.push(await checkRuff(pyTargets));

  // tsc — whole-program; never in the per-file fast path.
  if (args.mode === 'full') {
    checks.push(await checkTsc('full', null));
  } else if (args.mode === 'changed') {
    if (relScope.size > 0) {
      checks.push(await checkTsc('changed', relScope));
    } else {
      const skipped = newCheck('tsc');
      skipped.skipped = true;
      skipped.skipReason = 'no changed files';
      checks.push(skipped);
    }
  }

  // Vitest — affected tests only in --changed; full suite in --full; never
  // in the per-file fast path (needs a changed-file set to relate against).
  if (args.mode === 'changed') {
    checks.push(await checkVitestRelated([...relScope]));
  } else if (args.mode === 'full') {
    checks.push(await checkVitestFull());
  }

  const errorCount = checks.reduce((n, c) => n + c.problems.filter((p) => p.severity === 'error').length, 0);
  const warningCount = checks.reduce((n, c) => n + c.problems.filter((p) => p.severity === 'warning').length, 0);
  const ok = errorCount === 0;
  const durationMs = Date.now() - startedAt;

  if (args.json) {
    process.stdout.write(JSON.stringify({
      mode: args.mode,
      ok,
      durationMs,
      checks,
      summary: { errorCount, warningCount },
    }));
  } else {
    printHuman(args.mode, checks, { ok, errorCount, warningCount, durationMs });
  }

  process.exit(ok ? 0 : 1);
}

function printHuman(mode, checks, summary) {
  console.log(`verify.mjs --${mode}  (${summary.durationMs}ms)`);
  for (const c of checks) {
    if (c.skipped) {
      console.log(`  [skip] ${c.name} — ${c.skipReason}`);
      continue;
    }
    const status = c.ok ? 'ok' : 'FAIL';
    const extra = c.preExistingCount ? `, ${c.preExistingCount} pre-existing (not in changed set)` : '';
    console.log(`  [${status}] ${c.name} — ${c.problems.length} problem(s)${extra} (${c.durationMs}ms)`);
    for (const p of c.problems) {
      console.log(`    ${p.file}:${p.line}:${p.col} ${p.rule} [${p.severity}] ${p.message}`);
    }
  }
  console.log(
    `Result: ${summary.ok ? 'CLEAN' : 'PROBLEMS FOUND'} — ${summary.errorCount} error(s), ${summary.warningCount} warning(s)`,
  );
}

main().catch((err) => {
  // verify.mjs itself reports truthfully on a crash (nonzero exit, real
  // error text) — it is each CALLER's job to fail open (problem_scan.py /
  // quality_gate.py wrap this invocation in their own try/except and treat
  // any hook-side error as "allow"). Silently exiting 0 here would make a
  // real verify.mjs bug invisible to `npm run verify` and CI as well.
  console.error(`verify.mjs internal error: ${err?.stack || err}`);
  process.exit(1);
});
