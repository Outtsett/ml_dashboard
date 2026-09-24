/**
 * Label Preview — generates label previews without persisting to database.
 *
 * Used by the chart overlay to show labels on the trading chart.
 * Queries QuestDB directly with CTE-based label generation.
 *
 * Caching: Preview results are cached for 15 minutes (max 50 entries).
 * Same symbol + generatorType + params + timeframe = same result.
 */

import type { LabelGeneratorType } from './sqlLabelGenerators';
import { wrapWithSampleBy } from './sqlLabelGenerators';
import type { MetaLabelParams } from './sqlLabelGenerators';
import { queryLabels, buildMetaLabelSQL } from './labelHelpers';
import { resolveLabelSource } from './labelSource';
import { generateLabelSQL } from './labelGenerator';
import { previewCacheKey, previewCacheGet, previewCacheSet } from '../../cache/labels';
import { labelOutcomeOffset, OUTCOME_OFFSET_COLUMN } from './labelOutcomeOffset';
import { computeTalibLabelRows, isTalibGenerator, talibPatternForGenerator } from './talibLabelRows';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LabelPreviewRequest {
  generatorType: LabelGeneratorType;
  symbol: string;
  params: Record<string, unknown>;
  limit?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  timeframeMinutes?: number;
}

// ─── Preview ────────────────────────────────────────────────────────────────

export interface LabelPreviewResponse {
  success: boolean;
  preview?: Array<Record<string, unknown>>;
  count?: number;
  /** Full-range distribution of label values (key = string-coerced label, value = count). */
  distribution?: Record<string, number>;
  /** Total samples behind `distribution` (may exceed `count`, which is capped at `limit`). */
  totalLabeledSamples?: number;
  /** min(counts) / max(counts). 1.0 = perfectly balanced; near 0 = rare-event imbalance. */
  classBalanceRatio?: number;
  error?: string;
  generatorType?: string;
}

