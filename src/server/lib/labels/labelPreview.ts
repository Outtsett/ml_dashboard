/**
 * Label Preview — generates label previews without persisting to database.
 *
 * Used by the chart overlay to show labels on the trading chart.
 * Queries QuestDB directly with CTE-based label generation.
 */

import type { LabelGeneratorType } from './sqlLabelGenerators';
import type { MetaLabelParams } from './sqlLabelGenerators';
import { queryLabels, getTimeframeTable, buildMetaLabelSQL } from './labelHelpers';
import { generateLabelSQL } from './labelGenerator';

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

export async function previewLabels(
  request: LabelPreviewRequest
): Promise<{ success: boolean; preview?: Array<Record<string, unknown>>; count?: number; error?: string; generatorType?: string }> {
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

    const tableName = getTimeframeTable(request.timeframeMinutes);
    const limit = request.limit || 500;

    let labelSQL: string | null;

    // For meta_label, build combined SQL with direction labels as CTE
    if (request.generatorType === 'meta_label') {
      labelSQL = buildMetaLabelSQL(
        request.params as unknown as MetaLabelParams,
        request.symbol,
        tableName,
      );
    } else {
      labelSQL = generateLabelSQL(
        request.generatorType,
        request.params,
        { symbol: request.symbol, tableName }
      );
    }

    if (!labelSQL) {
      return { success: false, error: `Unknown generator type: ${request.generatorType}` };
    }

    const limitedSQL = `
      WITH label_data AS (${labelSQL})
      SELECT * FROM label_data
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;

    const results = await queryLabels(limitedSQL);

    const sortedResults = (results || []).sort((a: any, b: any) =>
      Number(a.timestamp) - Number(b.timestamp)
    );

    const normalizedResults = normalizeLabelsForPreview(request.generatorType, sortedResults);

    return {
      success: true,
      preview: normalizedResults,
      count: normalizedResults.length,
      generatorType: request.generatorType,
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ─── Label Normalization ────────────────────────────────────────────────────

/**
 * Normalize label values for chart rendering.
 * All generators should output { timestamp, close, label } where label is -1, 0, or 1.
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

  if (multiClassGenerators.includes(generatorType)) {
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      const regimeName = row.regime_name as string | undefined;
      let normalizedLabel: number;
      if (regimeName) {
        if (regimeName.includes('down') || regimeName === 'bearish') normalizedLabel = -1;
        else if (regimeName.includes('up') || regimeName === 'bullish') normalizedLabel = 1;
        else normalizedLabel = 0;
      } else {
        if (rawLabel === 0) normalizedLabel = -1;
        else if (rawLabel === 1) normalizedLabel = 1;
        else if (rawLabel === 2) normalizedLabel = -1;
        else normalizedLabel = 1;
      }
      return { ...row, label: normalizedLabel, rawLabel, regimeName };
    });
  }

  if (generatorType === 'multi_step') {
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      return { ...row, label: rawLabel === 1 ? 1 : -1, rawLabel };
    });
  }

  if (generatorType === 'pseudo_confidence') {
    return results.filter(row => row.label !== null && row.label !== undefined);
  }

  if (generatorType === 'meta_label') {
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      return { ...row, label: rawLabel === 1 ? 1 : -1, rawLabel };
    });
  }

  return results;
}
