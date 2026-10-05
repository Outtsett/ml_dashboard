/**
 * The canonical label suite — "label the data".
 *
 * Think of it as: the standing order. The instruments and bar sizes Tyler
 * trades (MNQ at 1, 5 and 15 minutes; ES and NQ at 5) get a fixed set of label
 * recipes over their whole history in the lake, so a model, a notebook or the
 * chart never waits on a generation. Every entry is idempotent through its
 * recipe: running the suite twice lands nothing twice.
 *
 * Sets run one at a time — each is a full-history scan through the serving
 * DuckDB and two of them side by side compete for the same engine.
 */
import { generateLabels, labelJobFor, type LabelGenerationResult } from './labelGenerator';
import { getLabelSetById } from './labelRepository';

export interface SuiteEntry {
  name: string;
  generatorType: string;
  symbol: string;
  timeframeMinutes: number;
  params: Record<string, unknown>;
}

const MNQ_TIMEFRAMES = [1, 5, 15];

function forSymbol(symbol: string, timeframes: number[]): SuiteEntry[] {
  const entries: SuiteEntry[] = [];
  for (const tf of timeframes) {
    const label = `${symbol} ${tf}m`;
    entries.push(
      { name: `${label} next close direction (1 bar)`, generatorType: 'next_close_direction', symbol, timeframeMinutes: tf, params: { horizonBars: 1 } },
      { name: `${label} direction (12 bars, 3 classes)`, generatorType: 'direction', symbol, timeframeMinutes: tf, params: { horizonBars: 12, thresholdPercent: 0.05, classCount: 3 } },
      {
        name: `${label} triple barrier (2 / 1.5 ATR, 24 bars)`, generatorType: 'triple_barrier', symbol, timeframeMinutes: tf,
        params: { barrierUnits: 'volatility', upperBarrierMultiple: 2.0, lowerBarrierMultiple: 1.5, volatilityMeasure: 'average_true_range', volatilityWindowBars: 20, holdingPeriodBars: 24, minimumReturnPercent: 0, sameBarTouchConvention: 'flag_ambiguous' },
      },
      { name: `${label} volatility-adaptive direction (12 bars, 1.5 σ)`, generatorType: 'volatility_adaptive', symbol, timeframeMinutes: tf, params: { horizonBars: 12, volatilityWindowBars: 20, volatilityMultiple: 1.5, classCount: 3 } },
      { name: `${label} trend scanning (5–60 bars, step 5)`, generatorType: 'trend_scanning', symbol, timeframeMinutes: tf, params: { minimumHorizonBars: 5, maximumHorizonBars: 60, horizonStepBars: 5, tStatisticThreshold: 2.0, correctForHorizonCount: true, useLogPrice: true } },
      { name: `${label} future return (12 bars, trailing z-score)`, generatorType: 'future_return', symbol, timeframeMinutes: tf, params: { horizonBars: 12, returnType: 'log', normalize: true, normalizationWindowBars: 250 } },
      { name: `${label} range bucket (16 bars, 21 × 2 points)`, generatorType: 'range_bucket', symbol, timeframeMinutes: tf, params: { horizonBars: 16, bucketCount: 21, bucketWidthPoints: 2 } },
      { name: `${label} structural (5-bar pivot)`, generatorType: 'structural', symbol, timeframeMinutes: tf, params: { pivotLookbackBars: 5 } },
      { name: `${label} regime (4 states)`, generatorType: 'regime', symbol, timeframeMinutes: tf, params: { volatilityWindowBars: 20, trendWindowBars: 50, regimeLookbackBars: 500, trendThresholdVolatilityMultiple: 1.0, regimeCount: 4 } },
      { name: `${label} meta-label (trailing momentum, 10 bars)`, generatorType: 'meta_label', symbol, timeframeMinutes: tf, params: { primarySource: 'trailing_momentum', primaryLookbackBars: 20, primaryThresholdBasisPoints: 10, horizonBars: 10, transactionCostBasisPoints: 5, minimumProfitBasisPoints: 10 } },
    );
  }
  return entries;
}

export const LABEL_SUITE: readonly SuiteEntry[] = [
  ...forSymbol('MNQ', MNQ_TIMEFRAMES),
  ...forSymbol('ES', [5]).filter((e) => ['next_close_direction', 'triple_barrier'].includes(e.generatorType)),
  ...forSymbol('NQ', [5]).filter((e) => ['next_close_direction', 'triple_barrier'].includes(e.generatorType)),
];

export interface SuiteRunState {
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  completed: number;
  current: string | null;
  results: Array<{ entry: SuiteEntry; result: LabelGenerationResult; milliseconds: number }>;
  running: boolean;
}

const state: SuiteRunState = {
  startedAt: null, finishedAt: null, total: LABEL_SUITE.length, completed: 0, current: null, results: [], running: false,
};

export function suiteState(): SuiteRunState {
  return state;
}

/** Run every entry in order; returns once the last has finished. Safe to call twice: recipes dedupe. */
export async function runLabelSuite(options: { force?: boolean; only?: (entry: SuiteEntry) => boolean } = {}): Promise<SuiteRunState> {
  if (state.running) return state;
  const entries = LABEL_SUITE.filter((e) => (options.only ? options.only(e) : true));
  state.running = true;
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.total = entries.length;
  state.completed = 0;
  state.results = [];
  try {
    for (const entry of entries) {
      state.current = entry.name;
      const started = Date.now();
      const result = await generateLabels(
        { name: entry.name, generatorType: entry.generatorType, symbol: entry.symbol, params: entry.params, timeframeMinutes: entry.timeframeMinutes, force: options.force },
        { wait: true },
      );
      // `existing` may point at a job still running from an earlier call.
      if (result.existing && result.labelSetId) {
        const job = labelJobFor(result.labelSetId);
        if (job) await job;
      }
      const finalRow = result.labelSetId ? await getLabelSetById(result.labelSetId) : null;
      state.results.push({
        entry,
        result: finalRow
          ? { ...result, stage: finalRow.stage, sampleCount: finalRow.sampleCount, parquetPath: finalRow.parquetPath ?? undefined, error: finalRow.errorMessage ?? result.error }
          : result,
        milliseconds: Date.now() - started,
      });
      state.completed += 1;
    }
  } finally {
    state.current = null;
    state.running = false;
    state.finishedAt = Date.now();
  }
  return state;
}
