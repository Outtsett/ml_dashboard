/**
 * Regime-gated crossover: does the MNQ 5m EMA5 / SMA100 crossover's cost-adjusted
 * edge concentrate in 1m volatility regimes, and does sitting out the others
 * help? Replaced Trading/quant/analytics/notebooks/regime_gated_crossover.py.
 *
 * Reads the ten tables packages/ml-engine/src/studies/regime_gated_crossover/build.py landed
 * (derived_study_regime_gated_crossover_*, recipe notebook_mnq_20240301_20251201,
 * one run per regime count 2..8). The record (verdicts, gate, leak control) is
 * the notebook's exact run. The live part re-tags every 5m bar with the 1m
 * regime in DuckDB (ASOF JOIN, the notebook's merge_asof backward) at the
 * page's label offset, then reruns the notebook's dependent bootstrap in
 * TypeScript (packages/shared/src/studies/regime-gated-crossover.ts) with the page's
 * block floor, replicate count, minimum sample, gate and scoring scope.
 */

import { z } from "zod";
import { eightNumberSummary } from "@shared/lens/stats";
import {
  STUDY_DATASET, evaluateGate, mean, parseGateChoice, regimeVerdict,
  type BarSample, type CenterRow, type EquityPoint, type FeaturePoint, type FoldRow, type GateRecord,
  type HistogramBar, type LeakRecord, type LiveLeak, type LiveRegime, type RegimeGatedCrossoverBody,
  type RegimeRun, type TaggedBars, type TransitionRow, type VerdictRecord,
} from "@shared/studies/regime-gated-crossover";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler, StudyLake } from "../types";

export const RECIPE = "notebook_mnq_20240301_20251201";
const TABLES = ["runs", "folds", "transitions", "centers", "verdicts", "leak_control", "gate", "labels_1m", "net_returns_5m", "features_1m"] as const;
type Table = (typeof TABLES)[number];
export const VIEWS: Record<Table, string> = Object.fromEntries(TABLES.map((table) => [table, `derived_${STUDY_DATASET}_${table}`])) as Record<Table, string>;

const MAXIMUM_EQUITY_POINTS = 1200;
const BAR_SAMPLE_EVERY = 31;
const FEATURE_SAMPLE_MODULUS = 160;

const query = z.object({
  regimeCount: z.coerce.number().int().min(2).max(8).default(4),
  labelOffset: z.coerce.number().int().min(-30).max(120).default(0),
  leakOffset: z.coerce.number().int().min(-30).max(240).default(25),
  replicates: z.coerce.number().int().min(200).max(5000).default(2000),
  blockFloor: z.coerce.number().int().min(1).max(5000).default(390),
  minimumBars: z.coerce.number().int().min(100).max(20000).default(500),
  seed: z.coerce.number().int().min(0).max(100000).default(0),
  bins: z.coerce.number().int().min(10).max(120).default(40),
  gate: z.string().regex(/^(verdicts|none|[0-7](,[0-7]){0,7})$/).default("verdicts"),
  scope: z.enum(["same", "heldout"]).default("same"),
  splitFold: z.coerce.number().int().min(1).max(5).default(3),
});

type Query = z.infer<typeof query>;

function recipeFilter(alias = ""): string {
  return `${alias}${ident("recipe")} = ${text(RECIPE)}`;
}

