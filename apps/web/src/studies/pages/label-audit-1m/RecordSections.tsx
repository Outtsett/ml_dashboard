/**
 * The audit's text sections: section 0 (provenance), 1 (the inventory),
 * 7 (causality: the purge audit and the shift-arithmetic control) and
 * 8 (the synthesis: eight findings, each with its evidence and action).
 */

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, Stat, TOOLTIP, fmt, fmtInt, fmtPercent, fmtTime } from "@/studies/kit";
import type { FindingRow, InventoryRow, LabelAuditBody, PurgeAuditRow } from "@shared/studies/label-audit-1m";
import { DataTable, Legend, Verdict } from "./parts";

export function ProvenanceSection({ body }: { body: LabelAuditBody }) {
  const coverage = body.coverage;
  const provenance = body.provenance;
  return (
    <Section title="0 · Data provenance" question="The lake's MNQ 1m bars against the span-aligned series every statistic below is computed on.">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Stat label="Lake bars (mnq_ohlcv_1m)" value={fmtInt(coverage?.lake_bar_count)} hint={coverage ? `${fmtTime(coverage.lake_first_timestamp)} to ${fmtTime(coverage.lake_last_timestamp)}` : undefined} />
        <Stat label="Labelled, span-aligned bars" value={fmtInt(coverage?.labelled_bar_count)} hint={coverage ? `${fmtTime(coverage.labelled_first_timestamp)} to ${fmtTime(coverage.labelled_last_timestamp)}` : undefined} />
        <Stat label="Clipped by span alignment" value={coverage ? fmtInt(coverage.lake_bar_count - coverage.labelled_bar_count) : "—"} hint="The loader clips every timeframe to the earliest end shared by all of them" />
        <Stat label="The notebook's loader today" value={fmtInt(provenance?.current_loader_bar_count)} tone={provenance && provenance.current_loader_bar_count !== provenance.audited_bar_count ? OKABE.blue : undefined} hint={provenance ? `${provenance.current_loader_first_timestamp.slice(0, 10)} to ${provenance.current_loader_last_timestamp.slice(0, 10)}` : undefined} />
      </div>
      {coverage && (
        <p className="mt-2 text-[11px] text-neutral-400">
          Series: {fmtTime(coverage.labelled_first_timestamp)} to {fmtTime(coverage.labelled_last_timestamp)} (the lake stamps futures in Pacific wall clock).
          {provenance ? ` The landed sweeps were built ${provenance.built_at.slice(0, 16).replace("T", " ")} UTC on ${fmtInt(provenance.audited_bar_count)} bars.` : ""}
        </p>
      )}
    </Section>
  );
}

export function InventorySection({ rows }: { rows: InventoryRow[] }) {
  const labels = rows.filter((row) => row.is_supervised_label);
  return (
    <Section title={`1 · The inventory: ${labels.length} supervised label families`} question="Across model/, analytics/ and blueprint/. Two things that look like labels are not, and are excluded from every statistic: the reinforcement-learning reward (a per-step economic quantity) and cluster ids (unsupervised partitions with no ground truth).">
      <DataTable
        rows={rows}
        rowKey={(row) => `${row.module_path}-${row.label_name}`}
        columns={[
          { header: "module", cell: (row) => <span className="break-all text-neutral-300">{row.module_path}</span> },
          { header: "label", cell: (row) => row.label_name },
          { header: "definition", cell: (row) => <span className="font-sans text-neutral-300">{row.definition}</span> },
          { header: "forward bars", cell: (row) => row.forward_bars },
          { header: "family", cell: (row) => row.family },
          { header: "a label?", cell: (row) => <Verdict ok={row.is_supervised_label} yes="supervised" no="not a label" /> },
        ]}
      />
    </Section>
  );
}

