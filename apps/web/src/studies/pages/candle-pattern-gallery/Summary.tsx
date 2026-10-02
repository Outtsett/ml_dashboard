/**
 * The notebook's 61-row summary table, sortable and clickable (a row picks
 * the pattern), beside the chart it was missing: real firings per pattern on
 * MNQ 5-minute bars, bullish against bearish, on a linear or log axis.
 */

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, GRID, OKABE, Section, SliderControl, Stat, SwitchControl, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import type { GallerySummaryRow } from "@shared/studies/candle-pattern-gallery";

interface Column {
  key: keyof GallerySummaryRow;
  label: string;
  title: string;
}

const COLUMNS: readonly Column[] = [
  { key: "talib_function", label: "pattern", title: "TA-Lib function name" },
  { key: "pattern_bar_count", label: "bars", title: "Bars the TA-Lib rule reads" },
  { key: "real_hit_count", label: "real hits", title: "Firings on MNQ 5-minute bars, 2019 to 2025, all of them" },
  { key: "bullish_real_hit_count", label: "▲ bullish", title: "Real firings with a positive TA-Lib value" },
  { key: "bearish_real_hit_count", label: "▼ bearish", title: "Real firings with a negative TA-Lib value" },
  { key: "real_example_count", label: "real examples", title: "Real firings kept as examples (up to 12 per side, spread across time)" },
  { key: "random_search_synthetic_example_count", label: "synthetic (random search)", title: "Examples found by random search on a synthetic series and verified to fire" },
  { key: "textbook_synthetic_example_count", label: "synthetic (textbook)", title: "Hand-built textbook constructions verified to fire" },
  { key: "example_count", label: "examples", title: "All examples in the gallery" },
];

