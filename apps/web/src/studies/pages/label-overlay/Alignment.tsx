/**
 * The alignment check: every stored label recomputed from the joined bars,
 * over all rows, not just the plotted window. A chart can hide a one-bar
 * shift; these counts cannot. The negative control (the direction column
 * moved one bar) must FAIL, otherwise the check proves nothing.
 *
 * The formula cards step through the same comparison on the window on screen,
 * one bar at a time, with the running total of mismatches.
 */

import { useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { FormulaCard, OKABE, SegmentControl, SliderControl, fmt, fmtInt } from "@/studies/kit";
import { DIRECTION_HORIZONS, directionColumn, directionMismatchTerms, forwardReturnColumn, type AlignmentCheck, type DatasetBody, type WindowRow } from "@shared/studies/label-overlay";

function Badge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-[#56B4E9]"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />{yes}</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[#D55E00]"><AlertTriangle className="h-3 w-3" aria-hidden="true" />{no}</span>
  );
}

function CheckTable({ checks, control }: { checks: readonly AlignmentCheck[]; control: AlignmentCheck | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono tnum">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-0.5 font-normal">stored column</th>
            <th className="py-0.5 font-normal">recomputed as</th>
            <th className="py-0.5 text-right font-normal">tolerance</th>
            <th className="py-0.5 text-right font-normal">compared</th>
            <th className="py-0.5 text-right font-normal">mismatches</th>
            <th className="py-0.5 pl-3 font-normal">verdict</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.stored} className="border-t border-neutral-900">
              <td className="py-0.5 pr-2 text-neutral-200" title={check.name}>{check.stored}</td>
              <td className="py-0.5 pr-2 font-sans text-neutral-400">{check.rule}</td>
              <td className="py-0.5 text-right text-neutral-400">{check.tolerance === null ? "exact" : check.tolerance.toExponential(0)}</td>
              <td className="py-0.5 text-right text-neutral-200">{fmtInt(check.compared)}</td>
              <td className="py-0.5 text-right text-neutral-200">{fmtInt(check.mismatches)}</td>
              <td className="py-0.5 pl-3 font-sans"><Badge ok={check.mismatches === 0} yes="reproduces" no="disagrees" /></td>
            </tr>
          ))}
          {control && (
            <tr className="border-t-2 border-neutral-700">
              <td className="py-0.5 pr-2 text-neutral-200" title={control.name}>{control.stored} shifted</td>
              <td className="py-0.5 pr-2 font-sans text-neutral-400">negative control: {control.rule}</td>
              <td className="py-0.5 text-right text-neutral-400">exact</td>
              <td className="py-0.5 text-right text-neutral-200">{fmtInt(control.compared)}</td>
              <td className="py-0.5 text-right text-neutral-200">{fmtInt(control.mismatches)}</td>
              <td className="py-0.5 pl-3 font-sans"><Badge ok={control.mismatches > 0} yes="PASS: the check can fail" no="FAIL: the check is vacuous" /></td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function value(v: number | null | undefined, decimals = 4): string {
  return v === null || v === undefined ? "unknown" : fmt(v, decimals);
}

function Stepper({ rows }: { rows: readonly WindowRow[] }) {
  const horizons = DIRECTION_HORIZONS.filter((h) => h < rows.length - 1);
  const [horizon, setHorizon] = useState<number>(15);
  const [index, setIndex] = useState(0);
  const H = horizons.includes(horizon as (typeof DIRECTION_HORIZONS)[number]) ? horizon : (horizons[0] ?? 1);
  const terms = directionMismatchTerms(rows, H);
  const i = Math.min(index, Math.max(0, rows.length - 1));
  const term = terms[i];
  const here = rows[i];
  const ahead = rows[i + H];
  const last = terms[terms.length - 1];
  const returnStored = here?.[forwardReturnColumn(H)] ?? null;
  const returnRecomputed = here && ahead ? Math.log(ahead.close) - Math.log(here.close) : null;
  const inWindow = term?.recomputed !== null && term?.recomputed !== undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2">
        <SegmentControl label="Horizon H (bars ahead)" value={H} options={horizons.map((h) => ({ value: h, label: String(h) }))} onChange={setHorizon} />
        <SliderControl label="Bar i in this window" value={i} min={0} max={Math.max(0, rows.length - 1)} onChange={setIndex} hint="Step through the terms of the sum one bar at a time" />
        <div className="flex gap-1 pb-0.5">
          <button type="button" className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800" onClick={() => setIndex(Math.max(0, i - 1))}>Step back</button>
          <button type="button" className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800" onClick={() => setIndex(Math.min(rows.length - 1, i + 1))}>Step forward</button>
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <FormulaCard
          tex={String.raw`\mathrm{mismatches}(H)=\sum_{i=0}^{n-H-1}\mathbf{1}\!\left[\,d_i^{(H)}\neq\mathbf{1}\!\left[c_{i+H}>c_i\right]\right]`}
          caption="Direction label: 1 when the close H bars ahead is above this close, else 0. Each term is 0 when the stored label reproduces."
          symbols={[
            { tex: String.raw`\sum`, name: "sum over every bar of the window that has a bar H ahead", value: `i = 0 to ${rows.length - H - 1}` },
            { tex: "i", name: "bar index inside this window", value: String(i) },
            { tex: "n", name: "bars in the window", value: String(rows.length) },
            { tex: "H", name: "horizon: bars ahead", value: String(H) },
            { tex: String.raw`d_i^{(H)}`, name: `stored ${directionColumn(H)} of bar i (1 up, 0 down)`, value: value(term?.stored, 0) },
            { tex: "c_i", name: "close of bar i, in points", value: value(here?.close, 2) },
            { tex: "c_{i+H}", name: "close of the bar H ahead, in points", value: value(ahead?.close, 2) },
            { tex: String.raw`\mathbf{1}[\cdot]`, name: "indicator: 1 when the statement holds, else 0", value: inWindow ? `recomputed ${term?.recomputed}` : "no bar H ahead in this window" },
            { tex: String.raw`\mathrm{term}_i`, name: "this bar's term of the sum", value: term?.mismatch === null || term?.mismatch === undefined ? "not compared" : String(term.mismatch) },
            { tex: String.raw`\mathrm{mismatches}(H)`, name: "total through bar i, then through the whole window", value: `${term?.runningMismatches ?? 0} of ${term?.runningCompared ?? 0}, then ${last?.runningMismatches ?? 0} of ${last?.runningCompared ?? 0}` },
          ]}
        />
        <FormulaCard
          tex={String.raw`\left|\,r_i^{(H)}-\left(\ln c_{i+H}-\ln c_i\right)\right|\le\varepsilon`}
          caption="Forward log return: the stored column must equal the log ratio of the two closes, to a tolerance."
          symbols={[
            { tex: String.raw`r_i^{(H)}`, name: `stored ${forwardReturnColumn(H)} of bar i`, value: H === 15 || H === 60 || H === 240 || H === 1440 ? value(returnStored, 6) : "not stored at this horizon" },
            { tex: String.raw`\ln`, name: "natural logarithm", value: "base e" },
            { tex: "c_i", name: "close of bar i, in points", value: value(here?.close, 2) },
            { tex: "c_{i+H}", name: "close of the bar H ahead, in points", value: value(ahead?.close, 2) },
            { tex: String.raw`\ln c_{i+H}-\ln c_i`, name: "recomputed forward log return", value: value(returnRecomputed, 6) },
            { tex: String.raw`\varepsilon`, name: "tolerance for a float32-stored column", value: "0.00001" },
          ]}
        />
      </div>
      <p className="text-[11px] text-neutral-500">
        Bar {i} of {rows.length}: {inWindow ? "both sides are known" : "the bar H ahead lies beyond this window, so the term is not compared here (the full-dataset table above compares it)"}.
      </p>
    </div>
  );
}

export function AlignmentSection({ dataset, rows }: { dataset: DatasetBody; rows: readonly WindowRow[] }) {
  const failing = dataset.alignmentChecks.filter((check) => check.mismatches > 0).length;
  const compared = dataset.alignmentChecks.reduce((sum, check) => sum + check.compared, 0);
  const control = dataset.negativeControl;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-neutral-300">
        <span style={{ color: failing === 0 ? OKABE.sky : OKABE.vermillion }}>
          {failing === 0 ? "Every stored label reproduces from its own bars" : `${failing} of ${dataset.alignmentChecks.length} checks disagree`}
        </span>
        <span className="font-mono tnum text-neutral-400">{fmtInt(compared)} comparisons over {fmtInt(dataset.joinedRows)} joined rows</span>
        {control && <span className="font-mono tnum text-neutral-400">control: {fmtInt(control.mismatches)} mismatches when shifted one bar</span>}
      </div>
      <CheckTable checks={dataset.alignmentChecks} control={control} />
      {rows.length > 2 && <Stepper rows={rows} />}
    </div>
  );
}
