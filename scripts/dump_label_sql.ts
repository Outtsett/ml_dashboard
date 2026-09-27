/**
 * Render the SQL of EVERY label generator, for the contract tests.
 *
 * `tests/test_label_contract.py` runs the real TypeScript generators through
 * this script and executes the SQL in DuckDB over real MNQ bars: parity
 * against the Python kernels for the four ML Studio strategies, a smoke run of
 * every registry entry (executes, carries the contract columns), and the
 * truncation test (labels recomputed on a shorter window agree for every row
 * that resolved inside it — the no-lookahead gate). A change on either side
 * that breaks any of those fails a test rather than a training run.
 *
 *   npx tsx scripts/dump_label_sql.ts <out.json> [timeframeMinutes]
 *
 * Output: { "<generator>": { "sql": "...", "params": {...} }, ... } for every
 * `LABEL_SQL_GENERATORS` key except the `talib_*` family (those are computed
 * by the TA-Lib worker, not by SQL, and `talib_candle_pattern` reads a table
 * the test database does not carry). The SQL is the fully wrapped form —
 * `sampled_ohlcv` CTE included — over a plain `ohlcv` table, which is what the
 * test materialises.
 */
import fs from 'fs';
import { generateLabelSQL } from '../src/server/infrastructure/lib/labels/labelGenerator';
import { LABEL_SQL_GENERATORS } from '../src/server/infrastructure/lib/labels/sqlLabelGenerators';
import { normalizeLabelParams } from '../src/server/infrastructure/lib/labels/labelRecipe';

const out = process.argv[2];
if (!out) {
  console.error('usage: npx tsx scripts/dump_label_sql.ts <out.json> [timeframeMinutes]');
  process.exit(2);
}
const timeframeMinutes = Number(process.argv[3] ?? 1440);

const cfg = {
  symbol: 'MNQ', tableName: 'ohlcv', timeframeMinutes,
  sourceFrom: 'ohlcv', sourcePredicate: "symbol = 'MNQ'",
};

/**
 * Parameter overrides that keep the parity cases what the Python kernels
 * compute (symmetric percent barriers, no minimum return) and keep the smoke
 * cases cheap on a few hundred daily bars.
 */
const OVERRIDES: Record<string, Record<string, unknown>> = {
  triple_barrier: {
    barrierUnits: 'percent', takeProfitPercent: 1.0, stopLossPercent: 1.0, holdingPeriodBars: 20,
    minimumReturnPercent: 0, sameBarTouchConvention: 'flag_ambiguous',
  },
  regime: { regimeLookbackBars: 60 },
  future_return: { normalize: true, normalizationWindowBars: 30 },
  trend_scanning: { minimumHorizonBars: 3, maximumHorizonBars: 12 },
};

const rendered: Record<string, { sql: string; params: Record<string, unknown> }> = {};
for (const generator of Object.keys(LABEL_SQL_GENERATORS)) {
  if (generator.startsWith('talib_')) continue;
  const params = normalizeLabelParams(generator, OVERRIDES[generator] ?? {});
  const sql = generateLabelSQL(generator as never, params, cfg);
  if (!sql) throw new Error(`generator ${generator} rendered nothing`);
  rendered[generator] = { sql, params };
}
fs.writeFileSync(out, JSON.stringify(rendered, null, 1));
console.log(`wrote ${Object.keys(rendered).length} generators to ${out}`);