/** A 1m label series shifted by `offset` rows: positive reads a later label (a peek), negative an earlier one. */
function shifted(offset: number): string {
  if (offset === 0) return "regime";
  const window = "OVER (ORDER BY timestamp)";
  return offset > 0 ? `LEAD(regime, ${num(offset)}) ${window}` : `LAG(regime, ${num(-offset)}) ${window}`;
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/** Every 5m net-return bar with the regime at the label offset and at the leak offset (null when none is known yet). */
async function taggedBars(lake: StudyLake, regimeCount: number, labelOffset: number, leakOffset: number) {
  const sql = `
    WITH base AS (
      SELECT timestamp, regime FROM ${ident(VIEWS.labels_1m)} WHERE ${recipeFilter()} AND regime_count = ${num(regimeCount)}
    ),
    labelled AS (SELECT timestamp, ${shifted(labelOffset)} AS regime FROM base),
    labelled_known AS (SELECT timestamp, regime FROM labelled WHERE regime IS NOT NULL),
    peeked AS (SELECT timestamp, ${shifted(leakOffset)} AS regime FROM base),
    peeked_known AS (SELECT timestamp, regime FROM peeked WHERE regime IS NOT NULL),
    net AS (
      SELECT timestamp, net_return, close, position_held, test_fold FROM ${ident(VIEWS.net_returns_5m)} WHERE ${recipeFilter()}
    )
    SELECT epoch_ms(n.timestamp) AS timestamp_milliseconds, n.net_return, n.close, n.position_held, n.test_fold,
           l.regime AS regime, p.regime AS shifted_regime
    FROM net n
    ASOF LEFT JOIN labelled_known l ON n.timestamp >= l.timestamp
    ASOF LEFT JOIN peeked_known p ON n.timestamp >= p.timestamp
    ORDER BY n.timestamp`;
  return lake.query<{
    timestamp_milliseconds: number; net_return: number; close: number; position_held: number; test_fold: number;
    regime: number | null; shifted_regime: number | null;
  }>(sql, 90_000);
}

/** Bins over a shared range (the pooled 0.5th to 99.5th percentile), so regime panels are comparable; edge bins hold the tails. */
export function sharedHistogram(values: Float64Array, lower: number, upper: number, binCount: number): HistogramBar[] {
  if (!(upper > lower)) return [{ lower, upper, count: values.length }];
  const width = (upper - lower) / binCount;
  const bins: HistogramBar[] = Array.from({ length: binCount }, (_, i) => ({ lower: lower + i * width, upper: lower + (i + 1) * width, count: 0 }));
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - lower) / width)));
    (bins[index] as HistogramBar).count += 1;
  }
  return bins;
}

function pooledRange(values: Float64Array): [number, number] {
  const sorted = Float64Array.from(values).sort();
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] as number;
  return sorted.length === 0 ? [0, 0] : [at(0.005), at(0.995)];
}

