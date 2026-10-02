/**
 * Per-pattern recognition on the test windows: AUC and average precision as
 * bars with their values written on them, prevalence (the average precision a
 * random score would get) as a diamond, and the same 17 rows as a table.
 * Clicking a bar or a row picks the pattern the next section studies.
 */

import { Bar, CartesianGrid, ComposedChart, LabelList, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, GRID, OKABE, SegmentControl, SliderControl, SwitchControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import { patternLabel, precisionLift, type PatternScoreRow } from "@shared/studies/chart-cnn-arithmetic-patterns";

export const SORT_OPTIONS = [
  { value: "auc", label: "AUC" },
  { value: "averagePrecision", label: "AP" },
  { value: "lift", label: "AP ÷ prevalence" },
  { value: "prevalence", label: "prevalence" },
  { value: "positives", label: "positives" },
  { value: "name", label: "name" },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]["value"];

const LOG_FLOOR = 1e-3;

function sortValue(row: PatternScoreRow, key: SortKey): number | null {
  switch (key) {
    case "auc": return row.area_under_curve;
    case "averagePrecision": return row.average_precision;
    case "lift": return precisionLift(row);
    case "prevalence": return row.prevalence;
    case "positives": return row.positive_window_count;
    case "name": return null;
  }
}

export function sortRows(rows: readonly PatternScoreRow[], key: SortKey): PatternScoreRow[] {
  const out = [...rows];
  if (key === "name") return out.sort((a, b) => a.pattern_name.localeCompare(b.pattern_name));
  return out.sort((a, b) => {
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (left === null && right === null) return a.pattern_name.localeCompare(b.pattern_name);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  });
}

interface ChartRow {
  pattern: string;
  label: string;
  auc: number;
  averagePrecision: number;
  prevalence: number;
  row: PatternScoreRow;
}

export function RecognitionSection({
  rows, sort, onSort, minimumPositives, onMinimumPositives, logScale, onLogScale, selected, onPick, testLabel,
}: {
  rows: readonly PatternScoreRow[];
  sort: SortKey;
  onSort: (key: SortKey) => void;
  minimumPositives: number;
  onMinimumPositives: (value: number) => void;
  logScale: boolean;
  onLogScale: (value: boolean) => void;
  selected: string;
  onPick: (pattern: string) => void;
  testLabel: string;
}) {
  const visible = sortRows(rows.filter((row) => row.positive_window_count >= minimumPositives), sort);
  const clamp = (value: number) => (logScale ? Math.max(value, LOG_FLOOR) : value);
  const data: ChartRow[] = visible.map((row) => ({
    pattern: row.pattern_name,
    label: patternLabel(row.pattern_name),
    auc: clamp(row.area_under_curve),
    averagePrecision: clamp(row.average_precision),
    prevalence: clamp(row.prevalence),
    row,
  }));
  const pick = (entry: unknown) => {
    const pattern = (entry as { payload?: ChartRow } | undefined)?.payload?.pattern;
    if (pattern) onPick(pattern);
  };

  return (
    <div className="space-y-2">
      <ControlBar>
        <SegmentControl label="Sort by" value={sort} options={SORT_OPTIONS} onChange={onSort} />
        <SliderControl
          label="Minimum positive windows"
          value={minimumPositives}
          min={0}
          max={35000}
          step={500}
          onChange={onMinimumPositives}
          format={fmtInt}
          hint="Hide the patterns that fire on fewer test windows than this"
        />
        <SwitchControl label="Log scale" checked={logScale} onChange={onLogScale} hint="Spread out the small prevalences of the rare patterns" />
      </ControlBar>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.blue }}>■ AUC</span> · <span style={{ color: OKABE.orange }}>■ average precision</span> ·{" "}
        <span className="text-neutral-200">◆ prevalence</span> (the average precision a random score gets) · {visible.length} of {rows.length} patterns · {testLabel} · click a bar to study it
      </p>
      <ResponsiveContainer width="100%" height={Math.max(240, 40 * data.length + 40)}>
        <ComposedChart data={data} layout="vertical" margin={{ top: 4, right: 44, left: 4, bottom: 4 }} barCategoryGap={4} barGap={1}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis
            type="number"
            {...AXIS}
            scale={logScale ? "log" : "linear"}
            domain={logScale ? [LOG_FLOOR, 1] : [0, 1.08]}
            allowDataOverflow
            tickFormatter={(value: number) => (logScale ? value.toExponential(0) : fmt(value, 1))}
          />
          <YAxis type="category" dataKey="label" width={108} {...AXIS} interval={0} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const item = payload?.[0]?.payload as ChartRow | undefined;
              if (!item) return null;
              const row = item.row;
              return (
                <div style={TOOLTIP.contentStyle} className="max-w-xs space-y-0.5 px-2 py-1 font-mono text-[11px]">
                  <div className="font-semibold">{patternLabel(row.pattern_name)} ({row.pattern_bar_count}-bar rule)</div>
                  <div>AUC {fmt(row.area_under_curve, 4)} · AP {fmt(row.average_precision, 4)}</div>
                  <div>prevalence {fmt(row.prevalence, 5)} · AP ÷ prevalence {fmt(precisionLift(row), 1)}</div>
                  <div>{fmtInt(row.positive_window_count)} positives of {fmtInt(row.window_count)} windows</div>
                  <div className="whitespace-normal font-sans text-neutral-400">{row.rule_in_words}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="auc" name="AUC" fill={OKABE.blue} isAnimationActive={false} onClick={pick} cursor="pointer">
            <LabelList dataKey="auc" position="right" formatter={(value: unknown) => (typeof value === "number" ? value.toFixed(3) : "")} style={{ fill: "#a3a3a3", fontSize: 9 }} />
          </Bar>
          <Bar dataKey="averagePrecision" name="average precision" fill={OKABE.orange} isAnimationActive={false} onClick={pick} cursor="pointer">
            <LabelList dataKey="averagePrecision" position="right" formatter={(value: unknown) => (typeof value === "number" ? value.toFixed(2) : "")} style={{ fill: "#a3a3a3", fontSize: 9 }} />
          </Bar>
          <Scatter dataKey="prevalence" name="prevalence" fill="#e5e5e5" shape="diamond" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <PatternTable rows={visible} sort={sort} onSort={onSort} selected={selected} onPick={onPick} />
    </div>
  );
}

