#!/usr/bin/env node
/**
 * Run the CI pipeline locally.
 *
 * This exists because GitHub Actions on this repository has produced nothing but
 * `startup_failure` since 2026-08-25 — every run completes in 0-2 seconds having
 * created zero jobs, including GitHub's own Dependabot runs. That is an
 * account/billing-level condition, not a YAML defect (all eleven workflows parse
 * and all are registered `active`), so no amount of workflow authoring makes the
 * remote gates run. Until that is cleared, THIS is the gate.
 *
 * It mirrors `.github/workflows/ci.yml` stage for stage, so a green run here is
 * a genuine prediction about a green run there rather than a different suite
 * wearing the same name. When they drift, that is a bug in one of the two.
 *
 *   node scripts/ci-local.mjs                  # everything
 *   node scripts/ci-local.mjs --fast           # skip build, smoke and e2e
 *   node scripts/ci-local.mjs --only test,e2e  # just these stages
 *   node scripts/ci-local.mjs --skip test-py   # everything but this
 *   node scripts/ci-local.mjs --list           # show the stages and exit
 *   node scripts/ci-local.mjs --bail           # stop at the first failure
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

/* ── stage definitions ───────────────────────────────────────────────────── */

/**
 * `ciJob` names the job in .github/workflows/ci.yml this stage corresponds to,
 * so drift between the two is visible by reading one column.
 */
const STAGES = [
  {
    id: 'lint-ts',
    ciJob: 'static',
    title: 'ESLint (errors + warning ratchet)',
    command: ['node', ['scripts/lint-budget.mjs']],
    why: 'Errors always fail; warnings fail only above the committed ceiling in .github/lint-baseline.json.',
  },
  {
    id: 'typecheck',
    ciJob: 'static',
    title: 'tsc --noEmit (application)',
    command: ['npx', ['tsc', '--noEmit']],
  },
  {
    id: 'typecheck-e2e',
    ciJob: 'static',
    title: 'tsc --noEmit (end-to-end suite)',
    command: ['npx', ['tsc', '--noEmit', '-p', 'tsconfig.e2e.json']],
    why: 'The root tsconfig excludes e2e/, so without this the specs are typechecked by nothing.',
  },
  {
    id: 'architecture',
    ciJob: 'static',
    title: 'Architecture boundaries',
    command: ['npx', ['tsx', 'src/scripts/architecture_validator.ts']],
  },
  {
    id: 'lint-py',
    ciJob: 'lint-py',
    title: 'Ruff check',
    command: ['python', ['-m', 'ruff', 'check', 'src/ml/', 'scripts/', 'mcp_server/', 'tests/']],
  },
  {
    id: 'format-py',
    ciJob: 'lint-py',
    title: 'Ruff format --check',
    command: ['python', ['-m', 'ruff', 'format', '--check', 'src/ml/', 'scripts/']],
    why: 'CI pins ruff 0.15.7 to match pyproject (>=0.14,<1). A different local ruff will disagree here.',
  },
  {
    id: 'test',
    ciJob: 'test',
    title: 'Vitest (all assertions)',
    command: ['npx', ['vitest', 'run', '--reporter=dot']],
  },
  {
    id: 'coverage',
    ciJob: 'test',
    title: 'Vitest coverage thresholds',
    command: [
      'npx',
      [
        'vitest',
        'run',
        '--coverage',
        '--exclude',
        'tests/client/**',
        '--exclude',
        '**/performance.test.ts',
        '--reporter=dot',
      ],
    ],
    why: 'performance.test.ts is excluded because v8 instrumentation puts its 1500ms budget at ~4100ms.',
  },
  {
    id: 'test-py',
    ciJob: 'test-py',
    title: 'Pytest (not slow)',
    command: [pythonBin(), ['-m', 'pytest', '-m', 'not slow', '-q', '--maxfail=10']],
    // NOT identical to CI, and the difference is deliberate: ci.yml runs
    // `uv sync --frozen` then `uv run --with pytest-xdist pytest -n auto`, which
    // resolves a clean locked environment. This runs the repo .venv directly, so
    // it tests the interpreter you actually develop against and takes seconds
    // rather than minutes. A lockfile drift will therefore show up in CI and not
    // here — run `uv sync --frozen --all-extras` locally if you need that check.
    // `shell: false`. pythonBin() is an absolute path so no shell is needed, and
    // routing through cmd.exe splits the `-m "not slow"` marker expression on
    // the space — pytest then reads `slow` as a path and reports
    // "file or directory not found: slow" while running zero tests. A stage that
    // runs nothing and exits non-zero looks like a failing suite.
    shell: false,
  },
  {
    id: 'schema',
    ciJob: 'smoke / e2e',
    title: 'SQLite schema (db:push + table count)',
    command: ['node', ['scripts/db-push-verify.mjs', '--db', 'data/.ci-local-schema-check.db']],
    why: 'Mirrors the schema step the smoke and e2e CI jobs run before starting the server. It exists because the CI failure it guards was invisible locally: data/ml_dashboard.db already exists on a developer machine.',
  },
  {
    id: 'build',
    ciJob: 'build',
    title: 'Build (vite client + esbuild server)',
    command: ['npm', ['run', 'build']],
    slow: true,
  },
  {
    id: 'smoke',
    ciJob: 'smoke',
    title: 'Deployment smoke (artifact boots and serves)',
    command: ['node', ['scripts/smoke.mjs', '--no-build']],
    needs: ['build'],
    why: 'Build proves files exist. This proves they boot, bind, serve the shell and answer the API.',
  },
  {
    id: 'e2e',
    ciJob: 'e2e',
    title: 'Playwright end-to-end',
    command: ['npx', ['playwright', 'test']],
    needs: ['build'],
    slow: true,
    why: 'Runs the FULL suite locally including @lake specs; CI excludes those, having no lake.',
  },
];

