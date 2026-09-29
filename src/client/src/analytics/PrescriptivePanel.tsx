/**
 * Prescriptive — what should we do: pick the outcome you want (most profit,
 * highest win chance, best reward for the risk) and the page names the action
 * for the next `horizon` bars, the Model Cycle run that best served that goal,
 * the confidence levels worth trading and the hours to stay out of.
 */

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GOAL_LABEL, type AnalyticsResponse, type Goal } from "@shared/analytics/types";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { AXIS, GRID, OKABE, ProbabilityBar, Section, TOOLTIP, fmt, fmtPercent, fmtTime, fmtUsd } from "./common";

const ACTION_COLOR = { long: OKABE.orange, short: OKABE.blue, flat: OKABE.grey } as const;
const ACTION_LABEL = { long: "Go long", short: "Go short", flat: "Stay flat" } as const;

export function PrescriptivePanel({ data }: { data: AnalyticsResponse }) {
  const [goal, setGoal] = useState<Goal>("profit");
  const p = data.prescriptive;
  const rec = p.recommendations.find((row) => row.goal === goal) ?? p.recommendations[0];
  const priced = p.costPriced;
  const chartRows = p.actions.map((row) => {
    const value = priced ? row.expectedNetUsd : row.expectedNetPoints;
    return { action: row.action, value: value ?? 0 };
  });

  return (
    <div className="space-y-3">
      <Section title="The outcome you want" question="Choose a goal; the recommendation below follows it">
        <ToggleGroup
          type="single"
          value={goal}
          onValueChange={(value) => value && setGoal(value as Goal)}
          aria-label="Goal"
          className="flex-wrap justify-start gap-2"
        >
          {(Object.keys(GOAL_LABEL) as Goal[]).map((key) => (
            <ToggleGroupItem
              key={key}
              value={key}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 data-[state=on]:border-[#E69F00] data-[state=on]:bg-[#E69F00]/10 data-[state=on]:text-[#E69F00]"
            >
              {GOAL_LABEL[key]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>

      {rec && (
        <Section title="Recommendation" question={`For "${GOAL_LABEL[rec.goal]}", over the next ${p.horizonBars} bars from the state at the last bar, ${fmtTime(p.asOf)} (${data.clock})`}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-lg border px-4 py-3 text-lg font-semibold" style={{ borderColor: ACTION_COLOR[rec.action], color: ACTION_COLOR[rec.action] }}>
              {rec.action === "long" ? "▲ " : rec.action === "short" ? "▼ " : "■ "}
              {ACTION_LABEL[rec.action]}
            </div>
            <p className="max-w-3xl text-xs text-neutral-300">{rec.reason}</p>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3 text-[11px]">
            <div className="rounded-md border border-neutral-800 p-2">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Model Cycle run for this goal</div>
              {rec.run ? (
                <>
                  <div className="text-neutral-100">{rec.run.modelLabel}</div>
                  <div className="font-mono text-neutral-500 truncate" title={rec.run.modelId}>
                    {rec.run.modelId}
                  </div>
                  <div className="text-neutral-300">
                    best {rec.run.metric}: {rec.run.metric === "win rate" ? fmtPercent(rec.run.value) : rec.run.metric.includes("USD") ? fmtUsd(rec.run.value) : fmt(rec.run.value, 3)}
                  </div>
                </>
              ) : (
                <div className="text-neutral-500">No finished run on this symbol.</div>
              )}
            </div>
            <div className="rounded-md border border-neutral-800 p-2">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Confidence levels to trade (that run)</div>
              <div className="text-neutral-300">
                trade: {rec.confidenceBuckets.keep.length ? rec.confidenceBuckets.keep.join(", ") : "none earned a positive expectancy over 20+ trades"}
              </div>
              <div className="text-neutral-500">skip: {rec.confidenceBuckets.skip.join(", ") || "—"}</div>
            </div>
            <div className="rounded-md border border-neutral-800 p-2">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Hours to stay out ({data.clock})</div>
              <div className="text-neutral-300">{rec.hoursToAvoid.length ? rec.hoursToAvoid.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ") : "none lost money over 20+ bars in a position"}</div>
              <div className="text-neutral-500">worst first; hours where that run's positions lost money</div>
            </div>
          </div>
        </Section>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <Section
          title="Each action, from this state"
          question={priced ? `Expected result per contract after the ${fmtUsd(data.cost?.roundTripCostUsd)} round trip; 10th and 90th percentiles below` : "Expected move in points before costs (no cost model for this symbol)"}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartRows} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="action" {...AXIS} tickFormatter={(value: keyof typeof ACTION_LABEL) => ACTION_LABEL[value]} />
              <YAxis {...AXIS} width={56} tickFormatter={(value: number) => (priced ? fmtUsd(value) : fmt(value, 4))} />
              <ReferenceLine y={0} stroke={OKABE.grey} />
              <Tooltip {...TOOLTIP} formatter={(value: number) => [priced ? fmtUsd(value) : `${fmt(value, 5)} pts`, "expected"]} />
              <Bar dataKey="value" isAnimationActive={false}>
                {chartRows.map((row) => (
                  <Cell key={row.action} fill={ACTION_COLOR[row.action]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {priced && (
            <div className="mt-1 grid grid-cols-3 text-center text-[10px] font-mono tnum text-neutral-400">
              {p.actions.map((row) => (
                <span key={row.action}>
                  p10 {fmtUsd(row.downsideP10Usd)} · p90 {fmtUsd(row.upsideP90Usd)}
                </span>
              ))}
            </div>
          )}
        </Section>
        <Section title="Chance each trade ends in profit" question="After costs, with the 95% interval; half-Kelly size where the edge is positive">
          <div className="space-y-3">
            {p.actions
              .filter((row) => row.action !== "flat")
              .map((row) => (
                <div key={row.action} className="space-y-1">
                  <ProbabilityBar label={ACTION_LABEL[row.action]} probability={row.probabilityProfit} color={ACTION_COLOR[row.action]} />
                  <div className="flex justify-between text-[10px] font-mono tnum text-neutral-400">
                    <span>reward / 10th-percentile loss {fmt(row.rewardToRisk, 3)}</span>
                    <span>half-Kelly {fmtPercent(row.kellyFraction)} of risk capital</span>
                  </div>
                </div>
              ))}
          </div>
        </Section>
      </div>

      <Section title="Read before acting">
        <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-neutral-400">
          {p.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