async function live(lake: StudyLake, parsed: Query, run: RegimeRun, folds: FoldRow[], notes: string[]): Promise<{ live: NonNullable<RegimeGatedCrossoverBody["live"]>; bars: BarSample[] }> {
  const rows = await taggedBars(lake, parsed.regimeCount, parsed.labelOffset, parsed.leakOffset);
  const known = rows.filter((row) => row.regime !== null && row.regime !== undefined);
  const bars: TaggedBars = {
    timestamp: Float64Array.from(known, (row) => number(row.timestamp_milliseconds)),
    netReturn: Float64Array.from(known, (row) => number(row.net_return)),
    testFold: Int32Array.from(known, (row) => number(row.test_fold)),
    regime: Int32Array.from(known, (row) => number(row.regime)),
  };

  const splitFold = folds.find((fold) => fold.fold === parsed.splitFold);
  const splitTimestamp = parsed.scope === "heldout" && splitFold ? splitFold.test_start_timestamp : null;
  if (parsed.scope === "heldout" && !splitFold) notes.push(`Fold ${parsed.splitFold} is not in the record; scoring on the same bars instead.`);
  const inVerdictScope = (timestamp: number) => splitTimestamp === null || timestamp < splitTimestamp;

  // Per regime: the values the verdict is decided on.
  const byRegime = new Map<number, number[]>();
  const verdictValues: number[] = [];
  for (let i = 0; i < bars.timestamp.length; i += 1) {
    if (!inVerdictScope(bars.timestamp[i] as number)) continue;
    const regime = bars.regime[i] as number;
    const list = byRegime.get(regime) ?? [];
    list.push(bars.netReturn[i] as number);
    byRegime.set(regime, list);
    verdictValues.push(bars.netReturn[i] as number);
  }
  const [lower, upper] = pooledRange(Float64Array.from(verdictValues));
  const options = { minimumBars: parsed.minimumBars, blockFloor: parsed.blockFloor, replicates: parsed.replicates, seed: parsed.seed };
  const regimes: LiveRegime[] = [];
  for (const regime of [...byRegime.keys()].sort((a, b) => a - b)) {
    const values = Float64Array.from(byRegime.get(regime) ?? []);
    let result: ReturnType<typeof regimeVerdict>;
    try {
      result = regimeVerdict(values, regime, options);
    } catch (error) {
      notes.push(`Regime ${regime}: no interval (${error instanceof Error ? error.message : String(error)}).`);
      result = { interval: null, verdict: "insufficient_sample" };
    }
    regimes.push({
      regime,
      barCount: values.length,
      meanNetReturn: mean(values),
      summary: eightNumberSummary(values),
      histogram: sharedHistogram(values, lower, upper, parsed.bins),
      interval: result.interval,
      verdict: result.verdict,
    });
  }

  // The negative control: the same join, labels shifted `leakOffset` rows.
  const leakGroups = new Map<number, { labelled: number[]; shifted: number[] }>();
  for (const row of rows) {
    const value = number(row.net_return);
    for (const [key, regime] of [["labelled", row.regime], ["shifted", row.shifted_regime]] as const) {
      if (regime === null || regime === undefined) continue;
      const entry = leakGroups.get(number(regime)) ?? { labelled: [], shifted: [] };
      entry[key].push(value);
      leakGroups.set(number(regime), entry);
    }
  }
  const leak: LiveLeak[] = [...leakGroups.entries()].sort((a, b) => a[0] - b[0]).map(([regime, entry]) => {
    const labelledMean = entry.labelled.length ? mean(entry.labelled) : null;
    const shiftedMean = entry.shifted.length ? mean(entry.shifted) : null;
    return {
      regime, labelledMean, labelledCount: entry.labelled.length, shiftedMean, shiftedCount: entry.shifted.length,
      absoluteDifference: labelledMean !== null && shiftedMean !== null ? Math.abs(labelledMean - shiftedMean) : null,
    };
  });

  // The gate: the verdicts' trade set, or the page's own choice.
  const chosen = parseGateChoice(parsed.gate, parsed.regimeCount);
  const tradeRegimes = chosen ?? regimes.filter((regime) => regime.verdict === "trade").map((regime) => regime.regime);
  let gate: NonNullable<RegimeGatedCrossoverBody["live"]>["gate"] = null;
  try {
    gate = evaluateGate(bars, tradeRegimes, splitTimestamp ?? Number.NEGATIVE_INFINITY, {
      ...options, barsPerYear: run.annualisation_bars_per_year, source: chosen ? "chosen" : "verdicts",
    });
  } catch (error) {
    notes.push(`The gate's interval could not be computed: ${error instanceof Error ? error.message : String(error)}.`);
  }

  // Cumulative net return, ungated and gated, over the bars the gate is scored on.
  const trade = new Set(tradeRegimes);
  const equity: EquityPoint[] = [];
  const scored: number[] = [];
  for (let i = 0; i < bars.timestamp.length; i += 1) if (splitTimestamp === null || (bars.timestamp[i] as number) >= splitTimestamp) scored.push(i);
  const step = Math.max(1, Math.ceil(scored.length / MAXIMUM_EQUITY_POINTS));
  let baselineTotal = 0;
  let gatedTotal = 0;
  scored.forEach((index, position) => {
    const value = bars.netReturn[index] as number;
    baselineTotal += value;
    if (trade.has(bars.regime[index] as number)) gatedTotal += value;
    if (position % step === 0 || position === scored.length - 1) {
      equity.push({ timestamp: bars.timestamp[index] as number, baseline: baselineTotal, gated: gatedTotal });
    }
  });

  const sample: BarSample[] = [];
  known.forEach((row, index) => {
    if (index % BAR_SAMPLE_EVERY !== 0) return;
    sample.push({
      timestamp: number(row.timestamp_milliseconds), close: number(row.close), position_held: number(row.position_held),
      net_return: number(row.net_return), regime: number(row.regime), test_fold: number(row.test_fold),
    });
  });

  return {
    live: {
      settings: {
        labelOffset: parsed.labelOffset, leakOffset: parsed.leakOffset, replicates: parsed.replicates, blockFloor: parsed.blockFloor,
        minimumBars: parsed.minimumBars, seed: parsed.seed, bins: parsed.bins, scope: parsed.scope, splitFold: parsed.splitFold,
        splitTimestamp, verdictBarCount: verdictValues.length, untaggedBarCount: rows.length - known.length,
      },
      regimes, leak, gate, equity,
    },
    bars: sample,
  };
}