function SummaryTable({ rows, selected, onPick }: { rows: readonly GallerySummaryRow[]; selected: string | null; onPick: (pattern: string) => void }) {
  const [sort, setSort] = useState<{ key: keyof GallerySummaryRow; descending: boolean }>({ key: "talib_function", descending: false });
  const ordered = [...rows].sort((a, b) => {
    const x = a[sort.key];
    const y = b[sort.key];
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sort.descending ? -order : order;
  });
  return (
    <div className="max-h-[420px] overflow-auto rounded-md border border-neutral-800">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-neutral-900">
          <tr>
            {COLUMNS.map((column) => {
              const active = sort.key === column.key;
              return (
                <th key={column.key} title={column.title} className={`whitespace-nowrap px-2 py-1 font-normal text-neutral-400 ${column.key === "talib_function" ? "text-left" : "text-right"}`}>
                  <button type="button" className="hover:text-neutral-100" onClick={() => setSort({ key: column.key, descending: active ? !sort.descending : false })}>
                    {column.label}
                    {active ? (sort.descending ? " ▼" : " ▲") : ""}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr
              key={row.talib_function}
              onClick={() => onPick(row.talib_function)}
              className={`cursor-pointer border-t border-neutral-800/70 hover:bg-neutral-800/50 ${row.talib_function === selected ? "bg-neutral-800" : ""}`}
            >
              {COLUMNS.map((column) => (
                <td key={column.key} className={`px-2 py-0.5 ${column.key === "talib_function" ? "font-mono text-neutral-100" : "text-right font-mono tnum text-neutral-300"}`}>
                  {column.key === "talib_function" ? `${row.talib_function === selected ? "● " : ""}${row.talib_function}` : fmtInt(row[column.key] as number)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Summary({ rows, selected, onPick, top, onTop, logScale, onLogScale }: {
  rows: readonly GallerySummaryRow[]; selected: string | null; onPick: (pattern: string) => void;
  top: number; onTop: (value: number) => void; logScale: boolean; onLogScale: (value: boolean) => void;
}) {
  const realTotal = rows.reduce((sum, row) => sum + row.real_hit_count, 0);
  const bullishTotal = rows.reduce((sum, row) => sum + row.bullish_real_hit_count, 0);
  const noHits = rows.filter((row) => row.real_hit_count === 0);
  const toppedUp = rows.filter((row) => row.random_search_synthetic_example_count + row.textbook_synthetic_example_count > 0);
  const oneSided = rows.filter((row) => row.real_hit_count > 0 && (row.bullish_real_hit_count === 0 || row.bearish_real_hit_count === 0));
  const ranked = [...rows].sort((a, b) => b.real_hit_count - a.real_hit_count);
  const topThree = ranked.slice(0, 3);
  const topShare = realTotal > 0 ? topThree.reduce((sum, row) => sum + row.real_hit_count, 0) / realTotal : null;
  const chart = ranked.slice(0, top).map((row) => ({
    pattern: row.talib_function,
    bullish: logScale && row.bullish_real_hit_count === 0 ? null : row.bullish_real_hit_count,
    bearish: logScale && row.bearish_real_hit_count === 0 ? null : row.bearish_real_hit_count,
    total: row.real_hit_count,
  }));

  return (
    <Section title="The 61 patterns" question="How often each TA-Lib pattern fires on MNQ 5-minute bars (2019 to 2025), and how many examples the gallery holds for it. Click a row to load the pattern above.">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Stat label="Real firings, all patterns" value={fmtInt(realTotal)} hint="Sum over the 61 patterns of every firing on 5-minute bars; one bar can fire several patterns" />
          <Stat label="Bullish share of firings" value={realTotal > 0 ? `${fmt((100 * bullishTotal) / realTotal, 1)}%` : "—"} tone={OKABE.orange} hint="Positive TA-Lib value" />
          <Stat label="Patterns with no real firing" value={fmtInt(noHits.length)} tone={noHits.length > 0 ? OKABE.blue : undefined} hint={noHits.map((row) => row.talib_function).join(", ") || "none"} />
          <Stat label="Patterns needing synthetic examples" value={fmtInt(toppedUp.length)} hint={toppedUp.map((row) => row.talib_function).join(", ") || "none"} />
        </div>
        <Finding>
          {topShare !== null && `${topThree.map((row) => row.talib_function).join(", ")} make up ${fmt(100 * topShare, 1)}% of all firings. `}
          {noHits.length > 0 && `${noHits.map((row) => row.talib_function).join(", ")} never fire on the real bars, so every example of them is constructed. `}
          {oneSided.length > 0 && `${oneSided.length} patterns fire in one direction only (${oneSided.map((row) => `${row.talib_function} ${row.bullish_real_hit_count === 0 ? "▼" : "▲"}`).join(", ")}).`}
        </Finding>
        <SummaryTable rows={rows} selected={selected} onPick={onPick} />
        <ControlBar>
          <SliderControl label="Patterns in the chart" value={Math.min(top, rows.length)} min={5} max={Math.max(5, rows.length)} onChange={onTop} hint="The most frequent first" />
          <SwitchControl label="Log axis (zero counts dropped)" checked={logScale} onChange={onLogScale} />
        </ControlBar>
        <ResponsiveContainer width="100%" height={Math.max(240, 26 * chart.length)}>
          <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }} barCategoryGap={2}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} scale={logScale ? "log" : "auto"} domain={logScale ? [1, "auto"] : [0, "auto"]} allowDataOverflow tickFormatter={(value: number) => fmtInt(value)} />
            <YAxis type="category" dataKey="pattern" width={150} {...AXIS} interval={0} />
            <Tooltip
              {...TOOLTIP}
              content={({ payload }) => {
                const row = payload?.[0]?.payload as (typeof chart)[number] | undefined;
                if (!row) return null;
                return (
                  <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                    <div className="font-semibold">{row.pattern}</div>
                    <div>▲ bullish {fmtInt(row.bullish ?? 0)}</div>
                    <div>▼ bearish {fmtInt(row.bearish ?? 0)}</div>
                    <div>total {fmtInt(row.total)}</div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="bullish" name="▲ bullish" fill={OKABE.orange} isAnimationActive={false} />
            <Bar dataKey="bearish" name="▼ bearish" fill={OKABE.blue} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}
