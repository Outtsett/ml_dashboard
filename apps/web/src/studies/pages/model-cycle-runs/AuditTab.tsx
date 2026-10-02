/**
 * The 2026-09-26 Model Cycle audit: findings, the catalog coverage by status
 * and spec, and the description of the run record's tables.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Finding, GRID, OKABE, Section, Stat, TOOLTIP, fmtInt } from "@/studies/kit";
import type { TabProps } from "./common";
import { DataTable, recordColumns } from "./Table";

export function AuditTab({ overview }: TabProps) {
  const { audit } = overview;
  if (audit.findings.length === 0 && audit.coverage.length === 0 && audit.record.length === 0) {
    return (
      <Section title="The audit (2026-09-26): not in the lake">
        <p className="text-xs text-neutral-400">derived_model_cycle_audit_findings, _coverage and _record are not served.</p>
      </Section>
    );
  }
  const severities = new Map<string, number>();
  for (const finding of audit.findings) {
    const key = String(finding.severity ?? "unrated");
    severities.set(key, (severities.get(key) ?? 0) + 1);
  }
  const specs = audit.coverageByStatus.reduce((sum, row) => sum + row.specs, 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Findings" value={fmtInt(audit.findings.length)} hint={[...severities].map(([key, value]) => `${key} ${value}`).join(" · ")} />
        <Stat label="Catalog specs audited" value={fmtInt(specs)} />
        <Stat label="Coverage statuses" value={fmtInt(audit.coverageByStatus.length)} hint={audit.coverageByStatus.map((row) => `${row.status} ${row.specs}`).join(" · ")} />
        <Stat label="Record tables described" value={fmtInt(audit.record.length)} />
      </div>
      <Section title="Findings" question="What the audit found, where, and what was done.">
        <DataTable rows={audit.findings} columns={recordColumns(audit.findings)} rowKey={(row) => String(row.finding_number)} pageSize={12} />
      </Section>
      <Section title="Catalog coverage" question="Every catalog spec by whether the Model Cycle can run it.">
        <ResponsiveContainer width="100%" height={Math.max(120, 28 * audit.coverageByStatus.length)}>
          <BarChart data={audit.coverageByStatus} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} allowDecimals={false} />
            <YAxis type="category" dataKey="status" width={150} {...AXIS} interval={0} />
            <Tooltip {...TOOLTIP} formatter={(value) => [fmtInt(Number(value)), "specs"]} />
            <Bar dataKey="specs" fill={OKABE.sky} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <Finding>{audit.coverageByStatus.map((row) => `${row.status}: ${fmtInt(row.specs)}`).join(" · ")}</Finding>
        <DataTable rows={audit.coverage} columns={recordColumns(audit.coverage)} rowKey={(row) => String(row.catalog_spec_id)} pageSize={15} />
      </Section>
      <Section title="The run record" question="One row per landed table: what a row is, and its columns.">
        <DataTable rows={audit.record} columns={recordColumns(audit.record)} rowKey={(row) => String(row.table_name)} />
      </Section>
    </div>
  );
}