const COLUMNS: Array<{ label: string; key: SortKey | null; align: "left" | "right"; render: (row: PatternScoreRow) => string }> = [
  { label: "pattern", key: "name", align: "left", render: (row) => row.pattern_name },
  { label: "bars", key: null, align: "right", render: (row) => String(row.pattern_bar_count) },
  { label: "positive windows", key: "positives", align: "right", render: (row) => fmtInt(row.positive_window_count) },
  { label: "prevalence", key: "prevalence", align: "right", render: (row) => fmt(row.prevalence, 3) },
  { label: "AUC", key: "auc", align: "right", render: (row) => fmt(row.area_under_curve, 3) },
  { label: "average precision", key: "averagePrecision", align: "right", render: (row) => fmt(row.average_precision, 3) },
  { label: "AP ÷ prevalence", key: "lift", align: "right", render: (row) => fmt(precisionLift(row), 1) },
];

function PatternTable({ rows, sort, onSort, selected, onPick }: { rows: readonly PatternScoreRow[]; sort: SortKey; onSort: (key: SortKey) => void; selected: string; onPick: (pattern: string) => void }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded border border-neutral-800">
      <table className="w-full text-[11px] font-mono tnum">
        <thead className="sticky top-0 bg-neutral-900">
          <tr className="text-neutral-500">
            {COLUMNS.map((column) => (
              <th key={column.label} className={`px-2 py-1 font-normal ${column.align === "left" ? "text-left" : "text-right"}`}>
                {column.key ? (
                  <button type="button" onClick={() => onSort(column.key as SortKey)} className={sort === column.key ? "text-neutral-100 underline" : "hover:text-neutral-300"}>
                    {column.label}
                    {sort === column.key ? " ↓" : ""}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.pattern_name}
              onClick={() => onPick(row.pattern_name)}
              className={`cursor-pointer border-t border-neutral-900 ${row.pattern_name === selected ? "bg-[#0072B2]/20 text-neutral-50" : "text-neutral-300 hover:bg-neutral-900"}`}
            >
              {COLUMNS.map((column) => (
                <td key={column.label} className={`px-2 py-0.5 ${column.align === "left" ? "text-left" : "text-right"}`}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
