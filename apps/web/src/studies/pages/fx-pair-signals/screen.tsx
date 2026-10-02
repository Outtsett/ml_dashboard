/**
 * Section 3 of the study: which of 50 price-structure features beat a
 * best-of-N day-block permutation null, for volatility (forward log range)
 * against direction (forward log return). Survival by family, the pair x
 * feature Spearman map, the strongest survivors with the null stepped row by
 * row, and the near-duplicate features that are not independent evidence.
 */

import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat, SwitchControl, TOOLTIP,
  fmt, fmtInt, fmtPercent, histogram,
} from "@/studies/kit";
import {
  SCREEN_TARGETS, SCREEN_TIMEFRAMES, TARGET_LABEL, divergingColour,
  type FxPairSignalsBody, type ScreenRow, type ScreenTarget,
} from "@shared/studies/fx-pair-signals";
import { DataTable } from "./DataTable";
import { MatrixGrid, ScaleLegend } from "./MatrixGrid";
import type { Controls, SetControl } from "./controls";

const TARGET_COLOUR: Record<ScreenTarget, string> = { forward_log_range: OKABE.orange, forward_log_return: OKABE.blue };
const TARGET_GLYPH: Record<ScreenTarget, string> = { forward_log_range: "▲", forward_log_return: "▼" };

