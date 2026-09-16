/**
 * What the model is actually reading.
 *
 * SHAP values are contributions to the log-odds of "up", so they are signed and
 * they add up. Three readings:
 *   features  mean |SHAP| per feature over the evaluated rows — how much the
 *             feature moved the answer, regardless of direction;
 *   families  the same, summed inside each family, so `share` is that family's
 *             portion of all the movement and the five shares add to one. The
 *             macro family is always listed even when it holds no features, so
 *             the legend never changes shape between models;
 *   timeline  the SIGNED family total per row, bucketed for transport — this is
 *             the one that shows a family pushing the model long for a week and
 *             then short;
 *   beeswarm  the top features' (SHAP, feature value) pairs, which is where a
 *             monotone relationship between a feature's level and its push
 *             becomes visible.
 */

import { samplingStride } from "./downsample";
import type { LensRowRange } from "./series";
import {
  LENS_FAMILY_LABELS,
  type LensAttribution,
  type LensAttributionSeries,
  type LensFeatureFamilyKey,
  type LensManifest,
  type LensSeries,
} from "./types";

export const LENS_MAX_TIMELINE_STEPS = 1000;
export const LENS_BEESWARM_FEATURE_COUNT = 12;
export const LENS_BEESWARM_POINTS_PER_FEATURE = 400;

const FAMILY_ORDER: readonly LensFeatureFamilyKey[] = [
  "momentum",
  "volatility",
  "volume",
  "price_structure",
  "macro",
];

function emptyContributions(): Record<LensFeatureFamilyKey, number> {
  return { momentum: 0, volatility: 0, volume: 0, price_structure: 0, macro: 0 };
}

export function unavailableAttribution(reason: string): LensAttribution {
  return {
    available: false,
    reason,
    families: FAMILY_ORDER.map((family) => ({
      family,
      label: LENS_FAMILY_LABELS[family],
      featureCount: 0,
      meanAbsoluteShap: 0,
      share: 0,
      features: [],
    })),
    features: [],
    timeline: [],
    beeswarm: [],
  };
}

export function computeAttribution(
  series: LensSeries,
  attribution: LensAttributionSeries | null,
  manifest: LensManifest,
  range: LensRowRange,
): LensAttribution {
  if (!attribution || attribution.featureNames.length === 0 || range.barCount <= 0) {
    return unavailableAttribution(manifest.attribution.reason ?? "no attribution artifact for this model");
  }

  const featureCount = attribution.featureNames.length;
  const rowCount = range.barCount;
  const meanAbsolute = new Float64Array(featureCount);
  for (let feature = 0; feature < featureCount; feature += 1) {
    const column = attribution.shap[feature];
    if (!column) continue;
    let total = 0;
    let counted = 0;
    for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
      const value = column[row] as number;
      if (!Number.isFinite(value)) continue;
      total += Math.abs(value);
      counted += 1;
    }
    meanAbsolute[feature] = counted > 0 ? total / counted : 0;
  }

  const ranked = Array.from({ length: featureCount }, (_, index) => index).sort(
    (a, b) => (meanAbsolute[b] as number) - (meanAbsolute[a] as number),
  );
  const features = ranked.map((index, position) => ({
    name: attribution.featureNames[index] as string,
    family: attribution.featureFamilies[index] as LensFeatureFamilyKey,
    meanAbsoluteShap: meanAbsolute[index] as number,
    rank: position + 1,
  }));

  const familyTotals = emptyContributions();
  const familyFeatures: Record<LensFeatureFamilyKey, string[]> = {
    momentum: [],
    volatility: [],
    volume: [],
    price_structure: [],
    macro: [],
  };
  for (let index = 0; index < featureCount; index += 1) {
    const family = attribution.featureFamilies[index] as LensFeatureFamilyKey;
    familyTotals[family] += meanAbsolute[index] as number;
    (familyFeatures[family] as string[]).push(attribution.featureNames[index] as string);
  }
  const grandTotal = FAMILY_ORDER.reduce((sum, family) => sum + familyTotals[family], 0);
  const families = FAMILY_ORDER.map((family) => ({
    family,
    label: LENS_FAMILY_LABELS[family],
    featureCount: family === "macro" ? familyFeatures.macro.length : (familyFeatures[family] as string[]).length,
    meanAbsoluteShap: familyTotals[family],
    share: grandTotal > 0 ? familyTotals[family] / grandTotal : 0,
    features: familyFeatures[family] as string[],
  }));

  // Signed family contribution per row, bucketed to at most 1000 steps.
  const stepCount = Math.min(LENS_MAX_TIMELINE_STEPS, rowCount);
  const timeline: LensAttribution["timeline"] = [];
  for (let step = 0; step < stepCount; step += 1) {
    const start = range.firstRowIndex + Math.floor((step * rowCount) / stepCount);
    const end = range.firstRowIndex + Math.floor(((step + 1) * rowCount) / stepCount);
    if (end <= start) continue;
    const contributions = emptyContributions();
    for (let feature = 0; feature < featureCount; feature += 1) {
      const column = attribution.shap[feature];
      if (!column) continue;
      const family = attribution.featureFamilies[feature] as LensFeatureFamilyKey;
      let total = 0;
      for (let row = start; row < end; row += 1) {
        const value = column[row] as number;
        if (Number.isFinite(value)) total += value;
      }
      contributions[family] += total / (end - start);
    }
    timeline.push({
      timestampSeconds: series.timestampSeconds[end - 1] as number,
      contributions,
    });
  }

  const beeswarm: LensAttribution["beeswarm"] = [];
  const stride = samplingStride(rowCount, LENS_BEESWARM_POINTS_PER_FEATURE);
  for (const index of ranked.slice(0, LENS_BEESWARM_FEATURE_COUNT)) {
    const shapColumn = attribution.shap[index];
    const valueColumn = attribution.value[index];
    if (!shapColumn) continue;
    const points: Array<{ shap: number; featureValue: number }> = [];
    for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += stride) {
      const shap = shapColumn[row] as number;
      if (!Number.isFinite(shap)) continue;
      const featureValue = valueColumn ? (valueColumn[row] as number) : Number.NaN;
      points.push({ shap, featureValue: Number.isFinite(featureValue) ? featureValue : 0 });
    }
    beeswarm.push({
      feature: attribution.featureNames[index] as string,
      family: attribution.featureFamilies[index] as LensFeatureFamilyKey,
      points,
    });
  }

  return {
    available: true,
    families,
    features,
    timeline,
    beeswarm,
  };
}
