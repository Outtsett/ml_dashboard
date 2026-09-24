/**
 * Render the SQL each ML Studio label strategy generates, for the parity test.
 *
 * `tests/test_label_contract.py` runs the real TypeScript generators through
 * this script and executes the SQL in DuckDB beside the Python kernels on the
 * same bars, so a change to either side that makes the preview and the trained
 * label disagree fails a test rather than a training run.
 *
 *   npx tsx scripts/dump_label_sql.ts <out.json>
 */
import fs from 'fs';
import { generateLabelSQL } from '../src/server/infrastructure/lib/labels/labelGenerator';

const out = process.argv[2];
if (!out) {
  console.error('usage: npx tsx scripts/dump_label_sql.ts <out.json>');
  process.exit(2);
}

// A plain `ohlcv` table of daily bars, symbol MNQ — what the test materialises.
const cfg = {
  symbol: 'MNQ', tableName: 'ohlcv', timeframeMinutes: 1440,
  sourceFrom: 'ohlcv', sourcePredicate: "symbol = 'MNQ'",
};
const cases: Record<string, [string, Record<string, unknown>]> = {
  next_close_direction: ['next_close_direction', { horizon: 1 }],
  range_bucket: ['range_bucket', { horizon: 16, nBuckets: 21, bucketWidthPts: 2 }],
  structural: ['structural', { pivotLookback: 5 }],
  triple_barrier: ['triple_barrier', {
    takeProfitPct: 1.0, stopLossPct: 1.0, maxHoldingPeriod: 20, minReturn: 0,
    volatilityAdjust: false, volatilityWindow: 20,
  }],
};

const rendered: Record<string, string> = {};
for (const [name, [generator, params]] of Object.entries(cases)) {
  rendered[name] = generateLabelSQL(generator as never, params, cfg)!;
}
fs.writeFileSync(out, JSON.stringify(rendered, null, 1));
console.log(`wrote ${Object.keys(rendered).length} generators to ${out}`);
