/**
 * The findings table (severity, then effort, then identifier; click a row to
 * read the whole finding) and the card that row opens: what the code does now,
 * what was measured, the evidence, the change, the expected gain, what could
 * break, and what the verifier checked.
 */

import type { ReactNode } from "react";
import { sortFindings, stageLabel, strandLabel, type FindingRow } from "@shared/studies/data-lifecycle-audit";
import { Glyph } from "./Glyph";
import { DataTable, type TableColumn } from "./DataTable";
import { cellText, severityStyle } from "./style";

const COLUMNS: ReadonlyArray<TableColumn<FindingRow>> = [
  { key: "identifier", label: "identifier", value: (row) => row.identifier },
  {
    key: "severity", label: "severity", value: (row) => row.severity,
    render: (row) => <span className="inline-flex items-center gap-1"><Glyph severity={row.severity} size={11} />{row.severity}</span>,
  },
  { key: "effort", label: "effort", value: (row) => row.effort },
  { key: "stage", label: "lifecycle stage", value: (row) => stageLabel(row.lifecycle_stage) },
  { key: "component", label: "component", value: (row) => row.component, wrap: true, widthClass: "min-w-[12rem] max-w-[20rem]" },
  { key: "title", label: "title", value: (row) => row.title, wrap: true },
  { key: "gain", label: "expected gain", value: (row) => row.expected_gain, wrap: true },
  { key: "measured", label: "measured value", value: (row) => row.measured_value, align: "right" },
  { key: "unit", label: "measured unit", value: (row) => row.measured_unit },
  { key: "file", label: "file path", value: (row) => row.file_path, wrap: true, widthClass: "min-w-[14rem] max-w-[24rem] break-all" },
  { key: "line", label: "line number", value: (row) => row.line_number, align: "right" },
];

export function FindingsTable({ rows, selectedIdentifier, onSelect }: {
  rows: readonly FindingRow[];
  selectedIdentifier: string | null;
  onSelect: (identifier: string | null) => void;
}) {
  return (
    <DataTable
      rows={sortFindings(rows)}
      columns={COLUMNS}
      rowKey={(row) => row.identifier}
      pageSize={15}
      label="Findings: click a row to read the whole finding"
      selectedKey={selectedIdentifier}
      onSelect={onSelect}
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-3 gap-y-0.5 border-t border-neutral-800 py-1.5 sm:grid-cols-[9.5rem_1fr]">
      <dt className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</dt>
      <dd className="min-w-0 whitespace-pre-line break-words text-[12px] leading-relaxed text-neutral-200">{children}</dd>
    </div>
  );
}

export function DetailCard({ finding }: { finding: FindingRow | null }) {
  if (!finding) {
    return (
      <p className="rounded border border-dashed border-neutral-800 px-3 py-4 text-center text-xs text-neutral-500">
        Select a finding in the table to read what the code does now, the evidence, the fix, the expected gain, the risk and what the verifier changed.
      </p>
    );
  }
  const style = severityStyle(finding.severity);
  const location = finding.line_number ? `${finding.file_path}:${finding.line_number}` : finding.file_path;
  const measured = finding.measured_value !== null ? `${cellText(finding.measured_value)} ${finding.measured_unit ?? ""}`.trim() : "not a single number";
  return (
    <article className="min-w-0 rounded-md border border-neutral-700 bg-neutral-900/50 p-3">
      <h4 className="flex items-start gap-2 text-sm font-semibold text-neutral-50">
        <span className="mt-0.5"><Glyph severity={finding.severity} size={14} /></span>
        <span>{finding.identifier} — {finding.title}</span>
      </h4>
      <p className="mt-1 text-[11px] text-neutral-400">
        <span style={{ color: style.colour }}>{style.glyph}</span> severity {finding.severity} · effort {finding.effort} · confidence {finding.confidence} · stage {stageLabel(finding.lifecycle_stage)} · part {strandLabel(finding.strand)} · verifier {finding.verdict}
      </p>
      <p className="mt-1 break-all font-mono text-[11px] text-neutral-400">{location}</p>
      <dl className="mt-2">
        <Field label="What happens now">{finding.current_behavior}</Field>
        <Field label="Measured">{measured}</Field>
        <Field label="Evidence">{finding.evidence}</Field>
        <Field label="The change">{finding.improvement}</Field>
        <Field label="Expected gain">{finding.expected_gain}</Field>
        <Field label="What could break">{finding.risk}</Field>
        <Field label="What the verifier checked">{finding.verification_note}</Field>
      </dl>
    </article>
  );
}
