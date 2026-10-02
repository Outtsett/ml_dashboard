/**
 * Run the canonical label suite ("label the data") in its own process.
 *
 * The dashboard can start the suite too (`POST /api/labels/suite`), but the dev
 * server restarts on every source change and takes a running suite with it. This
 * script runs the same `runLabelSuite` against the same SQLite ledger and the
 * same lake, from a process nothing restarts, and asks the dashboard to refresh
 * its derived-dataset views when it is done so `derived_labels` shows every
 * recipe without a server restart.
 *
 *   npx tsx --env-file=.env scripts/run_label_suite.ts [--symbol MNQ] [--timeframe 5] [--generator triple_barrier] [--force]
 *
 * Run from the repository root: `db.ts` resolves the SQLite path from `cwd`.
 */
import { runLabelSuite, LABEL_SUITE, type SuiteEntry } from '../apps/api/infrastructure/lib/labels/labelSuite';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const symbol = argument('symbol')?.toUpperCase();
const timeframe = argument('timeframe') ? Number(argument('timeframe')) : undefined;
const generator = argument('generator');
const force = process.argv.includes('--force');
const dashboard = process.env.LABEL_SUITE_DASHBOARD_URL || 'http://127.0.0.1:5000';

const only = (entry: SuiteEntry) =>
  (!symbol || entry.symbol === symbol) &&
  (!timeframe || entry.timeframeMinutes === timeframe) &&
  (!generator || entry.generatorType === generator);

const selected = LABEL_SUITE.filter(only);
console.log(`[suite] ${selected.length} of ${LABEL_SUITE.length} entries selected${force ? ' (force)' : ''}`);

const started = Date.now();
const state = await runLabelSuite({ force, only });

for (const { entry, result, milliseconds } of state.results) {
  const distribution = result.labelDistribution
    ? Object.entries(result.labelDistribution).map(([k, v]) => `${k}:${v}`).join(' ')
    : '';
  console.log(
    `[suite] ${String(result.labelSetId ?? '-').padStart(4)}  ${entry.name.padEnd(56)} ${String(result.stage ?? '?').padEnd(10)} ` +
      `${String(result.sampleCount ?? 0).padStart(9)} rows  ${(milliseconds / 1000).toFixed(1).padStart(7)}s  ${distribution}${result.error ? `  ERROR ${result.error}` : ''}`,
  );
}
console.log(`[suite] done in ${((Date.now() - started) / 1000).toFixed(0)}s`);

try {
  const response = await fetch(`${dashboard}/api/labels/catalog/refresh`, { method: 'POST' });
  console.log(`[suite] dashboard catalog refresh: ${response.status}`);
} catch (error) {
  console.log(`[suite] dashboard not reachable for a catalog refresh: ${(error as Error).message}`);
}
process.exit(0);
