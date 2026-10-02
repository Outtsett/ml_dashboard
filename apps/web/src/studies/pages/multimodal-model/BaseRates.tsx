/**
 * Base rates: what a coin-flip entry earns with the same brackets and costs,
 * by decision hour and by year. It is the bar every model must beat. The
 * labels are scored on the development window only (the last year ends in
 * June 2025), so the holdout is not in any of these numbers.
 */

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BaseRateRow, MultimodalBody } from "@shared/studies/multimodal-model";
import { AXIS, ColumnGrid, ControlBar, Empty, Finding, GRID, OKABE, Section, SegmentControl, TOOLTIP, fmt, fmtInt, fmtPercent } from "@/studies/kit";
import type { TabProps } from "./controls";
import { cividis } from "./parts";

const BRACKETS = [
  { side: 1, reward: 2, label: "long 2:1", glyph: "▲" },
  { side: 1, reward: 3, label: "long 3:1", glyph: "△" },
  { side: -1, reward: 2, label: "short 2:1", glyph: "▼" },
  { side: -1, reward: 3, label: "short 3:1", glyph: "▽" },
] as const;

function recipeLabel(recipe: string): string {
  if (recipe.endsWith("_nq")) return "NQ (history to 2019)";
  return "MNQ (the traded contract)";
}

