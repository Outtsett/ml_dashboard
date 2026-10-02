/**
 * Section 2 of the study: how many independent bets the 18 pairs hold.
 * Correlation three ways (raw, after the eight currency legs, in the tail),
 * the eigen spectrum with its participation ratio stepped term by term, the
 * identifiability flag, and the most mechanical pair combinations.
 */

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import {
  CORRELATION_TIMEFRAMES, divergingColour, mechanicalShare, participationSteps,
  type CorrelationRow, type FxPairSignalsBody,
} from "@shared/studies/fx-pair-signals";
import { DataTable } from "./DataTable";
import { MatrixGrid, ScaleLegend } from "./MatrixGrid";
import type { Controls, SetControl } from "./controls";

const MEASURES: Array<{ value: keyof CorrelationRow; label: string }> = [
  { value: "correlation_raw_pearson", label: "raw Pearson" },
  { value: "correlation_raw_spearman", label: "raw Spearman" },
  { value: "correlation_tail_decile", label: "tail (both moves in their top decile)" },
  { value: "correlation_residual_pearson", label: "residual after the eight currency legs" },
  { value: "mechanical_share", label: "mechanical share" },
];

function numberOf(row: CorrelationRow | undefined, key: string): number | null {
  const value = row ? (row as unknown as Record<string, unknown>)[key] : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function CorrelationSection({ body, controls, set }: { body: FxPairSignalsBody; controls: Controls; set: SetControl }) {
  const measure = MEASURES.find((m) => m.value === controls.correlationMeasure) ?? MEASURES[0]!;
  const atTimeframe = body.correlation.filter((row) => row.timeframe === controls.correlationTimeframe);
  const pairs = [...new Set(body.correlation.flatMap((row) => [row.pair_a, row.pair_b]))].sort();
  const lookup = new Map<string, CorrelationRow>();
  for (const row of atTimeframe) {
    lookup.set(`${row.pair_a}|${row.pair_b}`, row);
    lookup.set(`${row.pair_b}|${row.pair_a}`, row);
  }

  // ── eigen spectrum ──
  const eigenAt = body.eigen.filter((row) => row.timeframe === controls.eigenTimeframe);
  const components = [...new Set(eigenAt.map((row) => row.component))].sort((a, b) => a - b);
  const eigenChart = components.map((component) => ({
    component,
    raw: eigenAt.find((row) => row.component === component && row.matrix === "raw")?.variance_share ?? null,
    residual: eigenAt.find((row) => row.component === component && row.matrix === "residual")?.variance_share ?? null,
  }));
  const eigenvalues = eigenAt.filter((row) => row.matrix === controls.eigenMatrix).sort((a, b) => a.component - b.component).map((row) => row.eigenvalue);
  const steps = participationSteps(eigenvalues);
  const step = steps[Math.min(Math.max(1, controls.eigenStep), Math.max(1, steps.length)) - 1];
  const stored = body.participation.find((row) => row.timeframe === controls.eigenTimeframe && row.matrix === controls.eigenMatrix);
  const participationOf = (timeframe: string, matrix: string) => body.participation.find((row) => row.timeframe === timeframe && row.matrix === matrix)?.participation_ratio ?? null;

  // ── body versus tail ──
  const bodyTailChart = body.bodyVersusTail.map((row) => ({
    timeframe: row.timeframe, raw: row.mean_absolute_raw, residual: row.mean_absolute_residual, tail: row.mean_absolute_tail,
  }));

  // ── most mechanical ──
  const mechanical = body.correlation
    .filter((row) => row.timeframe === controls.mechanicalTimeframe && row.residual_identifiable)
    .sort((a, b) => Math.abs(numberOf(b, "correlation_raw_pearson") ?? 0) - Math.abs(numberOf(a, "correlation_raw_pearson") ?? 0))
    .slice(0, controls.mechanicalCount);
  const top = mechanical[0];

  return (
    <>
      <Section
        title="2 · Correlation"
        question="Reported three ways, because one matrix hides what matters more than the matrix: how much of it is the quote convention, and what it does in the tail."
      >
        <Finding>
          Most of an FX correlation matrix is arithmetic: EURUSD and USDCHF share a USD leg on opposite sides, so they mirror each other whatever else happens. Each pair's
          return is regressed on the eight currency factor returns and the residuals are correlated; where the residual collapses to near zero, the raw number was the quote
          convention. (forexmodel's standing rule is per-instrument analysis; these matrices were produced on request, with this correction.)
        </Finding>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <h4 className="text-xs font-semibold text-neutral-200">How many independent bets: participation ratio</h4>
            <DataTable
              rows={body.participation}
              rowKey={(row) => `${row.timeframe}|${row.matrix}`}
              columns={[
                { key: "timeframe", label: "timeframe", align: "left" },
                { key: "matrix", label: "matrix", align: "left" },
                { key: "participation_ratio", label: "participation ratio", cell: (row) => fmt(row.participation_ratio, 2) },
                { key: "observation_count", label: "rows with all 18 pairs", cell: (row) => fmtInt(row.observation_count) },
              ]}
            />
            <Finding>
              At 1d the 18 pairs behave like {fmt(participationOf("1d", "raw"), 2)} independent directions raw and {fmt(participationOf("1d", "residual"), 2)} once the currency legs are
              removed; 18 would be a panel with no common factor, 1 a single factor.
            </Finding>
          </div>
          <div className="min-w-0 space-y-2">
            <ControlBar>
              <SegmentControl label="Timeframe" value={controls.eigenTimeframe} options={CORRELATION_TIMEFRAMES.map((t) => ({ value: t, label: t }))} onChange={(v) => set("eigenTimeframe", v)} />
            </ControlBar>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={eigenChart} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="component" {...AXIS} />
                <YAxis {...AXIS} width={40} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
                <Tooltip {...TOOLTIP} labelFormatter={(c) => `component ${c}`} formatter={(value: number, name: string) => [`${fmt(value * 100, 2)}%`, name]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="raw" name="● raw returns" fill={OKABE.orange} isAnimationActive={false} />
                <Bar dataKey="residual" name="◆ currency-leg residuals" fill={OKABE.blue} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-neutral-400">Share of variance per eigen component of the {controls.eigenTimeframe} correlation matrix.</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <ControlBar>
              <SegmentControl label="Matrix" value={controls.eigenMatrix} options={[{ value: "raw", label: "raw" }, { value: "residual", label: "residual" }]} onChange={(v) => set("eigenMatrix", v)} />
              <SliderControl label="Components summed (k)" value={Math.min(controls.eigenStep, Math.max(1, steps.length))} min={1} max={Math.max(1, steps.length)} onChange={(v) => set("eigenStep", v)} />
            </ControlBar>
            <div className="mt-2 flex flex-wrap gap-0.5">
              {steps.map((s) => (
                <button
                  key={s.component}
                  type="button"
                  onClick={() => set("eigenStep", s.component)}
                  title={`component ${s.component}: eigenvalue ${fmt(s.eigenvalue, 4)}`}
                  className={`rounded px-1 py-0.5 font-mono text-[10px] ${step && s.component <= step.component ? "bg-[#E69F00]/30 text-neutral-50" : "bg-neutral-800 text-neutral-500"}`}
                >
                  λ{s.component}={fmt(s.eigenvalue, 2)}
                </button>
              ))}
            </div>
          </div>
          <FormulaCard
            tex={"\\mathrm{PR} = \\frac{\\left(\\sum_{i=1}^{k} \\lambda_i\\right)^2}{\\sum_{i=1}^{k} \\lambda_i^2}"}
            caption={`Stepped over the first ${step?.component ?? 0} of ${steps.length} eigenvalues of the ${controls.eigenTimeframe} ${controls.eigenMatrix} matrix; at k = ${steps.length} it equals the stored ${fmt(stored?.participation_ratio, 4)}.`}
            symbols={[
              { tex: "\\mathrm{PR}", name: "participation ratio: effective number of independent directions", value: fmt(step?.runningRatio, 4) },
              { tex: "\\lambda_i", name: "i-th eigenvalue of the pair correlation matrix", value: `λ${step?.component ?? "—"} = ${fmt(step?.eigenvalue, 4)}` },
              { tex: "k", name: "components summed so far", value: String(step?.component ?? 0) },
              { tex: "\\sum \\lambda_i", name: "running sum of eigenvalues (total is the pair count, 18)", value: fmt(step?.runningSum, 4) },
              { tex: "\\sum \\lambda_i^2", name: "running sum of squared eigenvalues", value: fmt(step?.runningSumOfSquares, 4) },
            ]}
          />
        </div>
      </Section>

      <Section title="Body versus tail" question="Mean absolute correlation per timeframe: raw, after the currency legs, and when both pairs move in their own top decile.">
        <div className="grid gap-3 xl:grid-cols-2">
          <DataTable
            rows={body.bodyVersusTail}
            rowKey={(row) => row.timeframe}
            columns={[
              { key: "timeframe", label: "timeframe", align: "left" },
              { key: "mean_absolute_raw", label: "mean |raw|", cell: (row) => fmt(row.mean_absolute_raw, 3) },
              { key: "mean_absolute_residual", label: "mean |residual|", cell: (row) => fmt(row.mean_absolute_residual, 3) },
              { key: "mean_absolute_tail", label: "mean |tail|", cell: (row) => fmt(row.mean_absolute_tail, 3) },
              { key: "pair_combination_count", label: "pair combinations", cell: (row) => fmtInt(row.pair_combination_count) },
            ]}
          />
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={bodyTailChart} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="timeframe" {...AXIS} />
                <YAxis {...AXIS} width={36} domain={[0, 1]} />
                <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [fmt(value, 3), name]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="raw" name="● raw" fill={OKABE.orange} isAnimationActive={false} />
                <Bar dataKey="residual" name="◆ residual" fill={OKABE.blue} isAnimationActive={false} />
                <Bar dataKey="tail" name="▲ tail" fill={OKABE.purple} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <Finding>
          {body.bodyVersusTail.map((row) => `${row.timeframe}: tail ${fmt(row.mean_absolute_tail, 3)} against raw ${fmt(row.mean_absolute_raw, 3)} and residual ${fmt(row.mean_absolute_residual, 3)}`).join("; ")}.
          Where the tail reads above the raw body, two positions that look like separate bets on an ordinary day become one bet when both move hard.
        </Finding>
      </Section>

      <Section title="The correlation matrix" question={`${measure.label} at ${controls.correlationTimeframe}, every pair against every pair. × marks a residual that is not identifiable.`}>
        <ControlBar>
          <SegmentControl label="Timeframe" value={controls.correlationTimeframe} options={CORRELATION_TIMEFRAMES.map((t) => ({ value: t, label: t }))} onChange={(v) => set("correlationTimeframe", v)} />
          <SelectControl label="Measure" value={controls.correlationMeasure} options={MEASURES.map((m) => ({ value: m.value, label: m.label }))} onChange={(v) => set("correlationMeasure", v)} />
        </ControlBar>
        <div className="mt-2">
          <MatrixGrid
            rowLabels={pairs}
            columnLabels={pairs}
            rowLabelWidth={60}
            cellHeight={18}
            value={(r, c) => (r === c ? null : numberOf(lookup.get(`${pairs[r]}|${pairs[c]}`), measure.value))}
            colour={(value) => divergingColour(value, 1)}
            format={(value) => fmt(value, 3)}
            glyph={(r, c) => (r !== c && lookup.get(`${pairs[r]}|${pairs[c]}`)?.residual_identifiable === false ? "×" : null)}
            describe={(r, c) => {
              const row = lookup.get(`${pairs[r]}|${pairs[c]}`);
              if (!row) return null;
              return `shared ${row.shared_currency || "none"} · n ${fmtInt(row.observation_count)}${row.residual_identifiable ? "" : " · residual not identifiable"}`;
            }}
            legend={<ScaleLegend low={-1} high={1} colour={(v) => divergingColour(v, 1)} lowLabel="▼ −1 (blue)" highLabel="+1 (orange) ▲" />}
          />
        </div>
      </Section>

      <Section title="Read the identifiability flag before the residual">
        <Finding>
          NZD and CAD each appear in only two pairs, so those two combinations share a one-dimensional residual space and their residual correlation is forced to plus or minus
          one as arithmetic, not as measurement. They are flagged rather than deleted ({body.unidentifiable.length} rows across the timeframes):
        </Finding>
        <div className="mt-2">
          <DataTable
            rows={body.unidentifiable}
            rowKey={(row) => `${row.timeframe}|${row.pair_a}|${row.pair_b}`}
            columns={[
              { key: "pair_a", label: "pair a", align: "left" },
              { key: "pair_b", label: "pair b", align: "left" },
              { key: "shared_currency", label: "shared currency", align: "left" },
              { key: "timeframe", label: "timeframe", align: "left" },
              { key: "correlation_residual_pearson", label: "residual correlation", cell: (row) => fmt(row.correlation_residual_pearson, 4) },
            ]}
          />
        </div>
      </Section>

      <Section title="The most mechanical pair combinations" question="The largest raw correlations among identifiable combinations, with how much the shared currency leg explains.">
        <ControlBar>
          <SegmentControl label="Timeframe" value={controls.mechanicalTimeframe} options={CORRELATION_TIMEFRAMES.map((t) => ({ value: t, label: t }))} onChange={(v) => set("mechanicalTimeframe", v)} />
          <SliderControl label="Show top" value={controls.mechanicalCount} min={3} max={60} onChange={(v) => set("mechanicalCount", v)} />
        </ControlBar>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <DataTable
            rows={mechanical}
            rowKey={(row) => `${row.pair_a}|${row.pair_b}`}
            columns={[
              { key: "pair_a", label: "pair a", align: "left" },
              { key: "pair_b", label: "pair b", align: "left" },
              { key: "shared_currency", label: "shared", align: "left" },
              { key: "correlation_raw_pearson", label: "raw", cell: (row) => fmt(row.correlation_raw_pearson, 3) },
              { key: "correlation_residual_pearson", label: "residual", cell: (row) => fmt(row.correlation_residual_pearson, 3) },
              { key: "correlation_tail_decile", label: "tail", cell: (row) => fmt(row.correlation_tail_decile, 3) },
              { key: "mechanical_share", label: "mechanical share", cell: (row) => fmt(row.mechanical_share, 3) },
            ]}
          />
          <FormulaCard
            tex={"m = 1 - \\frac{\\lvert \\rho_{\\text{residual}} \\rvert}{\\lvert \\rho_{\\text{raw}} \\rvert}"}
            caption={top ? `${top.pair_a} with ${top.pair_b} at ${top.timeframe}, the top row.` : undefined}
            symbols={[
              { tex: "m", name: "mechanical share: fraction of the raw correlation the shared currency leg explains", value: fmt(mechanicalShare(top?.correlation_raw_pearson ?? null, top?.correlation_residual_pearson ?? null), 4) },
              { tex: "\\rho_{\\text{raw}}", name: "Pearson correlation of the two pairs' log returns", value: fmt(top?.correlation_raw_pearson, 4) },
              { tex: "\\rho_{\\text{residual}}", name: "correlation left after regressing both on the eight currency factor returns", value: fmt(top?.correlation_residual_pearson, 4) },
            ]}
          />
        </div>
      </Section>
    </>
  );
}
