/**
 * Candlestick patterns as a CALCULATION, not a table.
 *
 * Owns one resident Python process running TA-Lib 0.8.1 and talks to it in JSON
 * lines. A pattern is computed from the bars the chart is holding, the moment it
 * is selected — the way MotiveWave, Quantower, NinjaTrader and TradingView do it.
 *
 * This replaces reading `talib_candle_patterns`, a materialized view that only
 * ever carried 1m/5m/15m across a three-month window. Every other timeframe fell
 * through to browser-side approximations, so a daily chart was marked by hand-
 * written rewrites rather than by TA-Lib. A calculation has no coverage gap:
 * whatever bars arrive get scored, on any timeframe, over all of history.
 *
 * Measured on 500 MNQ daily bars: all 61 patterns in 3.6ms, one pattern in 3.2ms.
 * The interpreter start (~1.4s, numpy + TA-Lib import) is paid once, lazily, on
 * the first request and then amortized across every later one — which is the
 * whole reason the process is resident rather than spawned per call.
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import readline from 'readline';

/** A bar as the lake hands it over. Only OHLC is scored; volume is not a TA-Lib input. */
export interface PatternBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PatternFiring {
  /** Unix SECONDS — what lightweight-charts wants and what the client snaps on. */
  time: number;
  /**
   * TA-Lib's own signed magnitude scaled by 100: ±1 for most patterns, ±0.8 for
   * engulfing/harami/haramicross, ±2 for hikkake/hikkakemod. Sign is direction.
   * Magnitude is the pattern's own statement about itself and passes through
   * rather than being flattened, and the chart already reads this [-2, 2] range.
   */
  value: number;
}

export interface CandlePatternMeta {
  /** Bare name, `talib_`/`CDL` prefix stripped: `morningstar`, `3whitesoldiers`. */
  name: string;
  /** The TA-Lib C function, e.g. `CDLMORNINGSTAR`. */
  function: string;
  /**
   * Leading bars TA-Lib refuses to score, because its thresholds are rolling
   * averages over a trailing window, not fixed ratios. Doji needs 10 prior bars;
   * three-black-crows needs 13. Carried to the client so a short chart can say
   * "not enough history" instead of drawing a silent gap.
   */
  lookback: number;
  /** Set only for the seven patterns whose C signature takes a penetration factor. */
  penetration: number | null;
}

/** How long a single compute may take before the worker is presumed wedged. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Every reply the worker can send, before it is narrowed to a specific op.
 *
 * `id` correlates it with the request that is waiting; the rest is whatever
 * that op returns, which each caller casts to its own shape.
 */
interface WorkerResponse {
  id?: string | number | null;
  ok?: boolean;
  error?: string;
  [field: string]: unknown;
}

interface Pending {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

let worker: ChildProcessWithoutNullStreams | null = null;
let nextId = 0;
const pending = new Map<string, Pending>();

/**
 * The project interpreter, not whatever `python` PATH resolves to.
 *
 * TA-Lib is installed in `.venv`; the anaconda base on PATH carries a different
 * version, and `python` alone has resolved to an interpreter without it before.
 * `PYTHON_BIN`/`ML_PYTHON` override, matching the convention the rest of the
 * server already uses.
 */
function pythonExecutable(): string {
  const override = process.env.PYTHON_BIN || process.env.ML_PYTHON;
  if (override) return override;
  return process.platform === 'win32'
    ? path.resolve(process.cwd(), '.venv', 'Scripts', 'python.exe')
    : path.resolve(process.cwd(), '.venv', 'bin', 'python3');
}

const WORKER_SCRIPT = path.resolve(process.cwd(), 'src', 'server', 'market', 'talib_pattern_worker.py');

/**
 * Fail every in-flight request and drop the handle.
 *
 * A wedged or dead worker must not leave callers awaiting forever — that is the
 * exact failure the label preview endpoint already exhibits elsewhere in this
 * server, and it presents to the user as a control that does nothing.
 */
function teardown(reason: string): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }
  pending.clear();
  worker = null;
}

