/**
 * Audit record: the 72-notebook audit that preceded the model (what each
 * established, whether it could be used), the three edge claims that were
 * re-checked, and the overfitting report over the six development trials
 * (deflated Sharpe and the probability of backtest overfitting).
 */

import { Fragment, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { deflatedSharpeProbability, trialLabel, type AuditRow, type MultimodalBody } from "@shared/studies/multimodal-model";
import {
  AXIS, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SelectControl, Stat, SwitchControl, TOOLTIP, fmt, fmtInt, fmtPercent,
} from "@/studies/kit";
import type { TabProps } from "./controls";

const PAGE_SIZE = 15;

const EVIDENCE_ORDER = ["strong", "moderate", "weak", "none", "n/a"];
const EVIDENCE_MARK: Record<string, string> = { strong: "◆◆◆", moderate: "◆◆", weak: "◆", none: "○", "n/a": "–" };

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}

function AuditTable({ rows, page, set }: { rows: AuditRow[]; page: number } & Pick<TabProps, "set">) {
  const [open, setOpen] = useState<string | null>(null);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[11px]">
          <thead className="text-left text-neutral-500">
            <tr>
              {["notebook", "used for training", "edge evidence", "look-ahead risk", "costs", "out of sample"].map((label) => (
                <th key={label} className="py-1 pr-2 font-normal">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.path}>
                <tr onClick={() => setOpen(open === row.path ? null : row.path)} className="cursor-pointer border-t border-neutral-900 align-top hover:bg-neutral-900" title={row.path}>
                  <td className="py-1 pr-2 text-neutral-100">{open === row.path ? "▾" : "▸"} {shortPath(row.path)}</td>
                  <td className="py-1 pr-2 text-neutral-300">{row.relevant_to_training === null ? "—" : row.relevant_to_training ? "yes" : "no"}</td>
                  <td className="py-1 pr-2 font-mono text-neutral-200">{EVIDENCE_MARK[row.edge_evidence ?? ""] ?? ""} {row.edge_evidence ?? "—"}</td>
                  <td className="py-1 pr-2 text-neutral-300">{row.lookahead_risk ?? "—"}</td>
                  <td className="py-1 pr-2 text-neutral-300">{row.costs_included ?? "—"}</td>
                  <td className="py-1 pr-2 text-neutral-300">{row.out_of_sample ?? "—"}</td>
                </tr>
                {open === row.path && (
                  <tr className="bg-neutral-900/60">
                    <td colSpan={6} className="space-y-1 px-3 py-2 text-[11px] text-neutral-300">
                      <p><b className="text-neutral-100">What it established.</b> {row.edge_summary ?? "—"}</p>
                      <p><b className="text-neutral-100">Recommendation.</b> {row.recommendation ?? "—"}</p>
                      {row.topic && <p className="text-neutral-500">Topic: {row.topic}</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-[11px] text-neutral-400">
        <span>{fmtInt(rows.length)} notebooks · page {current} of {pages}</span>
        <span className="flex gap-1">
          <button type="button" disabled={current <= 1} onClick={() => set("auditPage", current - 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">◀ previous</button>
          <button type="button" disabled={current >= pages} onClick={() => set("auditPage", current + 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">next ▶</button>
        </span>
      </div>
    </div>
  );
}

function OverfittingSection({ body }: { body: MultimodalBody }) {
  const { summary, trials } = body.overfitting;
  if (!summary) return <Empty>The overfitting report is not landed (derived_multimodal_overfitting_summary).</Empty>;
  const recomputed = deflatedSharpeProbability(
    summary.best_daily_sharpe ?? Number.NaN,
    summary.expected_maximum_daily_sharpe_of_null_trials ?? Number.NaN,
    summary.sessions ?? Number.NaN,
    summary.skewness ?? Number.NaN,
    summary.kurtosis ?? Number.NaN,
  );
  const bars = trials.map((trial) => ({ ...trial, label: trialLabel(trial.trial) }));
  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Deflated Sharpe probability" value={fmt(summary.deflated_sharpe_probability, 4)} tone={OKABE.blue} hint="probability the best trial's true Sharpe is above zero once the search over trials is accounted for" />
        <Stat label="Probability of backtest overfitting" value={fmtPercent(summary.pbo, 1)} hint={`share of ${fmtInt(summary.combinations)} train/test splits in which the in-sample best trial lands below the out-of-sample median`} />
        <Stat label="Best trial, annualised Sharpe" value={fmt(summary.best_annualised_sharpe, 3)} hint={summary.best_trial ? trialLabel(summary.best_trial) : undefined} />
        <Stat label="Expected best Sharpe of null trials (daily)" value={fmt(summary.expected_maximum_daily_sharpe_of_null_trials, 4)} hint={`what the best of ${summary.trials} trials with no edge would show by luck`} />
      </div>
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={bars} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="label" {...AXIS} angle={-40} textAnchor="end" height={52} interval={0} />
              <YAxis {...AXIS} width={48} tickFormatter={(value: number) => fmt(value, 3)} />
              <ReferenceLine y={0} stroke={OKABE.grey} />
              <ReferenceLine
                y={summary.expected_maximum_daily_sharpe_of_null_trials ?? 0}
                stroke={OKABE.orange}
                strokeDasharray="6 4"
                label={{ value: "best of luck", fill: OKABE.orange, fontSize: 9, position: "insideTopRight" }}
              />
              <Tooltip {...TOOLTIP} formatter={(value: number) => [fmt(value, 4), "daily Sharpe"]} />
              <Bar dataKey="daily_sharpe" isAnimationActive={false}>
                {bars.map((row) => (
                  <Cell key={row.trial} fill={(row.daily_sharpe ?? 0) > 0 ? OKABE.orange : OKABE.blue} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Finding>
            Every trial's daily Sharpe is below zero, so none clears even the luck line of {fmt(summary.expected_maximum_daily_sharpe_of_null_trials, 4)}; the deflated Sharpe probability is {fmt(summary.deflated_sharpe_probability, 3)} and a backtest-overfitting probability of {fmtPercent(summary.pbo, 0)} says the ranking of trials in sample tells nothing about their ranking out of sample.
          </Finding>
        </div>
        <FormulaCard
          tex={"\\mathrm{DSR} \\;=\\; \\Phi\\!\\left( \\frac{(\\widehat{SR} - SR_0)\\,\\sqrt{T-1}}{\\sqrt{1 - \\gamma_3\\,\\widehat{SR} + \\tfrac{\\gamma_4 - 1}{4}\\,\\widehat{SR}^{2}}} \\right)"}
          symbols={[
            { tex: "\\mathrm{DSR}", name: "deflated Sharpe ratio: probability the best trial's true Sharpe ratio is above zero after choosing it from several", value: `${fmt(recomputed, 4)} (stored ${fmt(summary.deflated_sharpe_probability, 4)})` },
            { tex: "\\widehat{SR}", name: "the best trial's daily Sharpe ratio (mean daily net over its standard deviation)", value: fmt(summary.best_daily_sharpe, 4) },
            { tex: "SR_0", name: "expected maximum daily Sharpe of the same number of trials that have no edge", value: fmt(summary.expected_maximum_daily_sharpe_of_null_trials, 4) },
            { tex: "T", name: "number of daily observations (sessions)", value: fmtInt(summary.sessions) },
            { tex: "\\gamma_3", name: "skewness of the best trial's daily returns", value: fmt(summary.skewness, 3) },
            { tex: "\\gamma_4", name: "kurtosis (not excess) of the best trial's daily returns", value: fmt(summary.kurtosis, 3) },
            { tex: "\\Phi", name: "the standard normal cumulative distribution function", value: "—" },
          ]}
          caption="The value is recomputed here from the stored inputs; it agrees with the stored one to four decimals."
        />
      </div>
    </div>
  );
}

export function AuditRecord({ controls, set, body }: TabProps & { body: MultimodalBody }) {
  const audit = body.audit;
  const evidenceValues = [...new Set(audit.map((row) => row.edge_evidence ?? "n/a"))].sort((a, b) => EVIDENCE_ORDER.indexOf(a) - EVIDENCE_ORDER.indexOf(b));
  const needle = controls.search.trim().toLowerCase();
  const filtered = audit.filter(
    (row) =>
      (controls.evidence === "all" || (row.edge_evidence ?? "n/a") === controls.evidence) &&
      (!controls.relevantOnly || row.relevant_to_training === true) &&
      (needle === "" || `${row.path} ${row.edge_summary ?? ""} ${row.recommendation ?? ""} ${row.topic ?? ""}`.toLowerCase().includes(needle)),
  );
  const counts = evidenceValues.map((value) => ({ value, count: audit.filter((row) => (row.edge_evidence ?? "n/a") === value).length }));

  return (
    <div className="space-y-3">
      <Section title={`The notebook audit: ${fmtInt(audit.length)} notebooks, what each established`} question="Done before the model was designed: did any earlier notebook show a tradable edge, with costs, out of sample, without look-ahead? Click a row for what it found and what to do with it.">
        {audit.length === 0 ? (
          <Empty>The audit is not landed (derived_multimodal_notebook_audit_notebooks).</Empty>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-neutral-400">
              {counts.map((row) => (
                <span key={row.value} className="mr-3 font-mono">{EVIDENCE_MARK[row.value] ?? ""} {row.value} {row.count}</span>
              ))}
            </p>
            <ControlBar>
              <SelectControl label="Edge evidence" value={controls.evidence} options={[{ value: "all", label: "all" }, ...evidenceValues.map((value) => ({ value, label: value }))]} onChange={(value) => { set("evidence", value); set("auditPage", 1); }} />
              <SwitchControl label="Used for training only" checked={controls.relevantOnly} onChange={(value) => { set("relevantOnly", value); set("auditPage", 1); }} />
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">Search</span>
                <input
                  value={controls.search}
                  onChange={(event) => { set("search", event.target.value); set("auditPage", 1); }}
                  placeholder="path, finding, recommendation"
                  className="h-7 w-56 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
                />
              </label>
            </ControlBar>
            <AuditTable rows={filtered} page={controls.auditPage} set={set} />
          </div>
        )}
      </Section>

      <Section title="The edge claims that were re-checked" question="Three headline claims from earlier notebooks, re-run against the lake by an independent reader.">
        {body.edgeVerdicts.length === 0 ? (
          <Empty>No edge verdicts are landed.</Empty>
        ) : (
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            {body.edgeVerdicts.map((verdict) => (
              <div key={verdict.path} className="min-w-0 space-y-1 rounded-md border border-neutral-800 bg-neutral-900/40 p-2 text-[11px] text-neutral-300">
                <div className="font-mono text-neutral-100" title={verdict.path}>{shortPath(verdict.path)}</div>
                <p><b className="text-neutral-100">Claim.</b> {verdict.claim}</p>
                <p><b className="text-neutral-100">Holds:</b> <span className="font-mono">{verdict.holds ?? "—"}</span> · usable for design: <span className="font-mono">{verdict.usable_for_design ?? "—"}</span></p>
                <details>
                  <summary className="cursor-pointer text-neutral-400">Reasons and corrected numbers</summary>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {(verdict.reasons ?? "").split(" | ").filter(Boolean).map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                  {verdict.corrected_numbers && <p className="mt-1"><b className="text-neutral-100">Corrected numbers.</b> {verdict.corrected_numbers}</p>}
                </details>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Overfitting report over the development trials" question="The trials were compared and the best one kept; how much of its record could be the luck of having tried several?">
        <OverfittingSection body={body} />
      </Section>
    </div>
  );
}
