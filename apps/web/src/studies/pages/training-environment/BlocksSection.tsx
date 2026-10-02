/**
 * Section 2: every modality block, as the numbers the model receives. Each row
 * of the heatmap is a feature, each column a bar (the window chosen in section
 * 1, averaged into bins when it has more bars than pixels), each cell the value
 * fed to that block's projection. Beside it: the nine statistics of every
 * feature over ALL the run's bars (computed in SQL with the notebook's
 * conventions), a histogram per feature, and the skewness and kurtosis formula
 * with its terms steppable.
 */

import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, FormulaCard, Finding, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, StudyState, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import { standardisedMoments, windowedFeatureMatrix, type BlockBody, type BlockCatalogueRow } from "@shared/studies/training-environment";
import { CanvasHeatmap } from "./CanvasHeatmap";
import { resolveWindow } from "./DataSection";
import { usePart, type SetControl, type TrainingControls } from "./shared";

const MAXIMUM_COLUMNS = 400;

export function BlocksSection({ catalogue, barCount, controls, set }: { catalogue: readonly BlockCatalogueRow[]; barCount: number; controls: TrainingControls; set: SetControl }) {
  const blockNames = [...new Set(catalogue.map((row) => row.block))];
  const query = usePart<BlockBody>("block", controls, { block: controls.block });
  const body = query.data?.data;
  const block = body?.block ?? null;
  const features = body?.features ?? [];
  const values = body?.values ?? [];
  const statistics = body?.statistics ?? [];
  const { first, last } = resolveWindow(controls.firstBar, controls.lastBar, values.length || barCount);
  const windowed = windowedFeatureMatrix(values, features.length, first, last, MAXIMUM_COLUMNS);
  const binned = windowed.spans.length < last - first + 1;

  const rows = values.map((row) => Object.fromEntries(features.map((feature, index) => [feature, row[index] ?? null])));

  const featureName = features.includes(controls.statisticFeature) ? controls.statisticFeature : (features[0] ?? "");
  const featureIndex = Math.max(0, features.indexOf(featureName));
  const column = values.map((row) => row[featureIndex] ?? null);
  const moments = standardisedMoments(column);
  const measured = column.map((value, index) => ({ value, index })).filter((item): item is { value: number; index: number } => item.value !== null && Number.isFinite(item.value));
  const step = Math.min(measured.length, controls.termIndex <= 0 ? measured.length : controls.termIndex);
  const term = measured[step - 1];
  const standardised = term && moments?.standardDeviation ? (term.value - moments.mean) / moments.standardDeviation : null;
  let partial = 0;
  if (moments?.standardDeviation) {
    for (let i = 0; i < step; i += 1) partial += (((measured[i] as { value: number }).value - moments.mean) / moments.standardDeviation) ** 3;
  }

  // A 0/1 flag has no distribution to bin: its graphic is how often it is 1.
  const flags = features
    .map((feature, index) => {
      const seen = values.map((row) => row[index]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return { feature, share: seen.length ? seen.filter((value) => value === 1).length / seen.length : null, binary: seen.length > 0 && seen.every((value) => value === 0 || value === 1) };
    })
    .filter((item) => item.binary);

  const heavy = statistics.filter((row) => Math.abs(row.skewness ?? 0) > 1 || (row.excess_kurtosis ?? 0) > 3);

  return (
    <Section title="2 · Every modality block, as the numbers the model receives" question="Not a summary of the input: the input. Each row is a feature, each column a bar, each cell the value fed to that block's projection.">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <div className="space-y-3">
          <ControlBar>
            <SelectControl label="Block" value={block ?? ""} options={blockNames.map((name) => ({ value: name, label: `${name} (${catalogue.filter((row) => row.block === name).length} features)` }))} onChange={(value) => set("block", value)} />
            <SegmentControl label="Colour scale" value={controls.colourScale === "per row" ? "per row" : "shared"} options={[{ value: "shared", label: "shared" }, { value: "per row", label: "per feature" }]} onChange={(value) => set("colourScale", value)} />
          </ControlBar>

          {block === null ? (
            <p className="py-4 text-xs text-neutral-400">This run has not published its blocks.</p>
          ) : (
            <>
              <Finding>
                {block}: {features.length} features x {fmtInt(last - first + 1)} bars in view (bars {fmtInt(first)} to {fmtInt(last)} of {fmtInt(values.length)})
                {binned ? `, averaged into ${windowed.spans.length} columns so every cell is at least a pixel wide` : ""}. The window is set in section 1.
              </Finding>
              <CanvasHeatmap
                matrix={windowed.matrix}
                rowLabels={features}
                scale={controls.colourScale === "per row" ? "per row" : "shared"}
                rowHeight={24}
                valueName="value"
                columnLabel={(columnIndex) => {
                  const span = windowed.spans[columnIndex] ?? [first, first];
                  return span[0] === span[1] ? `bar ${span[0]}` : `bars ${span[0]} to ${span[1]} (mean)`;
                }}
              />

              <Finding>
                Every feature in {block}, over all {fmtInt(values.length)} bars. Mean and standard deviation describe a Gaussian; the skewness and excess-kurtosis columns are what say these are not
                {heavy.length > 0 ? `: ${heavy.length} of ${statistics.length} features here have |skewness| above 1 or excess kurtosis above 3 (marked ◆).` : "."}
              </Finding>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[11px] font-mono tnum">
                  <thead>
                    <tr className="text-neutral-500">
                      {["feature", "count", "mean", "median", "standard_deviation", "skewness", "excess_kurtosis", "percentile_25", "percentile_75", "minimum", "maximum"].map((name) => (
                        <th key={name} className={`py-0.5 pl-3 font-normal ${name === "feature" ? "text-left pl-0" : "text-right"}`}>{name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {statistics.map((row) => (
                      <tr key={row.feature} className="border-t border-neutral-900 text-neutral-200">
                        <td className="py-0.5 text-left">{heavy.includes(row) ? "◆ " : ""}{row.feature}</td>
                        <td className="pl-3 text-right">{fmtInt(row.count)}</td>
                        {[row.mean, row.median, row.standard_deviation, row.skewness, row.excess_kurtosis, row.percentile_25, row.percentile_75, row.minimum, row.maximum].map((value, index) => (
                          <td key={index} className="pl-3 text-right">{fmt(value, 4)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ResponsiveContainer width="100%" height={Math.max(180, 22 * statistics.length + 50)}>
                <BarChart data={statistics} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }} barCategoryGap={3}>
                  <CartesianGrid {...GRID} horizontal={false} />
                  <XAxis type="number" {...AXIS} />
                  <YAxis type="category" dataKey="feature" width={190} {...AXIS} interval={0} />
                  <ReferenceLine x={0} stroke={OKABE.grey} />
                  <Tooltip {...TOOLTIP} formatter={(value: number) => fmt(value, 4)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="skewness" name="skewness (mean of z³)" fill={OKABE.orange} isAnimationActive={false} />
                  <Bar dataKey="excess_kurtosis" name="excess_kurtosis (mean of z⁴ minus 3)" fill={OKABE.blue} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>

              <ColumnGrid rows={rows} title={`Every column of ${block} (all bars)`} />
              {flags.length > 0 && (
                <div className="space-y-1">
                  <Finding>{flags.length} feature{flags.length === 1 ? " is a 0/1 flag" : "s are 0/1 flags"}, so its graphic is the share of bars where it is 1 (the histogram grid above skips them).</Finding>
                  <ResponsiveContainer width="100%" height={Math.max(120, 20 * flags.length + 40)}>
                    <BarChart data={flags} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }} barCategoryGap={3}>
                      <CartesianGrid {...GRID} horizontal={false} />
                      <XAxis type="number" domain={[0, 1]} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} {...AXIS} />
                      <YAxis type="category" dataKey="feature" width={190} {...AXIS} interval={0} />
                      <Tooltip {...TOOLTIP} formatter={(value: number) => [`${(value * 100).toFixed(2)}% of bars`, "share at 1"]} />
                      <Bar dataKey="share" name="share of bars at 1" fill={OKABE.sky} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <ControlBar>
                <SelectControl label="Feature" value={featureName} options={features.map((feature) => ({ value: feature, label: feature }))} onChange={(value) => { set("statisticFeature", value); set("termIndex", 0); }} />
                <SliderControl label="Step the index i" value={step} min={1} max={Math.max(1, measured.length)} onChange={(value) => set("termIndex", value)} format={(value) => fmtInt(value)} hint="Walk the sum one bar at a time; at i = n it equals the skewness above" />
              </ControlBar>
              <FormulaCard
                tex={String.raw`g_1=\frac{1}{n}\sum_{i=1}^{n} z_i^{3},\qquad g_2=\frac{1}{n}\sum_{i=1}^{n} z_i^{4}-3,\qquad z_i=\frac{x_i-\bar{x}}{s}`}
                caption={`Shown for ${featureName}. The partial sum through bar i is (1/n) Σ z³ up to i; it reaches g₁ when i = n.`}
                symbols={[
                  { tex: "n", name: "bars with a finite value of this feature", value: fmtInt(moments?.count) },
                  { tex: "i", name: "position of the bar among those bars (the stepper)", value: `${fmtInt(step)} (bar index ${fmtInt(term?.index)})` },
                  { tex: "x_i", name: `the value of ${featureName} at bar i`, value: fmt(term?.value, 6) },
                  { tex: "\\bar{x}", name: "mean of the feature over all n bars", value: fmt(moments?.mean, 6) },
                  { tex: "s", name: "sample standard deviation (divisor n − 1)", value: fmt(moments?.standardDeviation, 6) },
                  { tex: "z_i", name: "standardised value of bar i: how many s it sits from the mean", value: fmt(standardised, 4) },
                  { tex: "z_i^3", name: "this bar's term in the skewness sum", value: fmt(standardised === null ? null : standardised ** 3, 4) },
                  { tex: "\\tfrac{1}{n}\\sum_{j\\le i} z_j^3", name: "running skewness through bar i", value: fmt(moments?.standardDeviation ? partial / (moments?.count ?? 1) : null, 4) },
                  { tex: "g_1", name: "skewness over all bars (0 = symmetric, positive = long right tail)", value: fmt(moments?.skewness, 4) },
                  { tex: "g_2", name: "excess kurtosis over all bars (0 = Gaussian tails, positive = fatter)", value: fmt(moments?.excessKurtosis, 4) },
                ]}
              />
            </>
          )}
        </div>
      </StudyState>
    </Section>
  );
}
