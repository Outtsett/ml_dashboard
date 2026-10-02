/**
 * The lake audit's sections, one component each. Every list comes from the
 * handler already cut to the selected run; charts are Recharts, colours are
 * Okabe-Ito, and the two kinds of check are told apart by hatching and by a
 * glyph as well as by colour.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, SwitchControl, ControlBar,
  TOOLTIP, fmt, fmtInt, fmtTime,
} from "@/studies/kit";
import {
  differenceBetweenRuns, orderChecks, partitionLabel, sharePercent, stalenessBand, verdict,
  type AuditCheck, type AuditRun, type CheckOrder, type CheckPartition, type LakeAuditBody,
} from "@shared/studies/lake-audit";
import { SortableTable, type Column } from "./Table";

export const SEVERITY_GLYPH: Record<string, string> = { error: "■ error", warning: "▲ warning" };
const SEVERITY_COLOR: Record<string, string> = { error: OKABE.vermillion, warning: OKABE.yellow };

export function stamp(milliseconds: number | null | undefined): string {
  return milliseconds === null || milliseconds === undefined ? "—" : `${fmtTime(milliseconds)} UTC`;
}

/** The hatched swatch: orange with white diagonals = what a clean would drop; solid blue = review only. */
export function HatchDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill={OKABE.orange} />
        <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="2" />
      </pattern>
    </defs>
  );
}

function Swatch({ hatched, label }: { hatched: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-neutral-300">
      <svg width="16" height="12" aria-hidden="true">
        <HatchDefs id="swatch-hatch" />
        <rect width="16" height="12" fill={hatched ? "url(#swatch-hatch)" : OKABE.blue} />
      </svg>
      {label}
    </span>
  );
}

/** ---------------------------------------------------------------- headline */

export function Headline({ run }: { run: AuditRun }) {
  const clean = run.error_row_count === 0 && run.duplicate_key_row_count === 0;
  return (
    <div
      className="rounded-md border px-3 py-2 text-sm font-semibold"
      style={{ borderColor: clean ? OKABE.blue : OKABE.orange, color: clean ? OKABE.sky : OKABE.orange, background: clean ? "rgba(0,114,178,0.08)" : "rgba(230,159,0,0.08)" }}
    >
      {clean ? "✓ " : "▲ "}
      {verdict(run)}
      <span className="ml-2 text-[11px] font-normal text-neutral-400">
        {run.table_name}, audited {stamp(run.generated_at)}
      </span>
    </div>
  );
}

/** -------------------------------------------------------------- run history */

function runLabel(run: AuditRun): string {
  return fmtTime(run.generated_at).slice(5);
}

