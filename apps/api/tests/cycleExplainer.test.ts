/**
 * The "Inside the model" explainer pool (`apps/api/training/cycleExplainer.ts`)
 * against a real child process: `tests/fixtures/fake_cycle_explainer.py`
 * speaks the JSON-lines protocol of `@shared/cycle/explain` with canned
 * results, and is told by its arguments to delay, crash or misbehave. Every
 * request it receives is appended to a log file, which is how these tests
 * see what was (and was not) sent.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CycleExplainer,
  CycleExplainerError,
  defaultExplainerCommand,
  getCycleExplainer,
  parseExplainerCommand,
  stopCycleExplainer,
  type CycleExplainerOptions,
} from '../training/cycleExplainer';
import { cycleExplainStructureSchema } from '@shared/cycle/explain';

const REPO = process.cwd();
const PYTHON =
  process.platform === 'win32'
    ? path.join(REPO, '.venv', 'Scripts', 'python.exe')
    : path.join(REPO, '.venv', 'bin', 'python');
const FAKE = path.join(REPO, 'tests', 'fixtures', 'fake_cycle_explainer.py');

let workDirectory: string;
let logPath: string;
let runDirectory: string;
const pools: CycleExplainer[] = [];

function makeRun(name: string, folds: number[] = [0, 1]): string {
  const directory = path.join(workDirectory, name);
  for (const fold of folds) {
    fs.mkdirSync(path.join(directory, `fold_${fold}`, 'price_model'), { recursive: true });
    fs.writeFileSync(path.join(directory, `fold_${fold}`, 'model.json'), '{}');
    fs.writeFileSync(path.join(directory, `fold_${fold}`, 'price_model', 'model.json'), '{}');
  }
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function makePool(fakeArguments: string[] = [], options: CycleExplainerOptions = {}): CycleExplainer {
  const pool = new CycleExplainer({
    command: [PYTHON, FAKE, '--serve', '--log', logPath, ...fakeArguments],
    cwd: REPO,
    ...options,
  });
  pools.push(pool);
  return pool;
}

function loggedRequests(): Array<Record<string, unknown>> {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function failureOf(promise: Promise<unknown>): Promise<CycleExplainerError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(CycleExplainerError);
    return err as CycleExplainerError;
  }
  throw new Error('expected the request to fail');
}

const structure = (fold = 0) => ({ op: 'structure' as const, runDirectory, fold, role: 'direction' as const });
const explain = (timestamp: number, fold = 0) => ({ op: 'explain' as const, runDirectory, fold, role: 'direction' as const, timestamp });

beforeEach(() => {
  workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-explainer-'));
  logPath = path.join(workDirectory, 'requests.jsonl');
  runDirectory = makeRun('MNQ_5m_xgboost_run');
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.stop()));
  fs.rmSync(workDirectory, { recursive: true, force: true });
});

describe('spawning', () => {
  it('starts no process until the first request, then reuses one warm process', async () => {
    const pool = makePool();
    expect(pool.status()).toMatchObject({ running: false, spawnCount: 0 });

    const first = await pool.request(structure());
    expect(first.status).toBe('ok');
    if (first.status === 'ok') expect(cycleExplainStructureSchema.parse(first.result).foldIndex).toBe(0);
    expect(pool.status()).toMatchObject({ running: true, ready: true, spawnCount: 1 });

    await pool.request({ op: 'tree', runDirectory, fold: 0, role: 'direction', tree: 1 });
    expect(pool.status().spawnCount).toBe(1);
  });

  it('runs the process CPU-only with bounded threads, unbuffered, in the given directory', async () => {
    const pool = makePool();
    const result = (await pool.ping()) as { cwd: string; environment: Record<string, string | null> };
    expect(result.environment).toEqual({ CUDA_VISIBLE_DEVICES: '', OMP_NUM_THREADS: '4', PYTHONUNBUFFERED: '1' });
    expect(path.resolve(result.cwd)).toBe(path.resolve(REPO));
  });

  it('ignores non-JSON stdout before the ready line', async () => {
    const pool = makePool(['--noise']);
    expect((await pool.request(structure())).status).toBe('ok');
  });

  it('fails every waiting request when no ready line arrives in time, and kills the process', async () => {
    const pool = makePool(['--no-ready'], { readyTimeoutMs: 800 });
    const [first, second] = await Promise.all([failureOf(pool.request(structure())), failureOf(pool.request(structure(1)))]);
    expect(first.failure).toBe('ready_timeout');
    expect(second.failure).toBe('ready_timeout');
    await waitFor(() => !pool.status().running);
    expect(loggedRequests()).toEqual([]);
  });

  it('reports a command that cannot start as spawn_failed', async () => {
    const pool = new CycleExplainer({ command: [path.join(workDirectory, 'no_such_python.exe')], cwd: REPO });
    pools.push(pool);
    const failure = await failureOf(pool.request(structure()));
    expect(failure.failure).toBe('spawn_failed');
  });
});

describe('timeouts and superseding', () => {
  it('times a sent request out, kills the wedged process, and respawns for the next one', async () => {
    const pool = makePool(['--reply-delay', '5'], { requestTimeoutMs: 500 });
    const pending = pool.request(structure());
    await waitFor(() => pool.status().pid !== null && pool.status().inFlight);
    const pid = pool.status().pid!;

    const failure = await failureOf(pending);
    expect(failure.failure).toBe('timeout');
    expect(failure.message).toMatch(/did not answer structure within 0\.5 s/);
    await waitFor(() => !isAlive(pid));
    expect(pool.status().recentCrashes).toBe(0);

    const next = pool.request(structure());
    await waitFor(() => pool.status().spawnCount === 2);
    expect((await failureOf(next)).failure).toBe('timeout');
  });

  it('a newer explain for the same run, fold and role supersedes a queued one, which is never sent', async () => {
    const pool = makePool(['--reply-delay', '0.4']);
    const first = pool.request(explain(1000));
    await waitFor(() => pool.status().inFlight);
    const replaced = pool.request(explain(2000));
    await waitFor(() => pool.status().queued === 1);
    const otherFold = pool.request(explain(2000, 1));
    await waitFor(() => pool.status().queued === 2);
    const newest = pool.request(explain(3000));

    expect(await replaced).toEqual({ status: 'superseded' });
    expect((await first).status).toBe('ok');
    expect((await otherFold).status).toBe('ok');
    const last = await newest;
    expect(last.status).toBe('ok');
    if (last.status === 'ok') expect((last.result as { timestamp: number }).timestamp).toBe(3000);

    const sent = loggedRequests()
      .filter((request) => request.op === 'explain')
      .map((request) => [request.fold, request.timestamp]);
    expect(sent).toEqual([
      [0, 1000],
      [1, 2000],
      [0, 3000],
    ]);
  });

  it('never supersedes structure or tree requests', async () => {
    const pool = makePool(['--reply-delay', '0.2']);
    const outcomes = await Promise.all([pool.request(structure()), pool.request(structure()), pool.request(structure())]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['ok', 'ok', 'ok']);
  });
});

describe('crashes', () => {
  it('rejects pending requests on a crash and respawns on the next request', async () => {
    const pool = makePool(['--crash-once-file', path.join(workDirectory, 'crashed.flag')]);
    const failure = await failureOf(pool.request(structure()));
    expect(failure.failure).toBe('crashed');
    expect(failure.message).toMatch(/exit code 3/);
    expect(failure.stderrTail).toMatch(/crashing once on purpose/);
    expect(pool.status()).toMatchObject({ running: false, recentCrashes: 1 });

    expect((await pool.request(structure())).status).toBe('ok');
    expect(pool.status().spawnCount).toBe(2);
  });

  it('after 3 crashes inside the window, stops respawning and fails with the stderr tail', async () => {
    const pool = makePool(['--exit-at-start', '5'], { crashLimit: 3, crashWindowMs: 60_000 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await failureOf(pool.request(structure()))).failure).toBe('crashed');
    }
    const unavailable = await failureOf(pool.request(structure()));
    expect(unavailable.failure).toBe('unavailable');
    expect(unavailable.message).toMatch(/crashed 3 times/);
    expect(unavailable.stderrTail).toMatch(/failing on purpose at start/);
    expect(pool.status().spawnCount).toBe(3);
  });

  it('respawns again once the crashes fall out of the window', async () => {
    const pool = makePool(['--exit-at-start', '5'], { crashLimit: 2, crashWindowMs: 2_500 });
    await failureOf(pool.request(structure()));
    await failureOf(pool.request(structure()));
    expect((await failureOf(pool.request(structure()))).failure).toBe('unavailable');
    await new Promise((resolve) => setTimeout(resolve, 2_600));
    expect((await failureOf(pool.request(structure()))).failure).toBe('crashed');
    expect(pool.status().spawnCount).toBe(3);
  });
});

describe('idle exit, stop and releaseRun', () => {
  it('asks the process to exit after the idle time, without counting a crash', async () => {
    const pool = makePool([], { idleTimeoutMs: 300 });
    await pool.request(structure());
    const pid = pool.status().pid!;
    await waitFor(() => !pool.status().running);
    await waitFor(() => !isAlive(pid));
    expect(loggedRequests().map((request) => request.op)).toEqual(['structure', 'exit']);
    expect(pool.status().recentCrashes).toBe(0);

    await pool.request(structure(1));
    expect(pool.status().spawnCount).toBe(2);
  });

  it('a request arriving while the idle process winds down goes to a fresh process, not the closing one', async () => {
    const pool = makePool([], { idleTimeoutMs: 300, requestTimeoutMs: 5_000 });
    await pool.request(structure());
    // the idle exit has been written; the old process may still be alive for a moment
    await waitFor(() => loggedRequests().some((request) => request.op === 'exit'));
    const started = Date.now();
    await pool.request(structure(1));
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(pool.status().spawnCount).toBe(2);
    expect(pool.status().recentCrashes).toBe(0);
  });

  it('stop() rejects the request in flight and kills the process tree', async () => {
    const pool = makePool(['--reply-delay', '5']);
    const pending = pool.request(structure());
    await waitFor(() => pool.status().inFlight);
    const pid = pool.status().pid!;
    const failed = failureOf(pending);
    await pool.stop();
    expect((await failed).failure).toBe('stopped');
    await waitFor(() => !isAlive(pid));
    expect(pool.status()).toMatchObject({ running: false, recentCrashes: 0 });
  });

  it('releaseRun tells the process to drop the run and clears its cached replies', async () => {
    const pool = makePool();
    const other = makeRun('other_run', [0]);
    await pool.request(structure());
    await pool.request({ ...structure(), runDirectory: other });
    expect(pool.status().cachedReplies).toBe(2);

    await pool.releaseRun(runDirectory);
    const released = loggedRequests().filter((request) => request.op === 'releaseRun');
    expect(released).toEqual([expect.objectContaining({ runDirectory })]);
    expect(pool.status().cachedReplies).toBe(1);

    const again = await pool.request(structure());
    expect(again).toMatchObject({ status: 'ok', cached: false });
    expect(await pool.request({ ...structure(), runDirectory: other })).toMatchObject({ cached: true });
  });

  it('releaseRun with no process running only clears the cache', async () => {
    const pool = makePool();
    await pool.releaseRun(runDirectory);
    expect(pool.status().spawnCount).toBe(0);
  });
});

describe('reply cache and validation', () => {
  it('serves a repeated request from the cache until the model file changes', async () => {
    const pool = makePool();
    expect(await pool.request(explain(1000))).toMatchObject({ status: 'ok', cached: false });
    expect(await pool.request(explain(1000))).toMatchObject({ status: 'ok', cached: true });
    expect(loggedRequests().filter((request) => request.op === 'explain')).toHaveLength(1);

    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(runDirectory, 'fold_0', 'model.json'), later, later);
    expect(await pool.request(explain(1000))).toMatchObject({ status: 'ok', cached: false });
    expect(loggedRequests().filter((request) => request.op === 'explain')).toHaveLength(2);
  });

  it('keys price requests on the price model file', async () => {
    const pool = makePool();
    const price = { ...structure(), role: 'price' as const };
    await pool.request(price);
    expect(await pool.request(price)).toMatchObject({ cached: true });
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(runDirectory, 'fold_0', 'price_model', 'model.json'), later, later);
    expect(await pool.request(price)).toMatchObject({ cached: false });
  });

  it('does not cache a fold whose model file is not saved yet', async () => {
    const pool = makePool();
    expect(await pool.request(structure(5))).toMatchObject({ status: 'ok', cached: false });
    expect(await pool.request(structure(5))).toMatchObject({ status: 'ok', cached: false });
  });

  it('reports a result that fails its schema as invalid and never caches it', async () => {
    const pool = makePool(['--invalid']);
    const outcome = await pool.request(structure());
    expect(outcome.status).toBe('invalid');
    if (outcome.status === 'invalid') expect(outcome.error).toMatch(/link|foldIndex/);
    expect((await pool.request(structure())).status).toBe('invalid');
    expect(pool.status().cachedReplies).toBe(0);
  });

  it("passes the explainer's own refusal through as an error outcome", async () => {
    const pool = makePool(['--error-on', 'tree']);
    const outcome = await pool.request({ op: 'tree', runDirectory, fold: 0, role: 'direction', tree: 0 });
    expect(outcome).toEqual({ status: 'error', error: 'The fake explainer refuses tree.', details: 'asked to by --error-on' });
  });
});

describe('command and singleton', () => {
  it('parses CYCLE_EXPLAINER_COMMAND as a JSON array or a plain command line', () => {
    expect(parseExplainerCommand('["C:/Program Files/py.exe", "x.py", "--serve"]')).toEqual(['C:/Program Files/py.exe', 'x.py', '--serve']);
    expect(parseExplainerCommand('  py  x.py --serve ')).toEqual(['py', 'x.py', '--serve']);
    expect(() => parseExplainerCommand('[]')).toThrow();
  });

  it('defaults to the repo venv on explain_main.py --serve, and honours the environment override', () => {
    const saved = process.env.CYCLE_EXPLAINER_COMMAND;
    try {
      delete process.env.CYCLE_EXPLAINER_COMMAND;
      const command = defaultExplainerCommand('E:/repo');
      expect(command.slice(1)).toEqual([path.join('packages', 'ml-engine', 'src', 'cycle', 'explain_main.py'), '--serve']);
      expect(command[0]).toContain(path.join('E:/repo', '.venv'));
      process.env.CYCLE_EXPLAINER_COMMAND = 'python fake.py';
      expect(defaultExplainerCommand('E:/repo')).toEqual(['python', 'fake.py']);
    } finally {
      if (saved === undefined) delete process.env.CYCLE_EXPLAINER_COMMAND;
      else process.env.CYCLE_EXPLAINER_COMMAND = saved;
    }
  });

  it('getCycleExplainer returns one pool until stopCycleExplainer forgets it', async () => {
    const first = getCycleExplainer();
    expect(getCycleExplainer()).toBe(first);
    await stopCycleExplainer();
    expect(getCycleExplainer()).not.toBe(first);
    await stopCycleExplainer();
  });
});