function Heatmap({ rows, columns, columnLabel, columnTitle }: { rows: BaseRateRow[]; columns: number[]; columnLabel: (value: number) => string; columnTitle: string }) {
  const keyOf = (row: BaseRateRow) => (row.decision_hour ?? row.year) as number;
  const values = rows.map((row) => row.profit_factor).filter((value): value is number => value !== null);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const scale = (value: number) => (high > low ? (value - low) / (high - low) : 0.5);
  return (
    <div className="min-w-0 space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-0.5 text-center text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              <th className="text-left font-normal">bracket</th>
              {columns.map((column) => (
                <th key={column} className="font-normal" title={columnTitle}>{columnLabel(column)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BRACKETS.map((bracket) => (
              <tr key={bracket.label}>
                <td className="whitespace-nowrap pr-2 text-left text-neutral-300">{bracket.glyph} {bracket.label}</td>
                {columns.map((column) => {
                  const cell = rows.find((row) => row.side === bracket.side && row.reward_multiple === bracket.reward && keyOf(row) === column);
                  if (!cell || cell.profit_factor === null) return <td key={column} className="rounded bg-neutral-900 text-neutral-600">—</td>;
                  const colour = cividis(scale(cell.profit_factor));
                  return (
                    <td
                      key={column}
                      className="rounded px-1 py-2"
                      style={{ background: colour.background, color: colour.text }}
                      title={`${bracket.label}, ${columnLabel(column)}: profit factor ${fmt(cell.profit_factor, 3)}; win rate ${fmtPercent(cell.win_rate, 1)}; win ÷ loss ${fmt(cell.payoff_ratio, 2)}; expectancy ${fmt(cell.expectancy_points, 3)} points; ${fmtInt(cell.candidate_count)} entries over ${fmtInt(cell.session_count)} sessions`}
                    >
                      {fmt(cell.profit_factor, 2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-neutral-400">
        <span className="font-mono">{fmt(low, 2)}</span>
        <div className="h-2 w-40 rounded" style={{ background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => cividis(t).background).join(", ")})` }} />
        <span className="font-mono">{fmt(high, 2)}</span>
        <span>profit factor of a coin-flip entry (cividis; 1.0 breaks even, the gate is 2.0)</span>
      </div>
    </div>
  );
}

export function BaseRates({ controls, set, body }: TabProps & { body: MultimodalBody }) {
  const all = body.baseRates;
  if (all.length === 0) return <Empty>Base rates are not landed (derived_multimodal_labels_base_rates).</Empty>;
  const recipes = [...new Set(all.map((row) => row.recipe))].sort();
  const recipe = recipes.includes(controls.baseRecipe) ? controls.baseRecipe : (recipes[0] as string);
  const mine = all.filter((row) => row.recipe === recipe);
  const breakdown = controls.breakdown === "year" ? "year" : "decision_hour";
  const cells = mine.filter((row) => row.breakdown === breakdown);
  const columns = [...new Set(cells.map((row) => (breakdown === "year" ? row.year : row.decision_hour)).filter((value): value is number => value !== null))].sort((a, b) => a - b);
  const overall = mine.filter((row) => row.breakdown === "all");
  const cellValues = cells.map((row) => row.profit_factor).filter((value): value is number => value !== null);
  const best = cells.filter((row) => row.profit_factor !== null).sort((a, b) => (b.profit_factor as number) - (a.profit_factor as number))[0];

  const overallBars = BRACKETS.map((bracket) => {
    const row = overall.find((candidate) => candidate.side === bracket.side && candidate.reward_multiple === bracket.reward);
    return { label: `${bracket.glyph} ${bracket.label}`, profit_factor: row?.profit_factor ?? null, win_rate: row?.win_rate ?? null };
  });

  return (
    <div className="space-y-3">
      <ControlBar>
        <SegmentControl
          label="Instrument"
          value={recipe}
          options={recipes.map((value) => ({ value, label: recipeLabel(value) }))}
          onChange={(value) => set("baseRecipe", value)}
          hint="The model trades MNQ; the NQ labels reach back to 2010 and were used for history. The notebook drew both in one heatmap."
        />
        <SegmentControl
          label="Break down by"
          value={breakdown}
          options={[
            { value: "decision_hour", label: "decision hour" },
            { value: "year", label: "year" },
          ]}
          onChange={(value) => set("breakdown", value)}
        />
      </ControlBar>

      <Section
        title="Coin-flip entries: profit factor, the bar every model must beat"
        question={`Every candidate entry of ${recipeLabel(recipe)} taken blindly with the same ATR-scaled bracket and costs. Hours are Pacific wall clock as the lake stamps futures; ${breakdown === "year" ? "the last year is January to June 2025" : "each cell pools every year"}.`}
      >
        {columns.length === 0 ? (
          <Empty>No {breakdown === "year" ? "yearly" : "hourly"} rows for this instrument.</Empty>
        ) : (
          <Heatmap rows={cells} columns={columns} columnLabel={(value) => (breakdown === "year" ? String(value) : `${String(value).padStart(2, "0")}:00`)} columnTitle={breakdown === "year" ? "year" : "decision hour, Pacific"} />
        )}
        {best && (
          <Finding>
            Across {fmtInt(cellValues.length)} cells a blind entry scores a profit factor of {fmt(Math.min(...cellValues), 3)} to {fmt(Math.max(...cellValues), 3)}; the best is {fmt(best.profit_factor, 3)} ({BRACKETS.find((bracket) => bracket.side === best.side && bracket.reward === best.reward_multiple)?.label},{" "}
            {breakdown === "year" ? best.year : `${String(best.decision_hour).padStart(2, "0")}:00`}). A model that only matches this has no edge; the gate asks for 2.0.
          </Finding>
        )}
      </Section>

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <Section title="Overall, every hour and year pooled" question="Profit factor of a blind entry per bracket.">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={overallBars} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis {...AXIS} width={36} domain={[0, 2.2]} />
              <ReferenceLine y={1} stroke={OKABE.grey} />
              <ReferenceLine y={2} stroke={OKABE.orange} strokeDasharray="6 4" label={{ value: "G4: 2.0", fill: OKABE.orange, fontSize: 9, position: "insideTopRight" }} />
              <Tooltip {...TOOLTIP} formatter={(value: number) => [fmt(value, 3), "profit factor"]} />
              <Bar dataKey="profit_factor" isAnimationActive={false}>
                {overallBars.map((row) => (
                  <Cell key={row.label} fill={(row.profit_factor ?? 0) >= 1 ? OKABE.orange : OKABE.blue} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-neutral-400">Orange (▲) at or above break-even 1.0, blue (▼) below it.</p>
        </Section>
        <Section title="What a blind bracket does" question="Shares of entries that hit the target, hit the stop, or were closed at the session end, and the typical distances.">
          {overall.length === 0 ? (
            <Empty>No pooled row.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[11px] font-mono tnum">
                <thead className="text-neutral-500">
                  <tr>
                    {["bracket", "win rate", "win ÷ loss", "expectancy, points", "target hit", "stop hit", "session end", "median stop", "median target", "median minutes"].map((label) => (
                      <th key={label} className="py-0.5 pr-2 text-right font-normal first:text-left">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BRACKETS.map((bracket) => {
                    const row = overall.find((candidate) => candidate.side === bracket.side && candidate.reward_multiple === bracket.reward);
                    if (!row) return null;
                    return (
                      <tr key={bracket.label} className="border-t border-neutral-900 text-neutral-200">
                        <td className="py-0.5 pr-2">{bracket.glyph} {bracket.label}</td>
                        <td className="py-0.5 pr-2 text-right">{fmtPercent(row.win_rate, 1)}</td>
                        <td className="py-0.5 pr-2 text-right">{fmt(row.payoff_ratio, 2)}</td>
                        <td className="py-0.5 pr-2 text-right">{fmt(row.expectancy_points, 3)}</td>
                        <td className="py-0.5 pr-2 text-right">{fmtPercent(row.target_hit_rate, 1)}</td>
                        <td className="py-0.5 pr-2 text-right">{fmtPercent(row.stop_rate, 1)}</td>
                        <td className="py-0.5 pr-2 text-right">{fmtPercent(row.session_end_rate, 1)}</td>
                        <td className="py-0.5 pr-2 text-right">{fmt(row.median_stop_points, 2)}</td>
                        <td className="py-0.5 pr-2 text-right">{fmt(row.median_target_points, 2)}</td>
                        <td className="py-0.5 text-right">{fmt(row.median_minutes_held, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <Section title="Every numeric column of the base-rate table" question={`${fmtInt(mine.length)} rows of ${recipeLabel(recipe)}.`}>
        <ColumnGrid rows={mine} exclude={["side", "reward_multiple", "year", "decision_hour"]} title="Base-rate columns" />
      </Section>
    </div>
  );
}
