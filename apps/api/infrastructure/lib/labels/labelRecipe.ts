/**
 * A label set's identity: normalised parameters, a content hash, a recipe name.
 *
 * Think of it as: the part number stamped on a crate. Two requests that would
 * produce the same rows get the same recipe, so the second one finds the first
 * instead of landing a duplicate. The hash covers everything that changes the
 * rows — generator, symbol, timeframe, every parameter (with defaults filled in
 * and legacy names translated), the window, and the contract version — and
 * nothing that does not (the display name, who asked).
 */
import crypto from 'node:crypto';
import { LABEL_CONTRACT_VERSION, timeframeLabelOf, type LabelRecipeInput } from '@shared/labels/contract';
import { LABEL_GENERATORS } from '@shared/mlTaxonomy';

// ─── Parameter names ────────────────────────────────────────────────────────

/**
 * Old parameter name → current name, per generator. Requests, saved configs and
 * the ML Studio state written before the naming rule still arrive with the old
 * names; they mean the same thing and are translated here, at the boundary, so
 * the generators only ever see one vocabulary.
 */
export const LEGACY_PARAM_ALIASES: Record<string, Record<string, string>> = {
  direction: { horizon: 'horizonBars', threshold: 'thresholdPercent', numClasses: 'classCount' },
  next_close_direction: { horizon: 'horizonBars' },
  signal: { entryThreshold: 'entryThresholdPercent', exitThreshold: 'exitThresholdPercent', holdPeriod: 'holdPeriodBars' },
  regime: { volatilityWindow: 'volatilityWindowBars', trendWindow: 'trendWindowBars', numRegimes: 'regimeCount' },
  future_return: { horizon: 'horizonBars' },
  future_volatility: { horizon: 'horizonBars' },
  multi_step: { steps: 'horizons' },
  triple_barrier: {
    takeProfitPct: 'takeProfitPercent',
    stopLossPct: 'stopLossPercent',
    maxHoldingPeriod: 'holdingPeriodBars',
    minReturn: 'minimumReturnPercent',
    volatilityWindow: 'volatilityWindowBars',
  },
  npmm: {
    lookbackPeriod: 'lookbackBars',
    lookforwardPeriod: 'lookforwardBars',
    minMovePct: 'minimumMovePercent',
  },
  volatility_adaptive: {
    horizon: 'horizonBars',
    volatilityWindow: 'volatilityWindowBars',
    threshold: 'volatilityMultiple',
    numClasses: 'classCount',
  },
  trend_scanning: {
    minHorizon: 'minimumHorizonBars',
    maxHorizon: 'maximumHorizonBars',
    tThreshold: 'tStatisticThreshold',
  },
  meta_label: {
    primaryLookback: 'primaryLookbackBars',
    primaryThresholdBps: 'primaryThresholdBasisPoints',
    horizon: 'horizonBars',
    transactionCostBps: 'transactionCostBasisPoints',
    minProfitBps: 'minimumProfitBasisPoints',
  },
  range_bucket: { horizon: 'horizonBars', nBuckets: 'bucketCount', bucketWidthPts: 'bucketWidthPoints' },
  structural: { pivotLookback: 'pivotLookbackBars' },
  pseudo_confidence: { horizon: 'horizonBars' },
  consistency_perturbation: { consistencyWindow: 'consistencyWindowBars' },
  contrastive_temporal: {
    windowSize: 'windowBars',
    positiveRadius: 'positiveRadiusBars',
    negativeMinGap: 'negativeMinimumGapBars',
  },
  contrastive_augmentation: { windowSize: 'windowBars' },
  contrastive_statistical: { windowSize: 'windowBars', numRollingWindows: 'rollingWindowCount' },
};

/**
 * Translate legacy names and fill every declared default, so the recipe hash sees
 * a complete, single-vocabulary parameter set. Unknown keys are kept: the
 * generators ignore what they do not read, and dropping them would hide a
 * caller's mistake.
 *
 * The triple barrier's retired `volatilityAdjust` flag is dropped: it scaled the
 * percent barriers by the ratio of the bar's volatility to the WHOLE SAMPLE's
 * mean volatility (a lookahead), and a request that still sends it now means
 * plain percent barriers, which the `barrierUnits` parameter says explicitly.
 */
export function normalizeLabelParams(generatorType: string, params: Record<string, unknown> | undefined): Record<string, unknown> {
  const aliases = LEGACY_PARAM_ALIASES[generatorType] ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue;
    out[aliases[key] ?? key] = value;
  }
  if (generatorType === 'triple_barrier') {
    const legacyPercentRequest =
      'volatilityAdjust' in out || 'takeProfitPct' in (params ?? {}) || 'stopLossPct' in (params ?? {});
    delete out.volatilityAdjust;
    if (legacyPercentRequest && out.barrierUnits === undefined) out.barrierUnits = 'percent';
  }
  const declared = (LABEL_GENERATORS as Record<string, { params?: ReadonlyArray<{ id: string; default?: unknown }> }>)[generatorType];
  for (const param of declared?.params ?? []) {
    if (out[param.id] === undefined && param.default !== undefined) out[param.id] = param.default;
  }
  return out;
}

// ─── Hash and name ──────────────────────────────────────────────────────────

/** JSON with sorted keys at every level, so the same object always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const SAFE_SEGMENT = /^[A-Za-z0-9_]+$/;

export interface LabelRecipe {
  recipe: string;
  parametersHash: string;
  timeframeLabel: string;
}

/**
 * `<generator>_<SYMBOL>_<timeframe>_<hash12>`, e.g. `triple_barrier_MNQ_5m_3f9a1c2b7d0e`.
 *
 * The hash is a SHA-256 over the canonical JSON of the whole identity; twelve
 * hex characters (48 bits) keep the name readable and cannot collide across the
 * few thousand recipes this lake will ever hold.
 */
export function labelRecipe(input: LabelRecipeInput): LabelRecipe {
  if (!SAFE_SEGMENT.test(input.generatorType)) {
    throw new Error(`Generator id '${input.generatorType}' is not a safe recipe segment`);
  }
  const symbol = input.symbol.toUpperCase();
  if (!SAFE_SEGMENT.test(symbol)) throw new Error(`Symbol '${input.symbol}' is not a safe recipe segment`);
  const identity = {
    contractVersion: LABEL_CONTRACT_VERSION,
    generatorType: input.generatorType,
    symbol,
    timeframeMinutes: input.timeframeMinutes,
    params: input.params,
    windowStartTimestamp: input.windowStartTimestamp,
    windowEndTimestamp: input.windowEndTimestamp,
  };
  const parametersHash = crypto.createHash('sha256').update(canonicalJson(identity)).digest('hex');
  const timeframeLabel = timeframeLabelOf(input.timeframeMinutes);
  return {
    recipe: `${input.generatorType}_${symbol}_${timeframeLabel}_${parametersHash.slice(0, 12)}`,
    parametersHash,
    timeframeLabel,
  };
}
