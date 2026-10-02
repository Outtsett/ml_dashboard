/**
 * Every column of the study table, one panel each: a histogram with its eight
 * numbers for the twelve numeric columns, a count bar chart for the three
 * categorical ones, the eight-number table, and the table itself.
 */

import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ControlBar, OKABE, SliderControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import {
  CATEGORICAL_COLUMNS, NUMERIC_COLUMNS, equalBins, notebookEightNumbers, type NotebookEightNumbers, type StudyRow,
} from "@shared/studies/single-candle-recognizer";

function numbersOf(rows: readonly StudyRow[], column: (typeof NUMERIC_COLUMNS)[number]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const value = row[column];
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out;
}

const STAT_ROWS: Array<[keyof NotebookEightNumbers, string]> = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "sd"], ["skewness", "skew"], ["excessKurtosis", "ex.kurt"],
  ["percentile25", "p25"], ["percentile75", "p75"], ["minimum", "min"], ["maximum", "max"],
];

function NumericPanel({ column, values, bins }: { column: string; values: number[]; bins: number }) {
  const summary = notebookEightNumbers(values);
  const data = equalBins(values, bins).map((bin) => ({ middle: (bin.lower + bin.upper) / 2, ...bin }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={column}>{column}</div>
      <ResponsiveContainer width="100%" height={96}>
        <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="middle" hide />
          <YAxis hide />
          <Tooltip
            {...TOOLTIP}
            formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "rows"]}
            labelFormatter={(_label, payload) => {
              const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return bin ? `${fmt(bin.lower, 4)} to ${fmt(bin.upper, 4)}` : "";
            }}
          />
          <Bar dataKey="count" fill={OKABE.blue} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      {summary && (
        <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[10px] font-mono tnum">
          <dt className="col-span-3 text-neutral-500">n {fmtInt(summary.count)}</dt>
          {STAT_ROWS.map(([key, label]) => (
            <div key={key} className="flex justify-between gap-1">
              <span className="text-neutral-500">{label}</span>
              <span className="text-neutral-200">{fmt(summary[key] as number | null, 3)}</span>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function CountPanel({ column, rows }: { column: (typeof CATEGORICAL_COLUMNS)[number]; rows: readonly StudyRow[] }) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(String(row[column]), (counts.get(String(row[column])) ?? 0) + 1);
  const data = [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200">{column}</div>
      <ResponsiveContainer width="100%" height={Math.max(70, 16 * data.length + 10)}>
        <BarChart data={data} layout="vertical" margin={{ top: 2, right: 28, left: 2, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={130} interval={0} tick={{ fontSize: 9, fill: "#a3a3a3" }} axisLine={false} tickLine={false} />
          <Tooltip {...TOOLTIP} formatter={(value) => [fmtInt(Number(value)), "rows"]} />
          <Bar dataKey="count" fill={OKABE.orange} isAnimationActive={false} label={{ position: "right", fontSize: 9, fill: "#d4d4d4" }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ColumnPanels({ rows, bins, onBins }: { rows: readonly StudyRow[]; bins: number; onBins: (value: number) => void }) {
  return (
    <div className="space-y-2">
      <ControlBar>
        <SliderControl label="Histogram bins" value={bins} min={5} max={50} onChange={onBins} />
        <p className="max-w-prose pb-1 text-[11px] text-neutral-400">
          One row per (model, feature set, pattern). Every numeric column gets its own distribution and every categorical column its own count.
        </p>
      </ControlBar>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
        {NUMERIC_COLUMNS.map((column) => (
          <NumericPanel key={column} column={column} values={numbersOf(rows, column)} bins={bins} />
        ))}
        {CATEGORICAL_COLUMNS.map((column) => (
          <CountPanel key={column} column={column} rows={rows} />
        ))}
      </div>
    </div>
  );
}

export function EightNumberTable({ rows }: { rows: readonly StudyRow[] }) {
  const headings = ["column", "count", "mean", "median", "standard deviation", "skewness", "excess kurtosis", "25th percentile", "75th percentile", "minimum", "maximum"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono tnum">
        <thead>
          <tr className="text-neutral-500">
            {headings.map((heading, index) => (
              <th key={heading} className={`whitespace-nowrap px-1 py-0.5 font-normal ${index === 0 ? "text-left" : "text-right"}`}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NUMERIC_COLUMNS.map((column) => {
            const summary = notebookEightNumbers(numbersOf(rows, column));
            if (!summary) return null;
            const cells = [summary.mean, summary.median, summary.standardDeviation, summary.skewness, summary.excessKurtosis, summary.percentile25, summary.percentile75, summary.minimum, summary.maximum];
            return (
              <tr key={column} className="border-t border-neutral-900">
                <td className="px-1 py-0.5 text-left text-neutral-300">{column}</td>
                <td className="px-1 py-0.5 text-right text-neutral-200">{fmtInt(summary.count)}</td>
                {cells.map((value, index) => (
                  <td key={headings[index + 2]} className="px-1 py-0.5 text-right text-neutral-200">{fmt(value, 4)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const TABLE_COLUMNS: Array<keyof StudyRow> = [
  "feature_set", "model_name", "pattern_name", "feature_count", "accuracy", "balanced_accuracy", "precision", "recall", "f1_score",
  "area_under_curve", "average_precision", "prevalence", "positive_count", "train_positive_count", "train_bar_count", "test_bar_count", "training_seconds",
];
const PAGE_SIZE = 25;

export function StudyTable({ rows }: { rows: readonly StudyRow[] }) {
  const [sortColumn, setSortColumn] = useState<keyof StudyRow | null>(null);
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(0);
  const sorted = [...rows];
  if (sortColumn) {
    sorted.sort((a, b) => {
      const left = a[sortColumn];
      const right = b[sortColumn];
      const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
      return descending ? -order : order;
    });
  }
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              {TABLE_COLUMNS.map((column) => (
                <th key={column} className="whitespace-nowrap px-1 py-0.5 text-left font-normal">
                  <button
                    type="button"
                    className="hover:text-neutral-200"
                    onClick={() => {
                      if (sortColumn === column) setDescending(!descending);
                      else { setSortColumn(column); setDescending(false); }
                      setPage(0);
                    }}
                  >
                    {column}{sortColumn === column ? (descending ? " ▼" : " ▲") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={`${row.feature_set}|${row.model_name}|${row.pattern_name}`} className="border-t border-neutral-900">
                {TABLE_COLUMNS.map((column) => {
                  const value = row[column];
                  return (
                    <td key={column} className="whitespace-nowrap px-1 py-0.5 text-neutral-200">
                      {typeof value === "number" ? (Number.isInteger(value) ? fmtInt(value) : fmt(value, 4)) : String(value ?? "—")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">Previous</button>
        <span>page {current + 1} of {pages} · {fmtInt(sorted.length)} rows</span>
        <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
