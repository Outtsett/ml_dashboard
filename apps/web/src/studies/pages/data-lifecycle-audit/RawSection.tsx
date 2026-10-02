/**
 * One raw measurement table at a time: a picker over the 36 tables the audit
 * kept, the eight numbers of every numeric column, the rows, and one panel per
 * column. The raw tables have different schemas, so the server sends one.
 */

import { eightNumberSummary } from "@shared/lens/stats";
import type { RawTable, RawTableIndexRow } from "@shared/studies/data-lifecycle-audit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { ControlBar, SliderControl, SwitchControl, fmtInt } from "@/studies/kit";
import { ColumnPanels } from "./ColumnPanels";
import { DataTable, type TableColumn } from "./DataTable";
import { compact } from "./style";

type RawRow = Record<string, unknown>;

function optionLabel(entry: RawTableIndexRow): string {
  return `${entry.strand} · ${entry.source_file} (${fmtInt(entry.row_count)} rows)`;
}

function numbersOf(rows: readonly RawRow[], column: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const value = row[column];
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

const SUMMARY_HEADERS = ["column", "rows", "mean", "median", "standard deviation", "skewness (G1)", "kurtosis (G2, excess)", "25th percentile", "75th percentile", "minimum", "maximum"];

function EightNumberTable({ table }: { table: RawTable }) {
  const numeric = table.columns.filter((column) => column.type === "number");
  if (numeric.length === 0) return <p className="text-xs text-neutral-500">This table has no numeric column, so there is no eight-number summary.</p>;
  return (
    <div className="overflow-x-auto rounded border border-neutral-800">
      <table className="w-full min-w-max border-collapse text-[11px] font-mono tnum">
        <thead>
          <tr className="border-b border-neutral-800 bg-neutral-900/60 text-neutral-500">
            {SUMMARY_HEADERS.map((header, position) => (
              <th key={header} className={`px-2 py-1 font-sans font-normal ${position === 0 ? "text-left" : "text-right"}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {numeric.map((column) => {
            const summary = eightNumberSummary(numbersOf(table.rows, column.name));
            const cells = [summary.count, summary.mean, summary.median, summary.standardDeviation, summary.skewness, summary.kurtosis, summary.percentile25, summary.percentile75, summary.minimum, summary.maximum];
            return (
              <tr key={column.name} className="border-b border-neutral-900">
                <td className="whitespace-nowrap px-2 py-1 font-sans text-neutral-200">{column.name}</td>
                {cells.map((value, position) => (
                  <td key={SUMMARY_HEADERS[position + 1]} className="px-2 py-1 text-right text-neutral-200">{position === 0 ? fmtInt(value) : compact(value)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RawSection({ index, table, selected, onSelect, bins, top, logScale, onBins, onTop, onLogScale }: {
  index: readonly RawTableIndexRow[];
  table: RawTable | null;
  selected: string;
  onSelect: (name: string) => void;
  bins: number;
  top: number;
  logScale: boolean;
  onBins: (value: number) => void;
  onTop: (value: number) => void;
  onLogScale: (value: boolean) => void;
}) {
  const current = table?.name ?? selected;
  const columns: Array<TableColumn<RawRow>> = (table?.columns ?? []).map((column) => ({
    key: column.name,
    label: column.name,
    value: (row) => {
      const value = row[column.name];
      return value === null || value === undefined ? null : typeof value === "object" ? JSON.stringify(value) : (value as string | number | boolean);
    },
    align: column.type === "number" ? "right" : "left",
  }));

  return (
    <div className="min-w-0 space-y-3">
      <ControlBar>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Raw measurement table</span>
          <Select value={current} onValueChange={onSelect}>
            <SelectTrigger className="h-7 w-[min(28rem,80vw)] text-xs"><SelectValue placeholder="Choose a table" /></SelectTrigger>
            <SelectContent className="max-h-80">
              {index.map((entry) => (
                <SelectItem key={entry.raw_table_name} value={entry.raw_table_name} className="text-xs">{optionLabel(entry)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <SliderControl label="Bins per numeric panel" value={bins} min={5} max={80} onChange={onBins} />
        <SliderControl label="Values per category panel" value={top} min={5} max={40} onChange={onTop} />
        <SwitchControl label="Log scale on counts" checked={logScale} onChange={onLogScale} />
      </ControlBar>
      {table === null ? (
        <p className="text-xs text-neutral-500">This raw table is not in the lake, so there is nothing to draw.</p>
      ) : (
        <>
          <p className="text-xs text-neutral-200">
            <span className="font-mono font-semibold">{table.name}</span> — {fmtInt(table.rowCount)} rows, {table.columns.length} columns
            {table.truncated && <span className="text-[#E69F00]"> (first {fmtInt(table.rows.length)} shown)</span>}
          </p>
          <div className="space-y-1">
            <h4 className="text-[11px] font-medium text-neutral-300">Eight-number summary, every numeric column</h4>
            <EightNumberTable table={table} />
            <p className="text-[10px] text-neutral-500">
              Skewness G1 and excess kurtosis G2 are the dashboard's sample-adjusted estimators; the retired notebook printed the unadjusted ones, which differ by a factor that tends to 1 as the rows grow (see the walk-through below).
            </p>
          </div>
          <DataTable rows={table.rows} columns={columns} rowKey={(_row, position) => String(position)} pageSize={10} label="The rows" />
          <ColumnPanels rows={table.rows} columns={table.columns.map((column) => ({ name: column.name, numeric: column.type === "number" }))} top={top} bins={bins} logScale={logScale} />
        </>
      )}
    </div>
  );
}