export function ScreenSection({ body, controls, set, fetching }: { body: FxPairSignalsBody; controls: Controls; set: SetControl; fetching: boolean }) {
  const perFeature = controls.criterion === "per_feature";
  const tests = body.survival.reduce((sum, row) => sum + row.tests, 0);
  const survived = body.survival.reduce((sum, row) => sum + row.survived, 0);
  const rateOf = (target: ScreenTarget) => {
    const rows = body.survival.filter((row) => row.target === target);
    const total = rows.reduce((sum, row) => sum + row.tests, 0);
    return total ? rows.reduce((sum, row) => sum + row.survived, 0) / total : null;
  };

  const maxOf = (target: ScreenTarget) => {
    const values = body.survival.filter((row) => row.target === target).map((row) => row.max_absolute_spearman);
    return values.length ? Math.max(...values) : null;
  };

  // grouped bar: one row per family, one bar per target
  const families = [...new Set(body.survival.map((row) => row.family))];
  const survivalChart = families
    .map((family) => {
      const point: Record<string, number | string | null> = { family };
      for (const target of SCREEN_TARGETS) point[target] = body.survival.find((row) => row.family === family && row.target === target)?.survival_rate ?? null;
      return point;
    })
    .sort((a, b) => ((b.forward_log_range as number) ?? 0) - ((a.forward_log_range as number) ?? 0));

  // heat map: features (grouped by family) x pairs
  const featureOrder = [...new Map(body.heatmap.map((cell) => [cell.feature, cell.family])).entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const heatPairs = [...new Set(body.heatmap.map((cell) => cell.pair))].sort();
  const heat = new Map(body.heatmap.map((cell) => [`${cell.feature}|${cell.pair}`, cell]));
  const heatLimit = Math.max(0.05, ...body.heatmap.map((cell) => Math.abs(cell.spearman_correlation)));

  // null stepper over the strongest rows
  const rank = Math.min(Math.max(1, controls.nullRank), Math.max(1, body.strongest.length));
  const selected: ScreenRow | undefined = body.strongest[rank - 1];
  const selectedKey = selected ? `${selected.pair}|${selected.timeframe}|${selected.target}|${selected.feature}` : null;
  const threshold = selected ? (perFeature ? selected.null_95th_percentile_per_feature : selected.null_95th_percentile_family_wise) : null;

  // redundancy
  const absolute = body.redundancy.map((row) => Math.abs(row.spearman_correlation));
  const redundancyBins = histogram(absolute, 40).map((bin) => ({ middle: (bin.lower + bin.upper) / 2, count: bin.count, lower: bin.lower, upper: bin.upper }));
  const redundancyFeatures = [...new Set(body.redundancy.flatMap((row) => [row.feature_a, row.feature_b]))];
  const familyOf = new Map<string, string>();
  for (const row of body.redundancy) {
    familyOf.set(row.feature_a, row.family_a);
    familyOf.set(row.feature_b, row.family_b);
  }
  redundancyFeatures.sort((a, b) => (familyOf.get(a) ?? "").localeCompare(familyOf.get(b) ?? "") || a.localeCompare(b));
  const redundancyLookup = new Map<string, number>();
  for (const row of body.redundancy) {
    redundancyLookup.set(`${row.feature_a}|${row.feature_b}`, row.spearman_correlation);
    redundancyLookup.set(`${row.feature_b}|${row.feature_a}`, row.spearman_correlation);
  }

  return (
    <>
      <Section
        title="3 · Which price-structure features survive"
        question="Fifty features per pair per timeframe. The target is cut into one-trading-day blocks and reordered 500 times (seeded); a feature must beat the 95th percentile of the largest absolute correlation across the whole feature set."
        aside={fetching ? <span className="text-[10px] text-neutral-500">updating…</span> : undefined}
      >
        <ControlBar
          onReset={() => {
            set("target", "both"); set("timeframe", "all"); set("pair", "all"); set("family", "all"); set("criterion", "family_wise"); set("topCount", 25);
          }}
        >
          <SelectControl label="Target" value={controls.target} options={[{ value: "both", label: "both" }, ...SCREEN_TARGETS.map((t) => ({ value: t, label: `${TARGET_GLYPH[t]} ${TARGET_LABEL[t]}` }))]} onChange={(v) => set("target", v)} />
          <SegmentControl label="Timeframe" value={controls.timeframe} options={[{ value: "all", label: "all" }, ...SCREEN_TIMEFRAMES.map((t) => ({ value: t, label: t }))]} onChange={(v) => set("timeframe", v)} />
          <SelectControl label="Pair" value={controls.pair} options={[{ value: "all", label: "all 18 pairs" }, ...body.pairs.map((p) => ({ value: p, label: p }))]} onChange={(v) => set("pair", v)} />
          <SelectControl label="Family" value={controls.family} options={[{ value: "all", label: "all families" }, ...body.families.map((f) => ({ value: f, label: f }))]} onChange={(v) => set("family", v)} />
          <SegmentControl label="Null" value={controls.criterion} options={[{ value: "family_wise", label: "family-wise (best of N)" }, { value: "per_feature", label: "per feature" }]} onChange={(v) => set("criterion", v)} />
        </ControlBar>
        <div className="mt-2 grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label="Tests" value={fmtInt(tests)} hint="pair × timeframe × target × feature under the filters" />
          <Stat label="Beat the null" value={fmtInt(survived)} />
          <Stat label="▲ volatility survival" value={fmtPercent(rateOf("forward_log_range"))} tone={OKABE.orange} hint="share of forward-log-range tests beating the null" />
          <Stat label="▼ direction survival" value={fmtPercent(rateOf("forward_log_return"))} tone={OKABE.blue} hint="share of forward-log-return tests beating the null" />
        </div>
        <Finding>
          Volatility is forecastable; direction is not: {fmtPercent(rateOf("forward_log_range"))} of the forward-log-range tests beat the {perFeature ? "per-feature" : "family-wise"} null
          against {fmtPercent(rateOf("forward_log_return"))} of the forward-log-return tests, and the strongest direction correlation is |ρ| {fmt(maxOf("forward_log_return"), 3)} against{" "}
          {fmt(maxOf("forward_log_range"), 3)} for volatility: direction survivors exist, but they are an order of magnitude weaker. The null keeps each series' diurnal cycle, so a feature that tracks the target only
          through the hour of day still survives; the volume family is the one this over-credits (about 59% of its link to volatility is hour of day on EURUSD 1h).
        </Finding>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <DataTable
            rows={body.survival}
            rowKey={(row) => `${row.target}|${row.family}`}
            columns={[
              { key: "target", label: "target", align: "left", cell: (row) => <span style={{ color: TARGET_COLOUR[row.target] }}>{TARGET_GLYPH[row.target]} {row.target}</span> },
              { key: "family", label: "family", align: "left" },
              { key: "tests", label: "tests", cell: (row) => fmtInt(row.tests) },
              { key: "survived", label: "survived", cell: (row) => fmtInt(row.survived) },
              { key: "max_absolute_spearman", label: "max |Spearman|", cell: (row) => fmt(row.max_absolute_spearman, 4) },
              { key: "survival_rate", label: "survival rate", cell: (row) => fmt(row.survival_rate, 3) },
            ]}
          />
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={Math.max(220, 34 * survivalChart.length + 40)}>
              <BarChart data={survivalChart} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" domain={[0, 1]} {...AXIS} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                <YAxis type="category" dataKey="family" width={70} {...AXIS} interval={0} />
                <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [fmtPercent(value), name]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {SCREEN_TARGETS.filter((t) => controls.target === "both" || controls.target === t).map((target) => (
                  <Bar key={target} dataKey={target} name={`${TARGET_GLYPH[target]} ${TARGET_LABEL[target]}`} fill={TARGET_COLOUR[target]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-neutral-400">Share of tests beating the {perFeature ? "per-feature" : "family-wise"} null, per family.</p>
          </div>
        </div>
      </Section>

      <Section title="Spearman correlation, pair by feature" question="Each cell is one test: the feature's rank correlation with the target. ● marks a test that beats the chosen null.">
        <ControlBar>
          <SegmentControl label="Timeframe" value={controls.heatmapTimeframe} options={SCREEN_TIMEFRAMES.map((t) => ({ value: t, label: t }))} onChange={(v) => set("heatmapTimeframe", v)} />
          <SelectControl label="Target" value={controls.heatmapTarget} options={SCREEN_TARGETS.map((t) => ({ value: t, label: `${TARGET_GLYPH[t]} ${TARGET_LABEL[t]}` }))} onChange={(v) => set("heatmapTarget", v)} />
        </ControlBar>
        <div className="mt-2">
          <MatrixGrid
            rowLabels={featureOrder.map(([feature, family]) => `${family} · ${feature}`)}
            columnLabels={heatPairs}
            rowLabelWidth={210}
            cellHeight={13}
            value={(r, c) => heat.get(`${featureOrder[r]?.[0]}|${heatPairs[c]}`)?.spearman_correlation ?? null}
            colour={(value) => divergingColour(value, heatLimit)}
            format={(value) => fmt(value, 4)}
            glyph={(r, c) => (heat.get(`${featureOrder[r]?.[0]}|${heatPairs[c]}`)?.survives ? "●" : null)}
            describe={(r, c) => (heat.get(`${featureOrder[r]?.[0]}|${heatPairs[c]}`)?.survives ? "beats the null" : "does not beat the null")}
            legend={<ScaleLegend low={-heatLimit} high={heatLimit} colour={(v) => divergingColour(v, heatLimit)} lowLabel={`▼ ${fmt(-heatLimit, 2)}`} highLabel={`${fmt(heatLimit, 2)} ▲`} />}
          />
        </div>
      </Section>

      <Section title="The strongest survivors" question="Tests beating the null under the filters, by absolute Spearman correlation. Click a row, or step the rank, to put it in the formula.">
        <ControlBar>
          <SliderControl label="Show top" value={controls.topCount} min={5} max={100} onChange={(v) => set("topCount", v)} />
          <SliderControl label="Rank in formula" value={rank} min={1} max={Math.max(1, body.strongest.length)} onChange={(v) => set("nullRank", v)} />
        </ControlBar>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <DataTable
            rows={body.strongest}
            rowKey={(row) => `${row.pair}|${row.timeframe}|${row.target}|${row.feature}`}
            selectedKey={selectedKey}
            onRowClick={(row) => set("nullRank", body.strongest.indexOf(row) + 1)}
            maxHeight={420}
            columns={[
              { key: "rank", label: "#", sortValue: (row) => body.strongest.indexOf(row), cell: (row) => String(body.strongest.indexOf(row) + 1) },
              { key: "pair", label: "pair", align: "left" },
              { key: "timeframe", label: "timeframe", align: "left" },
              { key: "target", label: "target", align: "left", cell: (row) => <span style={{ color: TARGET_COLOUR[row.target] }}>{TARGET_GLYPH[row.target]} {row.target.replace("forward_log_", "")}</span> },
              { key: "feature", label: "feature", align: "left" },
              { key: "family", label: "family", align: "left" },
              { key: "spearman_correlation", label: "Spearman", cell: (row) => fmt(row.spearman_correlation, 4) },
              { key: "null_95th_percentile_family_wise", label: "family-wise null 95th", cell: (row) => fmt(row.null_95th_percentile_family_wise, 4) },
            ]}
          />
          <FormulaCard
            tex={
              perFeature
                ? "\\text{survives} \\iff \\lvert \\hat\\rho_j \\rvert > Q_{0.95}\\!\\left( \\lvert \\rho_j^{(b)} \\rvert \\right)_{b=1}^{B}"
                : "\\text{survives} \\iff \\lvert \\hat\\rho_j \\rvert > Q_{0.95}\\!\\left( \\max_{k=1..K} \\lvert \\rho_k^{(b)} \\rvert \\right)_{b=1}^{B}"
            }
            caption={selected ? `Rank ${rank}: ${selected.pair} ${selected.timeframe} ${selected.feature} → ${selected.target}. ${Math.abs(selected.spearman_correlation) > (threshold ?? Infinity) ? "Beats" : "Does not beat"} the null.` : "No surviving test under these filters."}
            symbols={[
              { tex: "\\hat\\rho_j", name: "Spearman rank correlation of feature j with the target, on the real ordering", value: fmt(selected?.spearman_correlation, 4) },
              { tex: "\\rho_k^{(b)}", name: "the same correlation after permutation b of one-trading-day target blocks", value: "per permutation" },
              { tex: "B", name: "permutations (seeded)", value: "500" },
              ...(perFeature ? [] : [{ tex: "K", name: "features in the set, all tried at once", value: "50" }]),
              { tex: "Q_{0.95}", name: `95th percentile of that ${perFeature ? "feature's" : "best-of-N"} null distribution`, value: fmt(threshold, 4) },
              { tex: "n", name: "rows in the test", value: fmtInt(selected?.observation_count) },
            ]}
          />
        </div>
      </Section>

      <Section title="Near-duplicate features are not independent evidence" question="Spearman correlation between every pair of the 50 features (1,225 combinations).">
        <ControlBar>
          <SliderControl label="Duplicate above |ρ|" value={controls.redundancyThreshold} min={0.5} max={0.999} step={0.005} onChange={(v) => set("redundancyThreshold", v)} format={(v) => fmt(v, 3)} />
          <SwitchControl label="Feature × feature matrix" checked={controls.showRedundancyMatrix} onChange={(v) => set("showRedundancyMatrix", v)} />
        </ControlBar>
        <Finding>
          {body.nearDuplicates.length} feature pairs correlate above {fmt(controls.redundancyThreshold, 3)} and are not independent evidence. The moving-average families are the
          clearest case: simple, exponential and weighted at the same window are three names for nearly one number.
        </Finding>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={redundancyBins} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barCategoryGap={1}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="middle" type="number" domain={[0, 1]} {...AXIS} tickFormatter={(v: number) => fmt(v, 1)} />
                <YAxis {...AXIS} width={36} />
                <Tooltip
                  {...TOOLTIP}
                  formatter={(value: number) => [fmtInt(value), "feature pairs"]}
                  labelFormatter={(_, payload) => {
                    const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                    return bin ? `|ρ| ${fmt(bin.lower, 3)} to ${fmt(bin.upper, 3)}` : "";
                  }}
                />
                <ReferenceLine x={controls.redundancyThreshold} stroke={OKABE.orange} strokeDasharray="4 3" label={{ value: "threshold", fill: OKABE.orange, fontSize: 9, position: "top" }} />
                <Bar dataKey="count" isAnimationActive={false}>
                  {redundancyBins.map((bin) => (
                    <Cell key={bin.middle} fill={bin.lower >= controls.redundancyThreshold ? OKABE.orange : OKABE.sky} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-neutral-400">|Spearman| between feature pairs; <span style={{ color: OKABE.orange }}>■ above the threshold</span> · <span style={{ color: OKABE.sky }}>■ below</span></p>
          </div>
          <DataTable
            rows={body.nearDuplicates}
            rowKey={(row) => `${row.feature_a}|${row.feature_b}`}
            maxHeight={260}
            columns={[
              { key: "feature_a", label: "feature a", align: "left" },
              { key: "feature_b", label: "feature b", align: "left" },
              { key: "family_a", label: "family a", align: "left" },
              { key: "family_b", label: "family b", align: "left" },
              { key: "spearman_correlation", label: "Spearman", sortValue: (row) => Math.abs(row.spearman_correlation), cell: (row) => fmt(row.spearman_correlation, 4) },
            ]}
          />
        </div>
        {controls.showRedundancyMatrix && (
          <div className="mt-3">
            <MatrixGrid
              rowLabels={redundancyFeatures.map((feature) => `${familyOf.get(feature)} · ${feature}`)}
              columnLabels={redundancyFeatures}
              rowLabelWidth={210}
              cellHeight={11}
              value={(r, c) => (r === c ? 1 : redundancyLookup.get(`${redundancyFeatures[r]}|${redundancyFeatures[c]}`) ?? null)}
              colour={(value) => divergingColour(value, 1)}
              format={(value) => fmt(value, 4)}
              glyph={(r, c) => (r !== c && Math.abs(redundancyLookup.get(`${redundancyFeatures[r]}|${redundancyFeatures[c]}`) ?? 0) > controls.redundancyThreshold ? "●" : null)}
              legend={<ScaleLegend low={-1} high={1} colour={(v) => divergingColour(v, 1)} lowLabel="▼ −1" highLabel="+1 ▲" />}
            />
          </div>
        )}
      </Section>
    </>
  );
}
