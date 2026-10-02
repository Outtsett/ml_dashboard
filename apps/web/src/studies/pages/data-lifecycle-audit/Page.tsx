/**
 * The data lifecycle, audited: the 2026-09-23 measured audit of how market data
 * is stored, retrieved, moved, computed on, held in memory, saved temporarily
 * and destroyed. A finished record: the filters, the map and the charts
 * re-slice the 43 findings in the browser; only the raw table picker asks the
 * server for another table.
 */

import {
  EFFORT_ORDER, FINDING_NUMERIC_COLUMNS, SEVERITY_ORDER, STAGE_ORDER, countBySeverity, filterFindings, joinList,
  lifecycleCells, parseList, restrictToCells, restrictToIdentifiers, stageLabel, strandLabel, toggleIn, type AuditBody,
  type DocumentationRow, type FindingRow, type HeadlineRow, type RefutedRow,
} from "@shared/studies/data-lifecycle-audit";
import {
  ControlBar, Empty, Finding, Section, SliderControl, Stat, StudyNotes, StudyState, SwitchControl, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { ColumnPanels } from "./ColumnPanels";
import { DataTable, type TableColumn } from "./DataTable";
import { DetailCard, FindingsTable } from "./FindingsTable";
import { Filters } from "./Filters";
import { LifecycleMap } from "./LifecycleMap";
import { PriorityChart } from "./PriorityChart";
import { RawSection } from "./RawSection";
import { SkewnessWalk } from "./SkewnessWalk";
import { severityStyle } from "./style";

const FINDING_COLUMNS = [
  "identifier", "strand", "lifecycle_stage", "component", "file_path", "line_number", "title", "current_behavior", "evidence",
  "measured_value", "measured_unit", "improvement", "expected_gain", "severity", "effort", "risk", "confidence", "verdict",
  "verification_note", "audit_date",
].map((name) => ({ name, numeric: FINDING_NUMERIC_COLUMNS.includes(name) }));

const HEADLINE_COLUMNS = [
  { name: "strand", numeric: false }, { name: "measurement_name", numeric: false }, { name: "value", numeric: true },
  { name: "unit", numeric: false }, { name: "method", numeric: false }, { name: "raw_table_name", numeric: false },
];

const HEADLINE_TABLE: ReadonlyArray<TableColumn<HeadlineRow>> = [
  { key: "strand", label: "part of the system", value: (row) => strandLabel(row.strand) },
  { key: "measurement", label: "measurement", value: (row) => row.measurement_name },
  { key: "value", label: "value", value: (row) => row.value, align: "right" },
  { key: "unit", label: "unit", value: (row) => row.unit },
  { key: "method", label: "method", value: (row) => row.method, wrap: true },
  { key: "raw", label: "raw table", value: (row) => row.raw_table_name },
];

const REFUTED_TABLE: ReadonlyArray<TableColumn<RefutedRow>> = [
  { key: "identifier", label: "identifier", value: (row) => row.identifier },
  { key: "verdict", label: "verdict", value: (row) => row.verdict },
  { key: "title", label: "title", value: (row) => row.title, wrap: true },
  { key: "note", label: "verification note", value: (row) => row.verification_note, wrap: true },
];

const DOCUMENTATION_TABLE: ReadonlyArray<TableColumn<DocumentationRow>> = [
  { key: "strand", label: "part of the system", value: (row) => strandLabel(row.strand) },
  { key: "topic", label: "topic", value: (row) => row.topic, wrap: true, widthClass: "min-w-[10rem] max-w-[16rem]" },
  { key: "source", label: "source", value: (row) => row.source, wrap: true, widthClass: "min-w-[10rem] max-w-[18rem] break-all" },
  { key: "fact", label: "fact", value: (row) => row.fact, wrap: true },
];

function numbersIn(rows: ReadonlyArray<Record<string, unknown>>, column: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const value = row[column];
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

function idList(rows: readonly FindingRow[]): string {
  return rows.map((row) => row.identifier).join(", ");
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    stageOff: "", severityOff: "", effortOff: "", strandOff: "", search: "",
    cells: "", picked: "", finding: "",
    findingsTop: 12, findingsBins: 20, findingsLog: false,
    headTop: 12, headBins: 20, headLog: false,
    rawTable: "", rawBins: 30, rawTop: 15, rawLog: true,
    walkColumn: "", walkStep: 1,
  });
  const query = useStudyQuery<AuditBody>("data-lifecycle-audit", { table: controls.rawTable });
  const body = query.data?.data;
  const all = body?.findings ?? [];

  const strands = [...new Set(all.map((row) => row.strand))].sort();
  const off = {
    stage: parseList(controls.stageOff), severity: parseList(controls.severityOff), effort: parseList(controls.effortOff), strand: parseList(controls.strandOff),
  };
  const filtered = filterFindings(all, {
    stages: STAGE_ORDER.filter((value) => !off.stage.includes(value)),
    severities: SEVERITY_ORDER.filter((value) => !off.severity.includes(value)),
    efforts: EFFORT_ORDER.filter((value) => !off.effort.includes(value)),
    strands: strands.filter((value) => !off.strand.includes(value)),
    text: controls.search,
  });
  const cells = lifecycleCells(filtered);
  const pickedCells = parseList(controls.cells);
  const mapFindings = restrictToCells(filtered, pickedCells);
  const pickedIdentifiers = parseList(controls.picked);
  const tableFindings = restrictToIdentifiers(mapFindings, pickedIdentifiers);
  const selectedFinding = all.find((row) => row.identifier === controls.finding) ?? null;
  const counts = countBySeverity(filtered);
  const auditDate = all[0]?.audit_date ?? null;

  const busiest = [...cells].sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage))[0];
  const critical = filtered.filter((row) => row.severity === "critical");
  const cheapAndImportant = mapFindings.filter((row) => (row.severity === "critical" || row.severity === "high") && row.effort === "small");

  const rawTable = body?.rawTable ?? null;
  const numericRaw = (rawTable?.columns ?? []).filter((column) => column.type === "number").map((column) => column.name);
  const walkColumn = numericRaw.includes(controls.walkColumn) ? controls.walkColumn : (numericRaw[0] ?? "");
  const walkValues = rawTable ? numbersIn(rawTable.rows, walkColumn) : [];

  return (
    <div className="min-w-0 space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        {all.length === 0 ? (
          <Empty>The audit's tables are not in the lake, so there is nothing to show. Land them under derived/data_lifecycle_audit, then refresh the derived views.</Empty>
        ) : (
          <>
            <div className="space-y-1.5">
              <Finding>
                Every byte of market data takes the same trip: it is <strong>stored</strong> in the lake, <strong>retrieved</strong> by DuckDB, <strong>moved</strong> to the server, the
                browser or a Python process, <strong>computed on</strong>, <strong>held in memory</strong>, <strong>temporarily saved</strong> in a cache or on disk, and eventually{" "}
                <strong>destroyed</strong>: evicted, expired, cleaned up, or never. Think of a warehouse walk-through: where the stock sits on the shelves, how long a picker takes to
                fetch an order, how many times the same box is copied onto another shelf, and which back rooms fill because nobody throws anything out.
              </Finding>
              <Finding>
                Every finding was measured by a researcher and then attacked by a separate verifier who re-opened the code and re-ran the numbers. What survived is below; what was
                struck is at the bottom with the reason.
              </Finding>
              <p className="text-[11px] text-neutral-500">
                A dated record, measured {auditDate ?? "on an unrecorded date"}: it does not update as the code changes. Read from{" "}
                <span className="font-mono">derived_data_lifecycle_audit_*</span>, recipe <span className="font-mono">{body?.recipe}</span>
                {(body?.recipes.length ?? 0) > 1 && ` (${body?.recipes.length} runs in the lake; the newest is shown)`}.{" "}
                <button type="button" onClick={reset} className="text-[#56B4E9] hover:underline" title="Put every control on the page back to its default">
                  Reset every control
                </button>
              </p>
            </div>

            <Filters
              strands={strands}
              off={off}
              search={controls.search}
              onOff={(key, value) => set(`${key}Off` as "stageOff" | "severityOff" | "effortOff" | "strandOff", joinList(value))}
              onSearch={(value) => set("search", value)}
            />

            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Stat label="Findings shown" value={`${filtered.length} of ${all.length}`} />
              {SEVERITY_ORDER.map((severity) => (
                <Stat key={severity} label={`${severityStyle(severity).glyph} ${severity} severity`} value={String(counts[severity] ?? 0)} tone={severityStyle(severity).colour} />
              ))}
            </div>

            <Section title="Where along the trip the problems are" question="Columns are the stages of the lifecycle in the order a byte travels; rows are the part of the system that owns the finding.">
              <div className="space-y-2">
                <LifecycleMap
                  cells={cells}
                  strands={strands}
                  selected={pickedCells}
                  onToggle={(key) => set("cells", joinList(toggleIn(pickedCells, key)))}
                  onClear={() => set("cells", "")}
                />
                <Finding>
                  {busiest
                    ? `The busiest cell is ${stageLabel(busiest.stage)} in "${strandLabel(busiest.strand)}" with ${busiest.count} ${busiest.count === 1 ? "finding" : "findings"}. `
                    : "No finding matches the filters. "}
                  {critical.length > 0
                    ? `Critical findings (${critical.length}): ${idList(critical)}.`
                    : "None of the findings shown is critical."}
                </Finding>
              </div>
            </Section>

            <Section
              title="What to do first"
              question="Across: how much work the fix is. Up: how much it matters. Follows the filters and the cells picked above."
            >
              <div className="space-y-2">
                <PriorityChart
                  rows={mapFindings}
                  picked={pickedIdentifiers}
                  onToggle={(identifier) => set("picked", joinList(toggleIn(pickedIdentifiers, identifier)))}
                  onClear={() => set("picked", "")}
                />
                <Finding>
                  {cheapAndImportant.length > 0
                    ? `Cheap and important, critical or high severity at small effort (${cheapAndImportant.length}): ${idList(cheapAndImportant)}.`
                    : "No critical or high finding with small effort in this selection."}
                </Finding>
              </div>
            </Section>

            <Section
              title={`Findings (${tableFindings.length})`}
              question="Severity first, then effort. Click a row for the whole finding."
            >
              <div className="space-y-3">
                <FindingsTable rows={tableFindings} selectedIdentifier={controls.finding === "" ? null : controls.finding} onSelect={(identifier) => set("finding", identifier ?? "")} />
                <DetailCard finding={selectedFinding} />
              </div>
            </Section>

            <Section title="Every column of the findings, drawn" question="One panel per column; the panels follow the filters at the top.">
              <div className="space-y-2">
                <ControlBar>
                  <SliderControl label="Values shown per category panel" value={controls.findingsTop} min={5} max={40} onChange={(value) => set("findingsTop", value)} />
                  <SliderControl label="Bins per numeric panel" value={controls.findingsBins} min={5} max={60} onChange={(value) => set("findingsBins", value)} />
                  <SwitchControl label="Log scale on counts" checked={controls.findingsLog} onChange={(value) => set("findingsLog", value)} />
                </ControlBar>
                <Finding>
                  Label columns show a count per value; number columns show their distribution and eight numbers; the long text columns show how much was written in each (a thin finding
                  is a short bar).
                </Finding>
                <ColumnPanels rows={filtered} columns={FINDING_COLUMNS} top={controls.findingsTop} bins={controls.findingsBins} logScale={controls.findingsLog} />
              </div>
            </Section>

            <Section title="The measurements behind the findings" question="Every number a researcher measured, grouped by where in the system it was taken.">
              <div className="space-y-2">
                <DataTable rows={body?.headline ?? []} columns={HEADLINE_TABLE} rowKey={(row, position) => `${row.raw_table_name}-${row.measurement_name}-${position}`} pageSize={12} label="Headline measurements" />
                <ControlBar>
                  <SliderControl label="Values shown per category panel" value={controls.headTop} min={5} max={40} onChange={(value) => set("headTop", value)} />
                  <SliderControl label="Bins per numeric panel" value={controls.headBins} min={5} max={60} onChange={(value) => set("headBins", value)} />
                  <SwitchControl label="Log scale on counts" checked={controls.headLog} onChange={(value) => set("headLog", value)} />
                </ControlBar>
                <ColumnPanels rows={body?.headline ?? []} columns={HEADLINE_COLUMNS} top={controls.headTop} bins={controls.headBins} logScale={controls.headLog} />
              </div>
            </Section>

            <Section title="The raw measurement tables" question="One row per file, per endpoint call, per directory, per dtype. Pick one: every column gets its own panel plus the full eight-number summary.">
              <RawSection
                index={body?.rawIndex ?? []}
                table={rawTable}
                selected={controls.rawTable}
                onSelect={(name) => set("rawTable", name)}
                bins={controls.rawBins}
                top={controls.rawTop}
                logScale={controls.rawLog}
                onBins={(value) => set("rawBins", value)}
                onTop={(value) => set("rawTop", value)}
                onLogScale={(value) => set("rawLog", value)}
              />
            </Section>

            <Section title="How the two shape numbers are built" question="Skewness and kurtosis in the eight-number summaries above are sums over the z-scores of the column picked here.">
              <SkewnessWalk
                columnName={walkColumn}
                columnNames={numericRaw}
                values={walkValues}
                step={controls.walkStep}
                onColumn={(name) => { set("walkColumn", name); set("walkStep", 1); }}
                onStep={(step) => set("walkStep", step)}
              />
            </Section>

            <Section title="What the verifiers struck" question="Proposed by a researcher and rejected by the verifier who re-opened the code and re-ran the numbers: the claim was false, the fix was wrong for the installed version, or it repeated another finding. Kept so the same idea is not proposed twice.">
              <DataTable rows={body?.refuted ?? []} columns={REFUTED_TABLE} rowKey={(row) => row.identifier} pageSize={10} />
            </Section>

            <Section title="Library behaviour confirmed from source or documentation">
              <DataTable rows={body?.documentation ?? []} columns={DOCUMENTATION_TABLE} rowKey={(row, position) => `${row.topic}-${position}`} pageSize={10} />
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}