export function CausalitySection({ rows, shift, shiftBars, onShiftBars }: { rows: PurgeAuditRow[]; shift: LabelAuditBody["shift"]; shiftBars: number; onShiftBars: (value: number) => void }) {
  const uncovered = rows.filter((row) => !row.reach_covered).length;
  const leakyShare = shift && shift.comparedCount > 0 ? shift.leakyMismatchCount / shift.comparedCount : null;
  const bars = [
    { name: "honest left shift (lead)", mismatch: 0, maximum: shift?.honestMaximum ?? null },
    { name: "leaky right shift (lag)", mismatch: leakyShare ?? 0, maximum: shift?.leakyMaximum ?? null },
  ];
  return (
    <Section title="7 · Causality: which labels look forward, and by how much" question="Every label except vol_regime reads the future by construction; the question is whether the walk-forward purge covers the full forward reach. max(horizon, 50) is right only when reach equals the horizon.">
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <DataTable
            rows={rows}
            rowKey={(row) => row.script}
            highlight={(row) => !row.reach_covered}
            columns={[
              { header: "script", cell: (row) => row.script },
              { header: "label", cell: (row) => row.label_name },
              { header: "forward reach (bars)", cell: (row) => (row.forward_reach_bars === null ? "varies" : fmtInt(row.forward_reach_bars)), align: "right" },
              { header: "purge as coded", cell: (row) => row.purge_as_coded },
              { header: "reach covered", cell: (row) => <Verdict ok={row.reach_covered} yes="covered" no="uncovered" /> },
            ]}
          />
          <Finding>
            {uncovered} of {rows.length} consumers leave look-ahead in the training set: every swing-label consumer purges by vertical_bars and misses the fractal confirmation (section 6).
          </Finding>
        </div>
        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold text-neutral-200">The shift arithmetic, with a control that must fail</h4>
          <ControlBar>
            <SliderControl label="Shift k (bars)" value={shiftBars} min={1} max={240} onChange={onShiftBars} format={(value) => String(value)} hint="Built on the stored dir_h15 labels" />
          </ControlBar>
          <FormulaCard
            tex={"\\text{lead}_k[i] = y[i+k] \\quad\\text{vs}\\quad \\text{lag}_k[i] = y[i-k]"}
            caption={shift ? `Compared with y[i+k] read from a separate window frame: the honest lead differs by at most ${fmt(shift.honestMaximum, 1)}, the leaky lag by up to ${fmt(shift.leakyMaximum, 1)} on ${fmtPercent(leakyShare, 1)} of ${fmtInt(shift.comparedCount)} bars. ${shift.honestMaximum === 0 && (shift.leakyMaximum ?? 0) > 0 ? "PASS: the check separates them." : "FAIL."}` : undefined}
            symbols={[
              { tex: "y[i]", name: "the stored direction label at bar i, horizon 15", value: "dir_h15" },
              { tex: "k", name: "shift, in bars", value: String(shiftBars) },
              { tex: "\\max|\\text{lead}_k - y[i+k]|", name: "honest left shift against the future bar (must be 0)", value: fmt(shift?.honestMaximum, 1) },
              { tex: "\\max|\\text{lag}_k - y[i+k]|", name: "deliberately leaky right shift (must be non-zero)", value: fmt(shift?.leakyMaximum, 1) },
            ]}
          />
          <Legend items={[{ glyph: "■", label: "share of bars that disagree with y[i+k]", color: OKABE.sky }]} />
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" domain={[0, 1]} tickFormatter={(value: number) => fmtPercent(value, 0)} {...AXIS} />
              <YAxis type="category" dataKey="name" width={150} {...AXIS} />
              <Tooltip {...TOOLTIP} formatter={(value) => [fmtPercent(Number(value), 2), "bars that disagree"]} />
              <Bar dataKey="mismatch" isAnimationActive={false}>
                {bars.map((bar, index) => <Cell key={bar.name} fill={index === 0 ? OKABE.orange : OKABE.blue} />)}
                <LabelList dataKey="mismatch" position="right" formatter={(value: number) => fmtPercent(value, 2)} fill="#a3a3a3" fontSize={9} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Finding>A leakage guard that has never been seen to fail is unverified; this one is shown failing on the wrong shift at every k.</Finding>
        </div>
      </div>
    </Section>
  );
}

export function FindingsSection({ rows }: { rows: FindingRow[] }) {
  return (
    <Section title="8 · Synthesis: eight findings, each with the action it demands" question="Every takeaway is an instruction with a named target. All eight were applied on 2026-08-02; the numbers are the pre-fix measurements that argued for them.">
      <div className="grid min-w-0 gap-2 xl:grid-cols-2">
        {rows.map((row) => (
          <article key={row.finding_number} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
            <header className="flex items-start justify-between gap-2">
              <h4 className="text-xs font-semibold text-neutral-100">
                <span className="mr-1 font-mono text-neutral-500">{row.finding_number}.</span>
                {row.finding}
              </h4>
              <span className="shrink-0 rounded border border-[#E69F00]/60 px-1.5 py-px text-[10px] text-[#E69F00]">✓ {row.status}</span>
            </header>
            <p className="mt-1 text-[11px] text-neutral-400"><span className="text-neutral-500">Evidence: </span>{row.evidence}</p>
            <p className="mt-1 text-[11px] text-neutral-200"><span className="text-neutral-500">Do this: </span>{row.action}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}
