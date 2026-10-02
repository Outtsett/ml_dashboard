/**
 * Section 0: every recent finding on a timeline by area, its verdict as a
 * colour and a shape, a count per verdict, and the full table.
 */

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Finding, GRID, Section, TOOLTIP } from "@/studies/kit";
import { VERDICTS, type FindingRow } from "@shared/studies/pattern-casebook";
import { Glyph, glyphShape, type GlyphName } from "./glyphs";

const DAY = 86_400_000;

function dayOf(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function FindingsSection({ findings, shown, onShownChange }: { findings: FindingRow[]; shown: string; onShownChange: (next: string) => void }) {
  const present = VERDICTS.filter((entry) => findings.some((row) => row.verdict === entry.verdict));
  const selected = shown === "all" ? new Set(present.map((entry) => entry.verdict as string)) : new Set(shown.split("|").filter(Boolean));
  const toggle = (verdict: string) => {
    const next = new Set(selected);
    if (next.has(verdict)) next.delete(verdict);
    else next.add(verdict);
    onShownChange(next.size === present.length ? "all" : [...next].join("|"));
  };
  const rows = findings.filter((row) => selected.has(row.verdict));
  const areas = [...new Set(findings.map((row) => row.area))].sort();
  const points = rows.map((row) => ({ ...row, day: dayOf(row.finding_date), areaIndex: areas.indexOf(row.area) }));
  const days = findings.map((row) => dayOf(row.finding_date));
  const counts = present
    .filter((entry) => selected.has(entry.verdict))
    .map((entry) => ({ verdict: entry.verdict as string, colour: entry.colour as string, results: rows.filter((row) => row.verdict === entry.verdict).length }));
  const noEdge = rows.filter((row) => row.verdict === "no edge").length;
  const pays = rows.filter((row) => row.verdict === "pays after costs").length;

  return (
    <Section title="0 · Every recent finding, and what it means in dollars" question="Each row was re-derived on 2026-09-15 from the table, CSV or JSON that produced it; pick verdicts to filter the timeline and the table.">
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="verdicts shown">
        {present.map((entry) => (
          <button
            key={entry.verdict}
            type="button"
            aria-pressed={selected.has(entry.verdict)}
            onClick={() => toggle(entry.verdict)}
            className={`flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] ${selected.has(entry.verdict) ? "border-neutral-500 bg-neutral-800 text-neutral-100" : "border-neutral-800 text-neutral-500 line-through"}`}
          >
            <Glyph name={entry.glyph as GlyphName} colour={entry.colour} />
            {entry.verdict}
          </button>
        ))}
      </div>
      <Finding>
        {rows.length} results shown: {noEdge} say no edge and {pays} pays after costs. Hover a point for the result and what it means on one contract.
      </Finding>
      <div className="mt-2 grid min-w-0 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid {...GRID} />
              <XAxis
                type="number"
                dataKey="day"
                name="date of the result"
                domain={[Math.min(...days) - 2 * DAY, Math.max(...days) + 2 * DAY]}
                tickFormatter={(value: number) => new Date(value).toISOString().slice(5, 10)}
                {...AXIS}
              />
              <YAxis
                type="number"
                dataKey="areaIndex"
                domain={[-0.5, areas.length - 0.5]}
                ticks={areas.map((_, index) => index)}
                tickFormatter={(value: number) => areas[value] ?? ""}
                width={130}
                interval={0}
                {...AXIS}
              />
              <Tooltip
                {...TOOLTIP}
                cursor={{ strokeDasharray: "3 3" }}
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as (typeof points)[number] | undefined;
                  if (!row) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="max-w-sm space-y-1 px-2 py-1 text-[11px]">
                      <div className="font-semibold">{row.finding_date} · {row.repository} · {row.verdict}</div>
                      <div>{row.finding}</div>
                      <div className="text-neutral-400">{row.result}</div>
                      <div className="text-[#E69F00]">In trader terms: {row.in_trader_terms}</div>
                    </div>
                  );
                }}
              />
              {VERDICTS.map((entry) => (
                <Scatter
                  key={entry.verdict}
                  name={entry.verdict}
                  data={points.filter((point) => point.verdict === entry.verdict)}
                  shape={glyphShape(entry.glyph as GlyphName, entry.colour, 7)}
                  isAnimationActive={false}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-neutral-400">How many say what</p>
          <ResponsiveContainer width="100%" height={Math.max(160, 34 * counts.length)}>
            <BarChart data={counts} layout="vertical" margin={{ top: 4, right: 28, left: 4, bottom: 4 }}>
              <XAxis type="number" allowDecimals={false} {...AXIS} />
              <YAxis type="category" dataKey="verdict" width={150} interval={0} {...AXIS} />
              <Tooltip {...TOOLTIP} formatter={(value) => [String(value), "results"]} />
              <Bar dataKey="results" isAnimationActive={false}>
                {counts.map((entry) => (
                  <Cell key={entry.verdict} fill={entry.colour} />
                ))}
                <LabelList dataKey="results" position="right" fill="#d4d4d4" fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="mt-3 max-h-[420px] overflow-auto rounded border border-neutral-800">
        <table className="w-full min-w-[900px] text-left text-[11px]">
          <thead className="sticky top-0 bg-neutral-900 text-neutral-400">
            <tr>
              {["finding date", "repository", "finding", "verdict", "result", "in trader terms", "where to see it", "computed source"].map((heading) => (
                <th key={heading} className="px-2 py-1 font-normal">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const entry = VERDICTS.find((candidate) => candidate.verdict === row.verdict);
              return (
                <tr key={`${row.finding_date}|${row.finding}`} className="border-t border-neutral-900 align-top text-neutral-300">
                  <td className="whitespace-nowrap px-2 py-1 font-mono">{row.finding_date}</td>
                  <td className="px-2 py-1">{row.repository}</td>
                  <td className="px-2 py-1 text-neutral-100">{row.finding}</td>
                  <td className="whitespace-nowrap px-2 py-1">
                    {entry && <Glyph name={entry.glyph as GlyphName} colour={entry.colour} />} {row.verdict}
                  </td>
                  <td className="px-2 py-1">{row.result}</td>
                  <td className="px-2 py-1">{row.in_trader_terms}</td>
                  <td className="px-2 py-1 text-neutral-500">{row.where_to_see_it}</td>
                  <td className="px-2 py-1 text-neutral-500">{row.computed_source}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