export async function previewLabels(
  request: LabelPreviewRequest
): Promise<LabelPreviewResponse> {
  try {
    const isContrastive = ['contrastive_temporal', 'contrastive_augmentation', 'contrastive_statistical'].includes(request.generatorType);
    if (isContrastive) {
      return {
        success: true,
        preview: [],
        count: 0,
        generatorType: request.generatorType,
        error: 'Contrastive generators produce sample pairs, not per-bar labels. Use the full generation flow to create contrastive pairs.',
      };
    }

    // Check preview cache
    const cKey = previewCacheKey(request);
    const cached = previewCacheGet<LabelPreviewResponse>(cKey);
    if (cached) return cached;

    const timeframeMinutes = request.timeframeMinutes || 1;
    const limit = request.limit || 500;

    // TA-Lib patterns are a calculation, not a query: the C library runs over
    // the bars in the window and the rows come back already shaped like a
    // generator's. No SQL, no table, any timeframe.
    if (isTalibGenerator(request.generatorType)) {
      const rows = await computeTalibLabelRows({
        symbol: request.symbol,
        timeframeMinutes,
        pattern: talibPatternForGenerator(request.generatorType, request.params ?? {}),
        startTimestamp: request.startTimestamp,
        endTimestamp: request.endTimestamp,
        limit: Math.max(limit, 500),
      });
      const result = summarize(request, rows.slice(-limit).map(r => ({ ...r, outcomeOffset: 0 })), rows);
      previewCacheSet(cKey, result, request.symbol);
      return result;
    }

    // Resolve the best source for THIS instrument rather than assuming `ohlcv`
    // + `symbol = '<X>'`. For a futures root that swaps in the front-month
    // stitch, which is what the chart draws and what the old symbol filter
    // missed by three months.
    const source = await resolveLabelSource(request.symbol, timeframeMinutes, {
      startMs: request.startTimestamp,
      endMs: request.endTimestamp,
    });
    const tableName = source.tableName;

    let labelSQL: string | null;

    // For meta_label, build combined SQL with direction labels as CTE
    if (request.generatorType === 'meta_label') {
      const rawSQL = buildMetaLabelSQL(
        request.params as unknown as MetaLabelParams,
        request.symbol,
        tableName,
      );
      labelSQL = wrapWithSampleBy(rawSQL, {
        symbol: request.symbol, tableName, timeframeMinutes,
        sourceFrom: source.from, sourcePredicate: source.predicate,
      });
    } else {
      labelSQL = generateLabelSQL(
        request.generatorType,
        request.params,
        {
          symbol: request.symbol, tableName, timeframeMinutes,
          sourceFrom: source.from, sourcePredicate: source.predicate,
        }
      );
    }

    if (!labelSQL) {
      return { success: false, error: `Unknown generator type: ${request.generatorType}` };
    }

    // Inject [startTimestamp, endTimestamp] (ms epoch) INTO every
    // `WHERE symbol = '...'` clause inside labelSQL. SQL semantics block
    // predicate pushdown across window functions (LEAD/LAG/MAX OVER), so
    // outer-query filtering would force the CTE to compute labels over the
    // entire 96.7M-row base ohlcv table, then filter — orders of magnitude
    // slower than partition skipping. Regex replacement is OK here because
    // all 13 generators use the canonical `WHERE ${symbolColumn} = '...'`
    // pattern from helpers.ts.
    const dateFilters: string[] = [];
    if (typeof request.startTimestamp === 'number' && Number.isFinite(request.startTimestamp)) {
      dateFilters.push(`timestamp >= '${new Date(request.startTimestamp).toISOString()}'`);
    }
    if (typeof request.endTimestamp === 'number' && Number.isFinite(request.endTimestamp)) {
      dateFilters.push(`timestamp <= '${new Date(request.endTimestamp).toISOString()}'`);
    }
    if (dateFilters.length > 0) {
      const filterClause = dateFilters.join(' AND ');
      // Accepts an optional table alias (`WHERE o.symbol = ...`): meta_label
      // qualifies its columns because two relations expose `symbol`, and the
      // unaliased form silently left that scan unbounded by date.
      labelSQL = labelSQL.replace(
        /(WHERE\s+(?:\w+\.)?symbol\s*=\s*'[^']*')/gi,
        `$1 AND ${filterClause}`,
      );
    }

    const limitedSQL = `
      WITH label_data AS (${labelSQL})
      SELECT * FROM label_data
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;

    // Run preview-rows query and full-range distribution aggregate in parallel.
    // The aggregate runs over the same CTE so it includes ALL labeled rows in
    // the date range (not just the limit-capped tail), giving honest class-
    // balance numbers for the stratification check.
    const distSQL = `
      WITH label_data AS (${labelSQL})
      SELECT CAST(label AS VARCHAR) AS label_key, count(*) AS cnt
      FROM label_data
      GROUP BY label_key
    `;

    const [results, distRows] = await Promise.all([
      queryLabels(limitedSQL),
      queryLabels(distSQL).catch(() => [] as Array<Record<string, unknown>>),
    ]);

    const sortedResults = (results || []).sort(
      (a, b) => Number(a.timestamp) - Number(b.timestamp)
    );

    const normalizedResults = attachOutcomeOffset(
      request.generatorType,
      request.params ?? {},
      normalizeLabelsForPreview(request.generatorType, sortedResults),
    );

    const distribution: Record<string, number> = {};
    let totalLabeledSamples = 0;
    for (const row of distRows) {
      const key = String(row.label_key ?? row.label ?? 'null');
      const cnt = Number(row.cnt) || 0;
      distribution[key] = (distribution[key] || 0) + cnt;
      totalLabeledSamples += cnt;
    }

    const result = buildResponse(request.generatorType, normalizedResults, distribution, totalLabeledSamples);

    // Cache successful preview results
    previewCacheSet(cKey, result, request.symbol);

    return result;

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ─── Response shaping ───────────────────────────────────────────────────────

function buildResponse(
  generatorType: string,
  preview: Array<Record<string, unknown>>,
  distribution: Record<string, number>,
  totalLabeledSamples: number,
): LabelPreviewResponse {
  const counts = Object.values(distribution);
  const classBalanceRatio = counts.length === 0
    ? 0
    : counts.length === 1
      ? 1
      : Math.min(...counts) / Math.max(...counts);
  return {
    success: true,
    preview,
    count: preview.length,
    distribution,
    totalLabeledSamples,
    classBalanceRatio,
    generatorType,
  };
}

/** Distribution over EVERY computed row, preview over the capped tail. */
function summarize(
  request: LabelPreviewRequest,
  preview: Array<Record<string, unknown>>,
  allRows: Array<Record<string, unknown>>,
): LabelPreviewResponse {
  const distribution: Record<string, number> = {};
  for (const row of allRows) {
    if (row.label === null || row.label === undefined) continue;
    const key = String(row.label);
    distribution[key] = (distribution[key] ?? 0) + 1;
  }
  return buildResponse(request.generatorType, preview, distribution, allRows.length);
}

// ─── Outcome offset ─────────────────────────────────────────────────────────

/**
 * Stamp each row with how many bars forward its outcome lands, so the chart
 * can draw the marker on the bar the label is about rather than on the bar it
 * was computed from.
 *
 * A per-row `outcome_offset` from the generator wins — `triple_barrier` and
 * `trend_scanning` both pick their horizon per row and emit it. Otherwise the
 * offset comes from the generator's horizon parameter. Rows keep whatever the
 * generator emitted; this only adds a normalised `outcomeOffset` field.
 */
function attachOutcomeOffset(
  generatorType: string,
  params: Record<string, unknown>,
  results: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (!results || results.length === 0) return results;
  const fixed = labelOutcomeOffset(generatorType, params);

  return results.map(row => {
    const perRow = Number(row[OUTCOME_OFFSET_COLUMN]);
    if (Number.isFinite(perRow) && perRow >= 0) {
      return { ...row, outcomeOffset: perRow };
    }
    return { ...row, outcomeOffset: fixed ?? 0 };
  });
}

// ─── Label Normalization ────────────────────────────────────────────────────

/**
 * Discretise continuous generator output so it can be drawn as markers.
 *
 * This is NOT a squash to ±1. It used to be, and that assumption is what broke
 * the overlay: classification generators emit their own class ids (`structural`
 * -2..2, `range_bucket` 0..20, `regime` 0..3) and folding them onto three
 * values threw the class away before the chart ever saw it. The renderer reads
 * the vocabulary off the values now — see `labelMarkerStyle.ts` — so a
 * classification label passes through untouched and stays consistent with
 * `distribution`, which is aggregated over the raw label in SQL.
 *
 * Only genuinely continuous output is bucketed here, because a float return
 * has no marker to map onto:
 *
 *   future_return      sign      -> -1 / 0 / 1
 *   future_volatility  terciles  -> -1 / 0 / 1
 *
 * Both keep the untouched value in `rawLabel`.
 */
function normalizeLabelsForPreview(
  generatorType: string,
  results: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  if (!results || results.length === 0) return results;

  const regressionGenerators = ['future_return', 'future_volatility'];
  const multiClassGenerators = ['regime'];

  if (regressionGenerators.includes(generatorType)) {
    if (generatorType === 'future_volatility') {
      const values = results
        .map(r => Number(r.label))
        .filter(v => !isNaN(v) && v !== null);
      if (values.length === 0) return results;
      values.sort((a, b) => a - b);
      const p33 = values[Math.floor(values.length * 0.33)];
      const p66 = values[Math.floor(values.length * 0.66)];
      return results.map(row => {
        const rawLabel = Number(row.label);
        if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
          return { ...row, label: null };
        }
        let normalizedLabel: number;
        if (rawLabel >= p66!) normalizedLabel = 1;
        else if (rawLabel <= p33!) normalizedLabel = -1;
        else normalizedLabel = 0;
        return { ...row, label: normalizedLabel, rawLabel };
      });
    }
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      let normalizedLabel: number;
      if (rawLabel > 0) normalizedLabel = 1;
      else if (rawLabel < 0) normalizedLabel = -1;
      else normalizedLabel = 0;
      return { ...row, label: normalizedLabel, rawLabel };
    });
  }

  // `regime` keeps its own class ids. It used to be folded onto ±1 for a
  // renderer that could only draw two arrows, which put the response at odds
  // with itself: `distribution` is aggregated over the RAW label in SQL, so it
  // reported four regimes while `preview[].label` carried two. Measured on MNQ
  // 1H: distribution {0:131, 1:593, 2:512, 3:213} against labels {-1, 1}.
  if (multiClassGenerators.includes(generatorType)) {
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      return { ...row, label: rawLabel, rawLabel, regimeName: row.regime_name as string | undefined };
    });
  }

  if (generatorType === 'pseudo_confidence') {
    return results.filter(row => row.label !== null && row.label !== undefined);
  }

  return results;
}
