/**
 * buildBarWindow — the price chart and the playback tape.
 *
 * The derived state (regime, decision, position, running profit and loss) is
 * computed over the WHOLE evaluated record and only then sliced to the
 * requested rows, so scrolling the chart never restarts a trade mid-flight or
 * re-warms a regime. A window is a view of the record, never a re-run of it.
 *
 * The interval is carried as prices rather than basis points, because that is
 * how it has to be drawn: the quantile q for row t is a forward log return in
 * basis points over the next `horizonBars` rows, so the price it points at is
 *     close[t] * exp(q / 10_000)
 * and it belongs on the chart at row t + horizonBars.
 */

import { classifyRegimes } from "./regime";
import {
  coverageQuantileIndices,
  MEDIAN_QUANTILE_INDEX,
  readLabel,
  readNullable,
  resolveRange,
} from "./series";
import { simulateTrades } from "./simulate";
import { computeBarState } from "./state";
import {
  LENS_MAX_WINDOW_BARS,
  type LensAttributionSeries,
  type LensBar,
  type LensBarWindow,
  type LensEvaluationParams,
  type LensManifest,
  type LensRowWindow,
  type LensSeries,
} from "./types";

export function buildBarWindow(
  series: LensSeries,
  attribution: LensAttributionSeries | null,
  manifest: LensManifest,
  params: LensEvaluationParams,
  rowWindow: LensRowWindow,
  maxBars: number,
): LensBarWindow {
  const range = resolveRange(series, params);
  const cap = Math.max(1, Math.min(Math.floor(maxBars) || LENS_MAX_WINDOW_BARS, LENS_MAX_WINDOW_BARS));

  const requestedStart = Math.max(range.firstRowIndex, Math.floor(rowWindow.startRowIndex));
  const requestedEnd = Math.min(range.lastRowIndex, Math.floor(rowWindow.endRowIndex));
  const clamped: LensRowWindow = { startRowIndex: requestedStart, endRowIndex: requestedEnd };
  const totalBarsInRange = Math.max(0, requestedEnd - requestedStart + 1);

  if (totalBarsInRange === 0) {
    return {
      modelId: series.modelId,
      params,
      rowWindow: clamped,
      bars: [],
      totalBarsInRange: 0,
      truncated: false,
      features: null,
    };
  }

  const regimes = classifyRegimes(series.close, params.regimeLookbackBars, params.regimeThreshold);
  const simulation = simulateTrades(series, params, range);
  for (const trade of simulation.trades) trade.regime = regimes[trade.entryRowIndex] ?? null;
  const state = computeBarState(series, params, range, simulation.trades);

  const { lower, upper } = coverageQuantileIndices(params.intervalCoverage);
  const lowerColumn = series.predictedQuantilesBasisPoints[lower];
  const upperColumn = series.predictedQuantilesBasisPoints[upper];
  const medianColumn = series.predictedQuantilesBasisPoints[MEDIAN_QUANTILE_INDEX];

  const emitted = Math.min(totalBarsInRange, cap);
  const bars: LensBar[] = [];
  for (let k = 0; k < emitted; k += 1) {
    const row = requestedStart + k;
    const offset = row - range.firstRowIndex;
    const close = series.close[row] as number;
    const quantiles: number[] = [];
    let quantilesKnown = true;
    for (const column of series.predictedQuantilesBasisPoints) {
      const value = readNullable(column, row);
      if (value === null) {
        quantilesKnown = false;
        break;
      }
      quantiles.push(value);
    }
    const lowerBasisPoints = lowerColumn ? readNullable(lowerColumn, row) : null;
    const upperBasisPoints = upperColumn ? readNullable(upperColumn, row) : null;
    const medianBasisPoints = medianColumn ? readNullable(medianColumn, row) : null;
    const position = state.position[offset] as number;
    const volume = readNullable(series.volume, row);

    bars.push({
      rowIndex: row,
      timestampSeconds: series.timestampSeconds[row] as number,
      open: series.open[row] as number,
      high: series.high[row] as number,
      low: series.low[row] as number,
      close,
      volume,
      probabilityUp: readNullable(series.probabilityUp, row),
      label: readLabel(series, row),
      realizedReturnBasisPoints: readNullable(series.realizedReturnBasisPoints, row),
      predictedQuantilesBasisPoints: quantilesKnown ? quantiles : null,
      intervalLowerPrice: lowerBasisPoints === null ? null : close * Math.exp(lowerBasisPoints / 1e4),
      intervalUpperPrice: upperBasisPoints === null ? null : close * Math.exp(upperBasisPoints / 1e4),
      intervalMedianPrice: medianBasisPoints === null ? null : close * Math.exp(medianBasisPoints / 1e4),
      regime: regimes[row] ?? null,
      decision: state.decision[offset] ?? "flat",
      position: position === 1 ? 1 : position === -1 ? -1 : 0,
      barPnlUsd: state.barPnlUsd[offset] as number,
      cumulativeNetUsd: state.cumulativeNetUsd[offset] as number,
    });
  }

  return {
    modelId: series.modelId,
    params,
    rowWindow: clamped,
    bars,
    totalBarsInRange,
    truncated: emitted < totalBarsInRange,
    features: buildFeatures(attribution, manifest, bars),
  };
}

function buildFeatures(
  attribution: LensAttributionSeries | null,
  manifest: LensManifest,
  bars: LensBar[],
): LensBarWindow["features"] {
  if (!attribution || !manifest.attribution.available || attribution.featureNames.length === 0) return null;
  const values: Array<Array<number | null>> = [];
  const shap: Array<Array<number | null>> = [];
  for (const bar of bars) {
    const valueRow: Array<number | null> = [];
    const shapRow: Array<number | null> = [];
    for (let feature = 0; feature < attribution.featureNames.length; feature += 1) {
      const valueColumn = attribution.value[feature];
      const shapColumn = attribution.shap[feature];
      valueRow.push(valueColumn ? readNullable(valueColumn, bar.rowIndex) : null);
      shapRow.push(shapColumn ? readNullable(shapColumn, bar.rowIndex) : null);
    }
    values.push(valueRow);
    shap.push(shapRow);
  }
  return {
    names: attribution.featureNames.slice(),
    families: attribution.featureFamilies.slice(),
    values,
    shap,
  };
}
