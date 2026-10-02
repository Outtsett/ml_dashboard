/**
 * When does a moving average stop being an average? The Holt-Winters moving
 * average (HWMA) carries a level, a velocity and an acceleration. The sliders
 * re-run the recursion on 2,000 real MNQH6 closes and re-solve the state
 * matrix's eigenvalues in the browser (packages/shared/src/studies/hwma-stability.ts);
 * the landed grid of 6,859 (na, nb, nc) measurements supplies the boundary
 * heatmap, the per-nc counts and the per-column profiles.
 */

import {
  ControlBar, Empty, Finding, FormulaCard, OKABE, Section, SliderControl, Stat, StudyNotes, StudyState,
  SwitchControl, fmt, fmtInt, fmtTime, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { BoundaryHeatmap, OutcomeCounts } from "./Boundary";
import { ColumnPanels } from "./Columns";
import { EigenPlane } from "./EigenPlane";
import { PriceChart } from "./PriceChart";
import { fmtWide, signed } from "./format";
import {
  countsByAcceleration, eigenvalues, emittedLevel, gridRowAt, hwmaRun, onGrid, stateMatrix,
  type ComplexNumber, type HwmaStabilityBody,
} from "@shared/studies/hwma-stability";

const DEFAULTS = { na: 0.2, nb: 0.1, nc: 0.1, guard: true, bar: 1999 };

const FORMULA = String.raw`\begin{aligned}
F_t &= (1-n_a)\left(F_{t-1}+V_{t-1}+\tfrac{1}{2}A_{t-1}\right)+n_a C_t\\
V_t &= (1-n_b)\left(V_{t-1}+A_{t-1}\right)+n_b\left(F_t-F_{t-1}\right)\\
A_t &= (1-n_c)A_{t-1}+n_c\left(V_t-V_{t-1}\right)
\end{aligned}`;

function describeEigenvalue(value: ComplexNumber): string {
  if (Math.abs(value.imaginary) > 1e-9) return `${signed(value.real)}${value.imaginary < 0 ? "-" : "+"}${Math.abs(value.imaginary).toFixed(4)}i`;
  return signed(value.real);
}

export default function Page() {
  const [controls, set, reset] = useStudyControls(DEFAULTS);
  const query = useStudyQuery<HwmaStabilityBody>("hwma-stability");
  const body = query.data?.data;
  const prices = body?.prices ?? [];
  const grid = body?.grid ?? [];
  const info = body?.runInformation ?? null;
  const ready = prices.length > 0 && grid.length > 0;

  const na = onGrid(controls.na);
  const nb = onGrid(controls.nb);
  const nc = onGrid(controls.nc);
  const closes = prices.map((price) => price.close);
  const rangeMultiple = info?.range_multiple ?? 10;
  const run = hwmaRun(closes, na, nb, nc, rangeMultiple);
  const matrix = stateMatrix(na, nb, nc);
  const values = eigenvalues(matrix);
  const radius = Math.max(0, ...values.map((value) => Math.hypot(value.real, value.imaginary)));
  const last = Math.max(0, closes.length - 1);
  const scrubbed = Math.min(Math.max(0, Math.round(controls.bar)), last);
  const average = emittedLevel(run, controls.guard);
  const landed = gridRowAt(grid, na, nb, nc);
  const slice = grid.filter((row) => Math.abs(row.nc - nc) < 1e-9);
  const counts = countsByAcceleration(grid);

  const unstableCount = grid.filter((row) => !row.spectrally_stable).length;
  const negativeCount = grid.filter((row) => row.went_negative_unbounded).length;
  const stoppedCount = grid.filter((row) => row.left_range_at_bar !== null).length;
  const defaultRadius = info?.default_spectral_radius ?? null;

  const stable = radius < 1;
  const finalLevel = run.level[last] ?? NaN;
  const matchesLanded = landed !== null && Math.abs(landed.spectral_radius - radius) < 1e-9 && landed.left_range_at_bar === run.leftAt;

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!ready ? (
          <Empty>
            The HWMA stability tables are not in the lake yet. Land them with{" "}
            <code>E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/hwma_stability/build.py</code>, then refresh the derived views.
          </Empty>
        ) : (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
              <Stat label="Combinations measured" value={fmtInt(grid.length)} hint={`na, nb, nc each 0.05 to 0.95 in steps of ${info?.grid_step ?? 0.05}`} />
              <Stat label="Spectrally unstable" value={`${fmtInt(unstableCount)}  (${fmt((100 * unstableCount) / grid.length, 1)}%)`} tone={OKABE.orange} hint="spectral radius of the state matrix at or above 1" />
              <Stat label="Go negative, unbounded" value={fmtInt(negativeCount)} tone={OKABE.blue} hint="a price average that dips below zero if nothing stops it" />
              <Stat label="Stopped early by the bound" value={fmtInt(stoppedCount)} hint={`the average left ${fmt(rangeMultiple, 0)} data ranges beyond the closes, where the chart stops drawing it`} />
              <Stat label="Default spectral radius" value={fmt(defaultRadius, 4)} hint={`default (${info?.default_na}, ${info?.default_nb}, ${info?.default_nc}) tracks price`} />
            </div>
            <Finding>
              The Holt-Winters average carries three states, a level, a velocity and an acceleration, and each bar blends "carry the old estimate forward" with
              "correct toward the price that just printed". Drop the carry weights and it stops being an average: the level integrates velocity, velocity integrates
              acceleration, and acceleration feeds back positively. That is what the chart's HWMA did until 2026-09-15: on these {fmtInt(prices.length)} real {info?.symbol}{" "}
              closes it passed a million by bar 105 and reached 1e93, far outside the 9.007e13 a chart value may take, so the whole Market page rendered as an error.
              Corrected, it is a proper Holt-Winters and still not unconditionally safe: of {fmtInt(grid.length)} combinations, {fmtInt(unstableCount)} are unstable and{" "}
              {fmtInt(negativeCount)} drive a price average below zero if nothing stops them. The default ({info?.default_na}, {info?.default_nb}, {info?.default_nc}) has spectral radius{" "}
              {fmt(defaultRadius, 4)} and tracks price.
            </Finding>

            <Section title="The recursion and its state matrix" question="Move the three correction weights; the matrix, its eigenvalues and the line below recompute.">
              <ControlBar onReset={reset}>
                <SliderControl label="na, level correction" value={na} min={0.05} max={0.95} step={0.05} onChange={(v) => set("na", onGrid(v))} format={(v) => v.toFixed(2)} hint="how hard the level is pulled to price; 1 follows price exactly" />
                <SliderControl label="nb, velocity correction" value={nb} min={0.05} max={0.95} step={0.05} onChange={(v) => set("nb", onGrid(v))} format={(v) => v.toFixed(2)} hint="how hard velocity is re-estimated from the level's move" />
                <SliderControl label="nc, acceleration correction" value={nc} min={0.05} max={0.95} step={0.05} onChange={(v) => set("nc", onGrid(v))} format={(v) => v.toFixed(2)} hint="how hard acceleration is re-estimated from velocity's move" />
                <SliderControl label="Bar t (symbol values)" value={scrubbed} min={0} max={last} step={1} onChange={(v) => set("bar", v)} format={(v) => String(v)} hint="the bar whose level, velocity and acceleration the legend shows" />
                <SwitchControl label="Stop emitting once it leaves the data's range (what the chart does)" checked={controls.guard} onChange={(v) => set("guard", v)} />
              </ControlBar>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 space-y-3">
                  <FormulaCard
                    tex={FORMULA}
                    caption={`Every symbol holds the value it carries at bar t = ${scrubbed} (${fmtTime(prices[scrubbed]?.timestamp_ms)}, stamped clock), unbounded recursion.`}
                    symbols={[
                      { tex: "F_t", name: "level: the average itself, what the chart draws (points)", value: fmtWide(run.level[scrubbed] ?? null) },
                      { tex: "V_t", name: "velocity: how fast the level is moving (points per bar)", value: fmtWide(run.velocity[scrubbed] ?? null) },
                      { tex: "A_t", name: "acceleration: how fast the velocity is changing (points per bar squared)", value: fmtWide(run.acceleration[scrubbed] ?? null) },
                      { tex: "C_t", name: "close: the price this bar printed (points)", value: fmtWide(closes[scrubbed] ?? null) },
                      { tex: "n_a", name: "level correction: how hard the level is pulled to price (share, 1 follows price)", value: na.toFixed(2) },
                      { tex: "n_b", name: "velocity correction: how hard velocity is re-estimated from the level's move (share)", value: nb.toFixed(2) },
                      { tex: "n_c", name: "acceleration correction: how hard acceleration is re-estimated from velocity's move (share)", value: nc.toFixed(2) },
                      { tex: "\\rho", name: "spectral radius: largest eigenvalue modulus of the state matrix; below 1 decays, 1 or more compounds (ratio)", value: radius.toFixed(4) },
                    ]}
                  />
                  <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
                    <div className="mb-1 text-[11px] font-medium text-neutral-100">State matrix at these settings (next state from previous state)</div>
                    <table className="w-full text-[11px] font-mono tnum">
                      <thead>
                        <tr className="text-neutral-500">
                          <th className="py-0.5 text-left font-normal" />
                          <th className="py-0.5 text-right font-normal">level (t-1)</th>
                          <th className="py-0.5 text-right font-normal">velocity (t-1)</th>
                          <th className="py-0.5 text-right font-normal">acceleration (t-1)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(["level (t)", "velocity (t)", "acceleration (t)"] as const).map((label, row) => (
                          <tr key={label} className="border-t border-neutral-900">
                            <td className="py-0.5 text-neutral-400">{label}</td>
                            {matrix[row]!.map((cell, column) => (
                              <td key={column} className="py-0.5 text-right text-neutral-200">{signed(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-[11px] text-neutral-300">Eigenvalues: <span className="font-mono">{values.map(describeEigenvalue).join(",  ")}</span></p>
                  </div>
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-start gap-3">
                    <EigenPlane eigenvalues={values} radius={radius} />
                    <div className="min-w-[10rem] flex-1 space-y-1">
                      <p className="text-[12px] text-neutral-100">
                        <span className="font-semibold">{stable ? "Stable" : "Unstable"}</span>{" "}
                        <span className="font-mono">(rho = {radius.toFixed(4)} {stable ? "< 1" : ">= 1"})</span>{" "}
                        <span aria-hidden="true">{stable ? "●" : "▲"}</span>
                      </p>
                      <Finding>
                        {stable
                          ? `Every shock decays, so the line below tracks price for all ${fmtInt(prices.length)} bars.`
                          : "Every shock compounds: the recursion feeds its own error back with a gain above one."}
                        {run.leftAt !== null &&
                          ` It leaves the data's range at bar ${fmtInt(run.leftAt)}, which is where the chart stops drawing it; unbounded it reaches ${fmtWide(finalLevel, 3)} by the last bar.`}
                      </Finding>
                      {landed ? (
                        <p className="text-[11px] text-neutral-400">
                          The landed measurement at these settings: rho {landed.spectral_radius.toFixed(4)}, {landed.left_range_at_bar === null ? "never left the range" : `left at bar ${fmtInt(landed.left_range_at_bar)}`}, unbounded minimum {fmtWide(landed.unbounded_minimum)}, maximum {fmtWide(landed.unbounded_maximum)}.{" "}
                          <span className={matchesLanded ? "text-neutral-200" : "text-[#E69F00]"}>{matchesLanded ? "Matches the live recursion." : "Differs from the live recursion."}</span>
                        </p>
                      ) : (
                        <p className="text-[11px] text-neutral-500">These settings are off the 0.05 grid, so there is no landed measurement to compare.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Price and the average" question={`${info?.symbol}, ${fmtInt(prices.length)} one-minute closes with volume, ${fmtTime(prices[0]?.timestamp_ms)} to ${fmtTime(prices[last]?.timestamp_ms)} (stamped clock).`}>
              <PriceChart
                prices={prices}
                average={average}
                leftAt={run.leftAt}
                scrubbedBar={scrubbed}
                title={`price and the average, rho = ${radius.toFixed(4)}`}
              />
              <Finding>
                {controls.guard
                  ? "With the guard on the average is blanked from the bar it leaves the data's range, as the chart does. Turn it off to see what the recursion would have drawn."
                  : "With the guard off the recursion runs to the last bar. An unstable setting scales the axis to its own divergence, so the closes flatten into a line."}
              </Finding>
            </Section>

            <Section title="The stability boundary" question="Each cell is one (na, nb) pair at the nc you chose; blue decays back toward price after a shock, hatched orange compounds. The right panel counts what the recursion actually did on the real closes at each nc.">
              <div className="grid gap-4 xl:grid-cols-2">
                <BoundaryHeatmap slice={slice} nc={nc} na={na} nb={nb} onPick={(nextNa, nextNb) => { set("na", onGrid(nextNa)); set("nb", onGrid(nextNb)); }} />
                <OutcomeCounts counts={counts} nc={nc} />
              </div>
              <Finding>
                At nc = {nc.toFixed(2)}, {fmtInt(slice.filter((row) => !row.spectrally_stable).length)} of {fmtInt(slice.length)} (na, nb) pairs are unstable and{" "}
                {fmtInt(slice.filter((row) => row.went_negative_unbounded).length)} would drive a price average below zero. The count of unstable pairs rises with nc from none at 0.05
                to {fmtInt(counts[counts.length - 1]?.unstable)} of {fmtInt(counts[counts.length - 1]?.combinations)} at 0.95.
              </Finding>
            </Section>

            <Section title="Every column of the measurement" question="One panel per numeric column of the landed grid, with the eight numbers beneath it. The long tails are the unstable corner: a handful of parameter sets reach values no price series could justify, which is why the chart now stops drawing once the line leaves the data's range.">
              <ColumnPanels rows={grid} />
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