function ensureWorker(): ChildProcessWithoutNullStreams {
  if (worker && !worker.killed) return worker;

  const child = spawn(pythonExecutable(), [WORKER_SCRIPT], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  });

  readline.createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    let message: WorkerResponse;
    try {
      message = JSON.parse(line) as WorkerResponse;
    } catch {
      return; // a non-JSON line is worker noise, not an answer to anything
    }
    const entry = pending.get(String(message.id));
    if (!entry) return;
    pending.delete(String(message.id));
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message);
    else entry.reject(new Error(message.error ?? 'TA-Lib worker reported a failure'));
  });

  // stderr is the Python traceback when an import or the interpreter itself
  // fails. Swallowing it turns "TA-Lib is not installed" into a silent timeout.
  let stderrTail = '';
  child.stderr.on('data', chunk => {
    stderrTail = (stderrTail + String(chunk)).slice(-2000);
    console.error('[talib-worker]', String(chunk).trimEnd());
  });

  child.on('exit', code => {
    teardown(
      `TA-Lib pattern worker exited (code ${code}). ` +
      (stderrTail ? `stderr: ${stderrTail.trim()}` : 'no stderr output.'),
    );
  });
  child.on('error', error => teardown(`TA-Lib pattern worker failed to start: ${error.message}`));

  worker = child;
  return child;
}

function send<T extends WorkerResponse>(request: Record<string, unknown>): Promise<T> {
  const child = ensureWorker();
  const id = String(++nextId);

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // Kill rather than leave it half-answering: a worker that missed one
      // deadline has a corrupt request/response alignment from here on.
      child.kill();
      teardown('TA-Lib pattern worker timed out');
      reject(new Error(`TA-Lib pattern compute timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve: resolve as (value: WorkerResponse) => void, reject, timer });
    child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
  });
}

let catalogCache: CandlePatternMeta[] | null = null;

/** All 61 TA-Lib candlestick patterns, read from the library itself. */
export async function candlePatternCatalog(): Promise<CandlePatternMeta[]> {
  if (catalogCache) return catalogCache;
  const response = await send<{ patterns: CandlePatternMeta[] }>({ op: 'catalog' });
  catalogCache = response.patterns;
  return catalogCache;
}

/**
 * Score `bars` with the named patterns, or all 61 when `names` is omitted.
 *
 * Returns only the bars where a pattern fired. TA-Lib emits 0 for "did not
 * fire", and across 61 patterns those zeros outnumber the firings by orders of
 * magnitude while drawing nothing.
 */
export async function computeCandlePatterns(
  bars: PatternBar[],
  names?: string[],
): Promise<Map<string, PatternFiring[]>> {
  const result = new Map<string, PatternFiring[]>();
  if (bars.length === 0) return result;

  const response = await send<{ series: Record<string, [number, number][]> }>({
    op: 'patterns',
    names: names && names.length > 0 ? names : null,
    open: bars.map(b => b.open),
    high: bars.map(b => b.high),
    low: bars.map(b => b.low),
    close: bars.map(b => b.close),
  });

  for (const [name, hits] of Object.entries(response.series ?? {})) {
    const points: PatternFiring[] = [];
    for (const [index, value] of hits) {
      // Index into the same array that was sent, so the timestamp is the bar's
      // own — never recomputed from a start time and a stride, which drifts
      // across session gaps and holidays. An index outside the array would mean
      // the worker answered a different request than the one sent, so it is
      // dropped rather than turned into a marker on an invented timestamp.
      const bar = bars[index];
      if (!bar) continue;
      points.push({ time: Math.floor(bar.timestamp / 1000), value: value / 100 });
    }
    result.set(name, points);
  }
  return result;
}

/** Stop the resident worker. Used on shutdown and by tests. */
export function shutdownCandlePatternWorker(): void {
  if (worker && !worker.killed) worker.kill();
  teardown('TA-Lib pattern worker shut down');
}