function emptyBody(regimeCount: number): RegimeGatedCrossoverBody {
  return {
    regimeCounts: [], regimeCount, run: null, folds: [], transitions: [], centers: [],
    record: { verdicts: [], gate: null, leak: [] }, live: null, features: [], bars: [],
  };
}

const handler: StudyHandler<typeof query, RegimeGatedCrossoverBody> = {
  slug: "regime-gated-crossover",
  datasets: TABLES.map((table) => VIEWS[table]),
  query,
  cacheSeconds: 900,
  timeoutMs: 180_000,
  async run(parsed, context) {
    const { lake, notes } = context;
    if ((await missingViews(context, TABLES.map((table) => VIEWS[table]))).length > 0) return emptyBody(parsed.regimeCount);
    const where = `${recipeFilter()} AND regime_count = ${num(parsed.regimeCount)}`;

    const counts = await lake.query<{ regime_count: number }>(`SELECT regime_count FROM ${ident(VIEWS.runs)} WHERE ${recipeFilter()} ORDER BY regime_count`);
    const regimeCounts = counts.map((row) => number(row.regime_count));
    const [run] = await lake.query<RegimeRun>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.runs)} WHERE ${where}`);
    if (!run) {
      notes.push(`No landed run for ${parsed.regimeCount} regimes; landed: ${regimeCounts.join(", ") || "none"}.`);
      return { ...emptyBody(parsed.regimeCount), regimeCounts };
    }
    const folds = await lake.query<FoldRow>(
      `SELECT * EXCLUDE (recipe, train_end_timestamp, test_start_timestamp, test_end_timestamp),
              epoch_ms(train_end_timestamp) AS train_end_timestamp,
              epoch_ms(test_start_timestamp) AS test_start_timestamp,
              epoch_ms(test_end_timestamp) AS test_end_timestamp
       FROM ${ident(VIEWS.folds)} WHERE ${where} ORDER BY fold`,
    );
    const transitions = await lake.query<TransitionRow>(
      `SELECT fold, from_regime, to_regime, transition_count, probability FROM ${ident(VIEWS.transitions)} WHERE ${where} ORDER BY fold, from_regime, to_regime`,
    );
    const centers = await lake.query<CenterRow>(
      `SELECT fold, regime, size_center, flow_center, training_rows, training_share FROM ${ident(VIEWS.centers)} WHERE ${where} ORDER BY fold, regime`,
    );
    const verdicts = await lake.query<VerdictRecord>(`SELECT * EXCLUDE (recipe, regime_count) FROM ${ident(VIEWS.verdicts)} WHERE ${where} ORDER BY regime`);
    const [gate] = await lake.query<GateRecord>(`SELECT * EXCLUDE (recipe, regime_count) FROM ${ident(VIEWS.gate)} WHERE ${where}`);
    const leak = await lake.query<LeakRecord>(`SELECT * EXCLUDE (recipe, regime_count) FROM ${ident(VIEWS.leak_control)} WHERE ${where} ORDER BY regime`);
    const features = await lake.query<FeaturePoint>(
      `SELECT epoch_ms(f.timestamp) AS timestamp, l.regime, f.size, f.flow, f.log_range, f.log_volume, f.next_log_range
       FROM ${ident(VIEWS.features_1m)} f
       JOIN ${ident(VIEWS.labels_1m)} l ON l.timestamp = f.timestamp AND l.regime_count = ${num(parsed.regimeCount)} AND ${recipeFilter("l.")}
       WHERE ${recipeFilter("f.")} AND hash(f.timestamp) % ${num(FEATURE_SAMPLE_MODULUS)} = 0
       ORDER BY f.timestamp`,
    );
    if (!run.stickiness_check_passes) notes.push(`With ${parsed.regimeCount} regimes the notebook's stickiness check fails: mean transition diagonal ${run.mean_transition_diagonal.toFixed(3)} is not above 1.3 × chance.`);
    if (!run.resolved_regime_check_passes) notes.push(`With ${parsed.regimeCount} regimes fewer than two regimes had enough bars for an interval.`);

    const computed = await live(lake, parsed, run, folds, notes);
    return {
      regimeCounts,
      regimeCount: parsed.regimeCount,
      run,
      folds,
      transitions,
      centers,
      record: { verdicts, gate: gate ?? null, leak },
      live: computed.live,
      features,
      bars: computed.bars,
    };
  },
};

export default handler;
