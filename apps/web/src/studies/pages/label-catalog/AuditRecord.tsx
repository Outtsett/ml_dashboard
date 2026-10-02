/**
 * The 2026-09-26 label audit record (derived_label_audit_*): every table as
 * a table, each with the picture of what it counts.
 */

import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AuditTables } from "@shared/studies/label-catalog";
import { AXIS, ColumnGrid, Empty, Finding, GRID, OKABE, Section, TOOLTIP, fmtInt } from "@/studies/kit";
import { WONG_PALETTE_DARK } from "@/shared/theme/dataColors";
import { DataTable, recordColumns } from "./Table";

type Row = Record<string, unknown>;

const SEVERITY_ORDER = ["high", "medium", "low"];
const SEVERITY_STYLE: Record<string, { color: string; glyph: string }> = {
  high: { color: OKABE.vermillion, glyph: "▲▲" },
  medium: { color: OKABE.orange, glyph: "▲" },
  low: { color: OKABE.sky, glyph: "●" },
};

function countBy(rows: readonly Row[], key: string): Array<{ key: string; rows: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = String(row[key] ?? "not recorded");
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, rows]) => ({ key: name, rows }));
}

function Counts({ data, height = 160, colorOf }: { data: Array<{ key: string; rows: number }>; height?: number; colorOf?: (key: string) => string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(height, data.length * 22 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...AXIS} />
        <YAxis type="category" dataKey="key" width={120} interval={0} {...AXIS} />
        <Tooltip {...TOOLTIP} formatter={(value: number) => [fmtInt(value), "rows"]} />
        <Bar dataKey="rows" isAnimationActive={false} label={{ position: "right", fill: "#d4d4d8", fontSize: 10 }}>
          {data.map((row) => (
            <Cell key={row.key} fill={colorOf?.(row.key) ?? OKABE.sky} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AuditRecord({ audit }: { audit: AuditTables }) {
  const severities = countBy(audit.findings, "severity").sort((a, b) => SEVERITY_ORDER.indexOf(a.key) - SEVERITY_ORDER.indexOf(b.key));
  const categories = countBy(audit.generators, "category").sort((a, b) => b.rows - a.rows);
  const legacy = audit.legacyTables.map((row) => ({ key: String(row.table_name ?? ""), rows: Number(row.row_count ?? 0) }));
  const timeframes = [...new Set(audit.suite.map((row) => Number(row.timeframe_minutes)))].sort((a, b) => a - b);
  const suiteByGenerator = new Map<string, Record<string, number | string>>();
  for (const row of audit.suite) {
    const generator = String(row.generator_type ?? "");
    const entry = suiteByGenerator.get(generator) ?? { generator };
    const key = `${row.timeframe_minutes} minute`;
    entry[key] = Number(entry[key] ?? 0) + 1;
    suiteByGenerator.set(generator, entry);
  }
  const suiteData = [...suiteByGenerator.values()];
  const high = severities.find((row) => row.key === "high")?.rows ?? 0;
  const fixedCount = audit.findings.filter((row) => String(row.action ?? "").toLowerCase().startsWith("fixed")).length;

  if (audit.findings.length + audit.generators.length + audit.legacyTables.length + audit.suite.length === 0) {
    return <Empty>The audit record is not landed (scripts/land_label_audit.py lands it).</Empty>;
  }

  return (
    <div className="space-y-3">
      <Section title="Findings, by severity" question={`${audit.findings.length} findings from the 2026-09-26 audit of every label generator.`}>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            <Counts data={severities} colorOf={(key) => SEVERITY_STYLE[key]?.color ?? OKABE.grey} />
            <p className="text-[11px] text-neutral-400">
              {severities.map((row) => `${SEVERITY_STYLE[row.key]?.glyph ?? "○"} ${row.key} ${row.rows}`).join(" · ")}
            </p>
            <Finding>
              {high} high-severity findings, in {countBy(audit.findings.filter((row) => row.severity === "high"), "area").map((row) => `${row.key} (${row.rows})`).join(", ")};
              {" "}{fixedCount} of {audit.findings.length} findings record their action as fixed.
            </Finding>
          </div>
          <DataTable rows={audit.findings} columns={recordColumns(audit.findings)} rowKey={(_row, index) => String(index)} pageSize={25} />
        </div>
      </Section>
      <Section title="Every generator and what changed" question={`${audit.generators.length} generators, by category.`}>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Counts data={categories} />
          <DataTable rows={audit.generators} columns={recordColumns(audit.generators)} rowKey={(_row, index) => String(index)} pageSize={25} />
        </div>
      </Section>
      <Section title="Legacy label tables in the lake" question="Tables in the serving snapshot that predate the label contract; reported, none deleted.">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Counts data={legacy} />
          <DataTable rows={audit.legacyTables} columns={recordColumns(audit.legacyTables)} rowKey={(_row, index) => String(index)} />
        </div>
        <ColumnGrid rows={audit.legacyTables} title="Every numeric column of the legacy tables" />
      </Section>
      <Section title="The canonical suite" question={`${audit.suite.length} label sets the suite lands, by generator and timeframe.`}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={suiteData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="generator" angle={-30} textAnchor="end" interval={0} height={50} {...AXIS} />
            <YAxis allowDecimals={false} {...AXIS} width={28} />
            <Tooltip {...TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {timeframes.map((minutes, index) => (
              <Bar key={minutes} dataKey={`${minutes} minute`} stackId="suite" fill={WONG_PALETTE_DARK[index % WONG_PALETTE_DARK.length]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <DataTable rows={audit.suite} columns={recordColumns(audit.suite)} rowKey={(_row, index) => String(index)} pageSize={40} />
      </Section>
    </div>
  );
}