function pythonBin() {
  // Prefer the repo venv — it is what pyproject's lock describes, and a bare
  // `python` on PATH here resolves to conda base, which has a different ruff.
  const venv = IS_WIN
    ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'bin', 'python');
  return venv;
}

/* ── argument parsing ────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const listValue = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(',').map((s) => s.trim()) : [];
};

const FAST_SKIP = new Set(['build', 'smoke', 'e2e']);
const only = new Set(listValue('--only'));
const skip = new Set([...listValue('--skip'), ...(has('--fast') ? FAST_SKIP : [])]);
const BAIL = has('--bail');

if (has('--list')) {
  console.log('Stages (id — ci.yml job — title):\n');
  for (const s of STAGES) {
    console.log(`  ${s.id.padEnd(14)} ${s.ciJob.padEnd(9)} ${s.title}${s.slow ? '  [slow]' : ''}`);
  }
  process.exit(0);
}

const selected = STAGES.filter((s) => (only.size ? only.has(s.id) : true) && !skip.has(s.id));

if (selected.length === 0) {
  console.error('No stages selected. Try --list.');
  process.exit(2);
}

/* ── execution ───────────────────────────────────────────────────────────── */

function runStage(stage) {
  return new Promise((resolve) => {
    const [cmd, cmdArgs] = stage.command;
    const started = Date.now();
    let output = '';

    const child = spawn(cmd, cmdArgs, {
      cwd: ROOT,
      // `npm`/`npx`/`python` on PATH need a shell on Windows; a stage invoking an
      // absolute executable opts out, because the shell re-splits its arguments.
      shell: stage.shell ?? IS_WIN,
      env: { ...process.env, HUSKY: '0', FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const capture = (c) => {
      output += c.toString();
      if (output.length > 200_000) output = output.slice(-200_000);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    child.on('error', (err) =>
      resolve({ stage, ok: false, ms: Date.now() - started, output: `${output}\n${err.message}` }),
    );
    child.on('exit', (code) =>
      resolve({ stage, ok: code === 0, ms: Date.now() - started, output, code }),
    );
  });
}

function fmt(ms) {
  return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  console.log('ML Dashboard — local CI');
  console.log(`  mirroring .github/workflows/ci.yml`);
  console.log(`  ${selected.length} stage(s): ${selected.map((s) => s.id).join(', ')}\n`);

  const results = [];
  const failedIds = new Set();

  for (const stage of selected) {
    // A stage whose prerequisite failed cannot produce a meaningful verdict;
    // reporting it as "failed" would double-count one root cause.
    //
    // A prerequisite that was never SELECTED is different and was previously
    // missed: `--only e2e` ran the e2e stage against whatever stale dist/
    // happened to be on disk and reported a verdict about the wrong bytes. It is
    // now announced rather than silently assumed current.
    const selectedIds = new Set(selected.map((x) => x.id));
    const notSelected = (stage.needs ?? []).filter((n) => !selectedIds.has(n));
    if (notSelected.length > 0) {
      console.log(
        `NOTE  ${stage.title} depends on [${notSelected.join(', ')}], which ${
          notSelected.length === 1 ? 'was' : 'were'
        } not selected — running against whatever is already on disk.`,
      );
    }

    const blockedBy = (stage.needs ?? []).filter((n) => failedIds.has(n));
    if (blockedBy.length > 0) {
      console.log(`SKIP  ${stage.title} — ${blockedBy.join(', ')} failed`);
      results.push({ stage, skipped: true, blockedBy });
      continue;
    }

    process.stdout.write(`RUN   ${stage.title}${stage.slow ? ' (slow)' : ''} ... `);
    const result = await runStage(stage);
    results.push(result);

    if (result.ok) {
      console.log(`ok ${fmt(result.ms)}`);
    } else {
      failedIds.add(stage.id);
      console.log(`FAILED ${fmt(result.ms)} (exit ${result.code ?? '?'})`);
      if (stage.why) console.log(`      note: ${stage.why}`);
      console.log('      ── last 40 lines ──');
      console.log(
        result.output
          .split('\n')
          .slice(-40)
          .map((l) => `      ${l}`)
          .join('\n'),
      );
      if (BAIL) break;
    }
  }

  /* ── summary ───────────────────────────────────────────────────────────── */

  const failed = results.filter((r) => !r.skipped && !r.ok);
  const passed = results.filter((r) => !r.skipped && r.ok);
  const skipped = results.filter((r) => r.skipped);

  console.log('\n─────────────────────────────────────────────────────────────');
  console.log(' stage          ci.yml job  result   time');
  console.log('─────────────────────────────────────────────────────────────');
  for (const r of results) {
    const verdict = r.skipped ? 'skipped' : r.ok ? 'pass' : 'FAIL';
    const time = r.skipped ? '—' : fmt(r.ms);
    console.log(
      ` ${r.stage.id.padEnd(14)} ${r.stage.ciJob.padEnd(11)} ${verdict.padEnd(8)} ${time}`,
    );
  }
  console.log('─────────────────────────────────────────────────────────────');

  const total = results.reduce((sum, r) => sum + (r.ms ?? 0), 0);
  console.log(
    `\n${passed.length} passed, ${failed.length} failed` +
      (skipped.length ? `, ${skipped.length} skipped` : '') +
      ` in ${fmt(total)}`,
  );

  if (failed.length > 0) {
    console.log(`\nFailing stages: ${failed.map((f) => f.stage.id).join(', ')}`);
  }

  // Wait for stdout to drain before exiting. On Windows a piped stdout is
  // asynchronous, so `process.exit` immediately after the summary truncated it —
  // `npm run ci | tee` and CI log capture both lost the results table.
  await new Promise((resolve) => {
    if (process.stdout.write('')) resolve();
    else process.stdout.once('drain', resolve);
  });

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