export function RunHistory({
  body, onSelect, onlyChanged, onOnlyChanged,
}: { body: LakeAuditBody; onSelect: (recipe: string) => void; onlyChanged: boolean; onOnlyChanged: (value: boolean) => void }) {
  const { runs, selected } = body;
  if (!selected) return null;
  const index = runs.findIndex((run) => run.recipe === selected.recipe);
  const previous = index > 0 ? runs[index - 1] : undefined;
  const series = runs.map((run) => ({
    label: runLabel(run),
    "error rows": run.error_row_count,
    "warning rows": run.warning_row_count,
    "rows a clean would drop": run.droppable_row_count,
    "duplicate-key rows": run.duplicate_key_row_count,
    "row pass (seconds)": run.row_pass_seconds,
    "duplicate pass (seconds)": run.duplicate_pass_seconds,
  }));
  const difference = previous ? differenceBetweenRuns(body.checkHistory, previous.recipe, selected.recipe) : [];
  const shown = onlyChanged ? difference.filter((row) => row.change !== 0) : difference;

  const runColumns: Array<Column<AuditRun>> = [
    { key: "generated_at", label: "audited (UTC)", value: (r) => r.generated_at, cell: (r) => <span className={r.recipe === selected.recipe ? "font-semibold text-neutral-50" : ""}>{fmtTime(r.generated_at)}</span> },
    { key: "row_count", label: "rows", numeric: true, value: (r) => r.row_count, cell: (r) => fmtInt(r.row_count) },
    { key: "partition_count", label: "partitions", numeric: true, value: (r) => r.partition_count, cell: (r) => fmtInt(r.partition_count) },
    { key: "error_row_count", label: "error rows", numeric: true, value: (r) => r.error_row_count, cell: (r) => fmtInt(r.error_row_count) },
    { key: "warning_row_count", label: "warning rows", numeric: true, value: (r) => r.warning_row_count, cell: (r) => fmtInt(r.warning_row_count) },
    { key: "droppable_row_count", label: "a clean drops", numeric: true, value: (r) => r.droppable_row_count, cell: (r) => fmtInt(r.droppable_row_count) },
    { key: "duplicate_key_row_count", label: "duplicate keys", numeric: true, value: (r) => r.duplicate_key_row_count, cell: (r) => fmtInt(r.duplicate_key_row_count) },
    { key: "scan", label: "scan (s)", numeric: true, value: (r) => r.row_pass_seconds + r.duplicate_pass_seconds, cell: (r) => `${fmt(r.row_pass_seconds, 1)} + ${fmt(r.duplicate_pass_seconds, 1)}` },
    {
      key: "remediation", label: "remediation", value: (r) => (r.has_remediation ? (r.remediation_dry_run ? "planned (dry run)" : "applied") : "none"),
      cell: (r) => (r.has_remediation ? `${r.remediation_dry_run ? "planned (dry run)" : "applied"}: ${fmtInt(r.remediation_rows_removed)} rows` : "none"),
    },
    {
      key: "show", label: "", value: () => null,
      cell: (r) => (
        <button type="button" disabled={r.recipe === selected.recipe} onClick={() => onSelect(r.recipe)} className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 enabled:hover:border-neutral-500 disabled:opacity-40">
          {r.recipe === selected.recipe ? "shown" : "show"}
        </button>
      ),
    },
  ];

  const first = runs[0];
  const firstErrors = first?.error_row_count ?? 0;
  return (
    <Section title="Every run of this table" question="Each audit run is kept; pick one to read its report. The notebook showed only the latest.">
      <div className="space-y-3">
        <Finding>
          {runs.length} run{runs.length === 1 ? "" : "s"}.{" "}
          {firstErrors > 0 && runs.length > 1
            ? `The first found ${fmtInt(firstErrors)} error rows; the newest finds ${fmtInt(runs[runs.length - 1]?.error_row_count)}. `
            : ""}
          The scan takes {fmt(selected.row_pass_seconds, 0)} seconds for the row checks and {fmt(selected.duplicate_pass_seconds, 0)} for the duplicate pass (the larger cost, a distinct count over the whole table).
        </Finding>
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] text-neutral-400">Rows flagged, per run</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis {...AXIS} width={56} tickFormatter={(v: number) => fmtInt(v)} />
                <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [fmtInt(value), name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <HatchDefs id="history-hatch" />
                <Bar dataKey="error rows" fill={OKABE.vermillion} isAnimationActive={false} />
                <Bar dataKey="warning rows" fill={OKABE.yellow} isAnimationActive={false} />
                <Bar dataKey="rows a clean would drop" fill="url(#history-hatch)" isAnimationActive={false} />
                <Bar dataKey="duplicate-key rows" fill={OKABE.blue} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] text-neutral-400">Scan time, per run (seconds)</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis {...AXIS} width={44} />
                <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [`${fmt(value, 2)} s`, name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="row pass (seconds)" stackId="scan" fill={OKABE.sky} isAnimationActive={false} />
                <Bar dataKey="duplicate pass (seconds)" stackId="scan" fill={OKABE.purple} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <SortableTable rows={runs} columns={runColumns} rowKey={(r) => r.recipe} initialSort="generated_at" initialDescending />
        {previous && (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h4 className="text-xs font-semibold text-neutral-200">Change since {fmtTime(previous.generated_at)} UTC</h4>
              <SwitchControl label="Only checks that changed" checked={onlyChanged} onChange={onOnlyChanged} />
            </div>
            {shown.length === 0 ? (
              <p className="text-xs text-neutral-500">No check changed between these two runs.</p>
            ) : (
              <SortableTable
                rows={shown}
                rowKey={(r) => r.check_name}
                initialSort="change"
                columns={[
                  { key: "check_name", label: "check", value: (r) => r.check_name },
                  { key: "previous", label: "previous", numeric: true, value: (r) => r.previous, cell: (r) => fmtInt(r.previous) },
                  { key: "current", label: "this run", numeric: true, value: (r) => r.current, cell: (r) => fmtInt(r.current) },
                  {
                    key: "change", label: "change", numeric: true, value: (r) => Math.abs(r.change),
                    cell: (r) => <span style={{ color: r.change > 0 ? OKABE.orange : r.change < 0 ? OKABE.sky : OKABE.grey }}>{r.change > 0 ? "▲ +" : r.change < 0 ? "▼ " : "= "}{fmtInt(r.change)}</span>,
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

/** ------------------------------------------------------------------- checks */

function PartitionsOf({ check, partitions }: { check: AuditCheck; partitions: readonly CheckPartition[] }) {
  const mine = partitions.filter((p) => p.check_name === check.check_name).slice(0, 10);
  return (
    <div className="space-y-1.5 text-[11px] text-neutral-300">
      <p>{check.description}</p>
      <p className="text-neutral-500">Predicate (SQL over market.bars):</p>
      <pre className="overflow-x-auto rounded bg-neutral-950 p-2 font-mono text-[11px] text-neutral-200">{check.predicate}</pre>
      {mine.length > 0 ? (
        <>
          <p className="text-neutral-500">Largest of {fmtInt(check.affected_partition_count)} partitions affected:</p>
          <ul className="grid gap-x-4 sm:grid-cols-2">
            {mine.map((p) => (
              <li key={partitionLabel(p)} className="flex justify-between gap-2 font-mono tnum">
                <span>{partitionLabel(p)}</span>
                <span>{fmtInt(p.violation_row_count)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-neutral-500">No partition is affected.</p>
      )}
    </div>
  );
}

export function ChecksSection({
  body, order, onOrder, onlyFiring, onOnlyFiring,
}: { body: LakeAuditBody; order: CheckOrder; onOrder: (order: CheckOrder) => void; onlyFiring: boolean; onOnlyFiring: (value: boolean) => void }) {
  const ordered = orderChecks(body.checks, order);
  const rows = onlyFiring ? ordered.filter((check) => check.violation_row_count > 0) : ordered;
  const firing = body.checks.filter((check) => check.violation_row_count > 0).length;
  const columns: Array<Column<AuditCheck>> = [
    { key: "check_name", label: "check", value: (c) => c.check_name, cell: (c) => <span className="font-mono">{c.check_name}</span> },
    {
      key: "severity", label: "severity", value: (c) => c.severity,
      cell: (c) => <span style={{ color: SEVERITY_COLOR[c.severity] }}>{SEVERITY_GLYPH[c.severity] ?? c.severity}</span>,
    },
    { key: "remediation", label: "remediation", value: (c) => c.remediation, cell: (c) => (c.remediation === "drop_row" ? "╱ drop_row" : "□ review") },
    { key: "violation_row_count", label: "violating rows", numeric: true, value: (c) => c.violation_row_count, cell: (c) => fmtInt(c.violation_row_count) },
    { key: "share", label: "share of table %", numeric: true, value: (c) => sharePercent(c), cell: (c) => fmt(sharePercent(c), 6) },
    { key: "affected_partition_count", label: "partitions", numeric: true, value: (c) => c.affected_partition_count, cell: (c) => fmtInt(c.affected_partition_count) },
    { key: "description", label: "description", value: (c) => c.description, cell: (c) => <span className="line-clamp-2 max-w-md text-neutral-400">{c.description}</span> },
  ];
  return (
    <Section title="Checks" question={`${body.checks.length} checks ran; ${firing} fired. Click a row for its SQL predicate and the partitions it landed in.`}>
      <div className="space-y-2">
        <ControlBar>
          <SegmentControl label="Sort" value={order} options={[{ value: "violations", label: "violations" }, { value: "severity", label: "severity" }, { value: "name", label: "name" }]} onChange={onOrder} />
          <SwitchControl label="Only checks that fired" checked={onlyFiring} onChange={onOnlyFiring} />
        </ControlBar>
        <SortableTable
          rows={rows}
          columns={columns}
          rowKey={(c) => c.check_name}
          expandable={(c) => <PartitionsOf check={c} partitions={body.checkPartitions} />}
          empty={onlyFiring ? "No check fired: every check returned zero rows." : "No checks."}
        />
      </div>
    </Section>
  );
}

/** --------------------------------------------------------------- violations */

export function ViolationsSection({ checks, logScale, onLogScale }: { checks: readonly AuditCheck[]; logScale: boolean; onLogScale: (value: boolean) => void }) {
  const firing = [...checks].filter((check) => check.violation_row_count > 0).sort((a, b) => b.violation_row_count - a.violation_row_count);
  return (
    <Section title="Violations" question="Only the checks that fired. Hatched orange bars are rows a clean would drop; solid blue bars it would only report.">
      {firing.length === 0 ? (
        <Empty>Nothing to plot: every check returned zero rows.</Empty>
      ) : (
        <div className="space-y-2">
          <ControlBar>
            <SwitchControl label="Log scale" checked={logScale} onChange={onLogScale} hint="Counts differ by orders of magnitude" />
            <div className="flex items-center gap-4 pb-1">
              <Swatch hatched label="drop_row" />
              <Swatch hatched={false} label="review" />
            </div>
          </ControlBar>
          <ResponsiveContainer width="100%" height={60 + 30 * firing.length}>
            <BarChart data={firing} layout="vertical" margin={{ top: 4, right: 70, left: 8, bottom: 4 }}>
              <HatchDefs id="violations-hatch" />
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" scale={logScale ? "log" : "auto"} domain={logScale ? [1, "auto"] : [0, "auto"]} allowDataOverflow {...AXIS} tickFormatter={(v: number) => fmtInt(v)} />
              <YAxis type="category" dataKey="check_name" width={170} {...AXIS} />
              <Tooltip
                {...TOOLTIP}
                formatter={(value: number) => [fmtInt(value), "violating rows"]}
                labelFormatter={(label) => String(label)}
              />
              <Bar dataKey="violation_row_count" isAnimationActive={false}>
                {firing.map((check) => (
                  <Cell key={check.check_name} fill={check.remediation === "drop_row" ? "url(#violations-hatch)" : OKABE.blue} stroke={check.remediation === "drop_row" ? OKABE.orange : OKABE.blue} />
                ))}
                <LabelList dataKey="violation_row_count" position="right" formatter={(v: number) => fmtInt(v)} fontSize={10} fill="#a3a3a3" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Section>
  );
}

/** ------------------------------------------------------- where they landed */

export function PartitionsSection({
  body, focus, onFocus, count, onCount,
}: { body: LakeAuditBody; focus: string; onFocus: (name: string) => void; count: number; onCount: (value: number) => void }) {
  const firing = body.checks.filter((check) => check.violation_row_count > 0);
  if (firing.length === 0) return null;
  const check = firing.find((c) => c.check_name === focus) ?? firing[0];
  if (!check) return null;
  const rows = body.checkPartitions
    .filter((p) => p.check_name === check.check_name)
    .slice(0, count)
    .map((p) => ({ label: partitionLabel(p), rows: p.violation_row_count }));
  return (
    <Section title="Where the violations sit" question="The partitions (asset class, root, timeframe, year) a check landed in: which load to go and look at.">
      <div className="space-y-2">
        <ControlBar>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
            Check
            <select value={check.check_name} onChange={(event) => onFocus(event.target.value)} className="h-7 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs normal-case text-neutral-200">
              {firing.map((c) => (
                <option key={c.check_name} value={c.check_name}>{c.check_name} ({fmtInt(c.violation_row_count)})</option>
              ))}
            </select>
          </label>
          <SliderControl label="Partitions shown" value={count} min={5} max={50} onChange={onCount} />
        </ControlBar>
        <Finding>
          {check.check_name}: {fmtInt(check.violation_row_count)} rows in {fmtInt(check.affected_partition_count)} partitions. The {Math.min(count, rows.length)} largest are drawn.
        </Finding>
        <ResponsiveContainer width="100%" height={40 + 22 * rows.length}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
            <HatchDefs id="partition-hatch" />
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmtInt(v)} />
            <YAxis type="category" dataKey="label" width={150} {...AXIS} />
            <Tooltip {...TOOLTIP} formatter={(value: number) => [fmtInt(value), "violating rows"]} />
            <Bar dataKey="rows" fill={check.remediation === "drop_row" ? "url(#partition-hatch)" : OKABE.blue} stroke={check.remediation === "drop_row" ? OKABE.orange : OKABE.blue} isAnimationActive={false}>
              <LabelList dataKey="rows" position="right" formatter={(v: number) => fmtInt(v)} fontSize={10} fill="#a3a3a3" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

/** ----------------------------------------------------------------- coverage */

export function CoverageSection({ body }: { body: LakeAuditBody }) {
  const { coverage } = body;
  if (coverage.length === 0) return null;
  const maxRows = Math.max(...coverage.map((row) => row.row_count));
  const maxHours = Math.max(...coverage.map((row) => row.hours_since_last_row), 1);
  const stale = [...coverage].sort((a, b) => b.hours_since_last_row - a.hours_since_last_row);
  const freshest = stale[stale.length - 1];
  const stalest = stale[0];
  return (
    <Section title="Coverage" question="One row per asset class and timeframe: how much is loaded, how many symbols, and how long since anything was.">
      <div className="space-y-2">
        <Finding>
          hours_since_last_row is measured against the moment of the audit, so a stale slice is a slice nothing has loaded into since, not necessarily a broken one.
          {stalest && freshest && ` Here ${stalest.asset_class} ${stalest.timeframe} is ${fmtInt(stalest.hours_since_last_row)} hours (${fmt(stalest.hours_since_last_row / 24, 0)} days) behind and ${freshest.asset_class} ${freshest.timeframe} ${fmtInt(freshest.hours_since_last_row)} hours.`}
          {" "}Futures stamps are Pacific wall clock stored as UTC, so a futures slice reads 7 to 8 hours older than its true age.
        </Finding>
        <SortableTable
          rows={coverage}
          rowKey={(r) => `${r.asset_class}/${r.timeframe}`}
          initialSort="row_count"
          columns={[
            { key: "asset_class", label: "asset class", value: (r) => r.asset_class },
            { key: "timeframe", label: "timeframe", value: (r) => r.timeframe, cell: (r) => <span className="font-mono">{r.timeframe}</span> },
            {
              key: "row_count", label: "rows", numeric: true, value: (r) => r.row_count,
              cell: (r) => (
                <span className="flex items-center justify-end gap-2">
                  <span className="h-2 rounded-sm" style={{ width: `${Math.max(2, (Math.log10(r.row_count + 1) / Math.log10(maxRows + 1)) * 80)}px`, background: OKABE.sky }} aria-hidden="true" />
                  {fmtInt(r.row_count)}
                </span>
              ),
            },
            { key: "symbol_count", label: "symbols", numeric: true, value: (r) => r.symbol_count, cell: (r) => fmtInt(r.symbol_count) },
            { key: "first_timestamp", label: "first row", value: (r) => r.first_timestamp, cell: (r) => fmtTime(r.first_timestamp) },
            { key: "last_timestamp", label: "last row", value: (r) => r.last_timestamp, cell: (r) => fmtTime(r.last_timestamp) },
            {
              key: "hours_since_last_row", label: "hours since last row", numeric: true, value: (r) => r.hours_since_last_row,
              cell: (r) => {
                const band = stalenessBand(r.hours_since_last_row);
                return (
                  <span className="flex items-center justify-end gap-2">
                    <span className="h-2 rounded-sm" style={{ width: `${Math.max(2, (r.hours_since_last_row / maxHours) * 80)}px`, background: band === "fresh" ? OKABE.blue : OKABE.orange }} aria-hidden="true" />
                    {fmtInt(r.hours_since_last_row)}
                    <span className="w-14 text-left text-[10px] text-neutral-500">{band === "fresh" ? "● fresh" : band === "days" ? "▲ days" : band === "weeks" ? "▲ weeks" : "▲ months"}</span>
                  </span>
                );
              },
            },
          ]}
        />
      </div>
    </Section>
  );
}

/** --------------------------------------------------------------- duplicates */

export function DuplicatesSection({ body }: { body: LakeAuditBody }) {
  const { selected, duplicatePartitions } = body;
  if (!selected) return null;
  return (
    <Section title="Duplicate uniqueness keys" question={`Key is (${selected.unique_key}). Partitions holding more than one row for a key.`}>
      <div className="space-y-2">
        <Finding>
          A clean removes only the duplicates that are identical in every column; a partition whose duplicates disagree is skipped and named, because choosing between two conflicting records is a judgement about which load was right.
        </Finding>
        {duplicatePartitions.length === 0 ? (
          <p className="text-xs" style={{ color: OKABE.sky }}>{"✓"} No partition holds a duplicate key: {fmtInt(selected.duplicate_key_row_count)} rows share one.</p>
        ) : (
          <SortableTable
            rows={duplicatePartitions}
            rowKey={(p) => partitionLabel(p)}
            initialSort="duplicate_key_row_count"
            columns={[
              { key: "partition", label: "partition", value: (p) => partitionLabel(p), cell: (p) => <span className="font-mono">{partitionLabel(p)}</span> },
              { key: "row_count", label: "rows", numeric: true, value: (p) => p.row_count, cell: (p) => fmtInt(p.row_count) },
              { key: "duplicate_key_row_count", label: "duplicate-key rows", numeric: true, value: (p) => p.duplicate_key_row_count, cell: (p) => fmtInt(p.duplicate_key_row_count) },
            ]}
          />
        )}
      </div>
    </Section>
  );
}

/** -------------------------------------------------------------- remediation */

export function RemediationSection({ body, count, onCount }: { body: LakeAuditBody; count: number; onCount: (value: number) => void }) {
  const { selected, remediationPartitions } = body;
  if (!selected || !selected.has_remediation) return null;
  const dry = selected.remediation_dry_run === true;
  const top = remediationPartitions.slice(0, count).map((p) => ({ label: partitionLabel(p), "rows removed": p.rows_removed, "rows kept": p.row_count_after }));
  return (
    <Section title="Remediation" question="What the audit's clean plans or did, partition by partition.">
      <div className="space-y-2">
        <Finding>
          {dry ? "Planned (dry run)" : "Applied"} {stamp(selected.remediation_generated_at)}: {fmtInt(selected.remediation_partitions_planned)} partitions, {dry ? "would remove" : "removed"} {fmtInt(selected.remediation_rows_removed)} rows, {fmtInt(selected.remediation_partitions_skipped)} skipped.
          {dry && " A dry run changes nothing; the next audit shows the result."}
        </Finding>
        <ControlBar>
          <SliderControl label="Partitions drawn" value={count} min={5} max={50} onChange={onCount} />
        </ControlBar>
        <ResponsiveContainer width="100%" height={40 + 22 * top.length}>
          <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
            <HatchDefs id="remediation-hatch" />
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmtInt(v)} />
            <YAxis type="category" dataKey="label" width={150} {...AXIS} />
            <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [fmtInt(value), name]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="rows removed" stackId="rows" fill="url(#remediation-hatch)" stroke={OKABE.orange} isAnimationActive={false} />
            <Bar dataKey="rows kept" stackId="rows" fill={OKABE.blue} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <SortableTable
          rows={remediationPartitions}
          rowKey={(p) => partitionLabel(p)}
          initialSort="rows_removed"
          columns={[
            { key: "partition", label: "partition", value: (p) => partitionLabel(p), cell: (p) => <span className="font-mono">{partitionLabel(p)}</span> },
            { key: "row_count_before", label: "rows before", numeric: true, value: (p) => p.row_count_before, cell: (p) => fmtInt(p.row_count_before) },
            { key: "row_count_after", label: "rows after", numeric: true, value: (p) => p.row_count_after, cell: (p) => fmtInt(p.row_count_after) },
            { key: "rows_removed", label: "rows removed", numeric: true, value: (p) => p.rows_removed, cell: (p) => fmtInt(p.rows_removed) },
            { key: "status", label: "status", value: (p) => p.status },
          ]}
        />
      </div>
    </Section>
  );
}

/** ------------------------------------------------------------------ formulas */

export function FormulaSection({
  body, terms, onTerms, focus,
}: { body: LakeAuditBody; terms: number; onTerms: (value: number) => void; focus: string }) {
  const { selected, checks } = body;
  if (!selected) return null;
  const errorChecks = orderChecks(checks.filter((check) => check.severity === "error"), "violations");
  const used = terms < 0 ? errorChecks.length : Math.min(terms, errorChecks.length);
  let running = 0;
  const steps = errorChecks.map((check) => {
    running += check.violation_row_count;
    return { check, running };
  });
  const partial = used === 0 ? 0 : (steps[used - 1]?.running ?? 0);
  const current = used === 0 ? undefined : steps[used - 1]?.check;
  const focused = checks.find((check) => check.check_name === focus) ?? [...checks].sort((a, b) => b.violation_row_count - a.violation_row_count)[0];
  return (
    <Section title="How the headline numbers are built" question="The report's two headline quantities as formulas: move the slider to add one error check at a time to the sum.">
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <FormulaCard
            tex={"E=\\sum_{c\\in\\mathcal{E}} v_c \\qquad \\text{clean}\\iff E=0\\;\\wedge\\;D=0"}
            caption="Error rows are the sum of each error-severity check's violating rows, so a row that trips two checks counts twice."
            symbols={[
              { tex: "E", name: "rows failing an error-severity check (error_row_count)", value: `${fmtInt(partial)} of ${fmtInt(selected.error_row_count)}` },
              { tex: "\\mathcal{E}", name: "the set of error-severity checks", value: `${errorChecks.length} checks, ${used} added` },
              { tex: "c", name: "one check in that set, the last one added", value: current?.check_name ?? "none yet" },
              { tex: "v_c", name: "violating rows of check c (violation_row_count)", value: fmtInt(current?.violation_row_count ?? 0) },
              { tex: "D", name: "rows sharing a uniqueness key (duplicate_key_row_count)", value: fmtInt(selected.duplicate_key_row_count) },
            ]}
          />
          <ControlBar>
            <SliderControl label="Error checks added" value={used} min={0} max={errorChecks.length} onChange={onTerms} format={(v) => `${v} of ${errorChecks.length}`} />
          </ControlBar>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono tnum">
              <thead>
                <tr className="text-neutral-500">
                  <th className="py-0.5 pr-2 text-left font-normal">i</th>
                  <th className="pr-2 text-left font-normal">check c</th>
                  <th className="pr-2 text-right font-normal">v_c</th>
                  <th className="text-right font-normal">running E</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step, index) => (
                  <tr key={step.check.check_name} className={index < used ? "text-neutral-100" : "text-neutral-600"} style={index === used - 1 ? { background: "rgba(230,159,0,0.12)" } : undefined}>
                    <td className="py-0.5 pr-2">{index + 1}</td>
                    <td className="pr-2">{index === used - 1 ? "▶ " : ""}{step.check.check_name}</td>
                    <td className="pr-2 text-right">{fmtInt(step.check.violation_row_count)}</td>
                    <td className="text-right">{index < used ? fmtInt(step.running) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="min-w-0">
          {focused && (
            <FormulaCard
              tex={"s_c=100\\cdot\\frac{v_c}{N}"}
              caption="The table's 'share of table' column, for the check chosen under Where the violations sit (or the largest)."
              symbols={[
                { tex: "s_c", name: "share of the table that check c flags, in percent (share_of_table_percent)", value: `${fmt(sharePercent(focused), 6)} %` },
                { tex: "c", name: "the check", value: focused.check_name },
                { tex: "v_c", name: "violating rows of check c", value: fmtInt(focused.violation_row_count) },
                { tex: "N", name: "rows in the audited table at this snapshot (row_count)", value: fmtInt(selected.row_count) },
              ]}
            />
          )}
        </div>
      </div>
    </Section>
  );
}
