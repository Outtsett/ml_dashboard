/**
 * What the model would have to do: the directional accuracy at which a
 * one-bar long/short strategy reaches zero after the round-turn cost, against
 * the accuracy this model measured. Both sliders of the notebook, live.
 */

import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, Stat, TOOLTIP, fmt } from "@/studies/kit";
import { breakEven } from "@shared/studies/quant-oos-results";
import type { OosFoldRow, OosFoldTargetRow, OosSummaryRow } from "@shared/studies/quant-oos-results";
import { sci } from "./format";

export function BreakEvenSection({
  summary, folds, foldTargets, pointValueUsd, defaultIndexLevel, costPoints, indexLevel, onCostPoints, onIndexLevel,
}: {
  summary: OosSummaryRow;
  pointValueUsd: number;
  defaultIndexLevel: number;
  folds: OosFoldRow[];
  foldTargets: OosFoldTargetRow[];
  costPoints: number;
  indexLevel: number;
  onCostPoints: (value: number) => void;
  onIndexLevel: (value: number) => void;
}) {
  const meanAbsoluteTarget = summary.pooled_mean_absolute_target;
  const measuredAccuracy = summary.pooled_directional_accuracy_nonzero_weighted;
  const result = breakEven({ costPoints, indexLevel, meanAbsoluteTarget, measuredAccuracy });

  const curve = Array.from({ length: 61 }, (_, step) => {
    const cost = step * 0.05;
    return { cost, breakEven: breakEven({ costPoints: cost, indexLevel, meanAbsoluteTarget, measuredAccuracy }).breakEvenAccuracy };
  });

  const perFold = folds.map((fold) => {
    const target = foldTargets.find((row) => row.fold_index === fold.fold_index);
    const level = target?.mean_window_end_close_price ?? indexLevel;
    const expected = target ? breakEven({ costPoints, indexLevel: level, meanAbsoluteTarget: target.mean_absolute_target, measuredAccuracy: fold.directional_accuracy }) : null;
    return {
      fold: `fold ${fold.fold_index}`,
      required: expected?.breakEvenAccuracy ?? null,
      measured: fold.directional_accuracy,
      level,
      meanAbsoluteTarget: target?.mean_absolute_target ?? null,
    };
  });

  const defaultCost = summary.round_turn_cost_points;
  const breakEvenDollars = result.breakEvenCostPoints * pointValueUsd;

  return (
    <Section title="D. What the model would have to do" question="Directional accuracy needed to reach zero after the round-turn cost, against the accuracy this model measured.">
      <div className="space-y-3">
        <Finding>
          Each trade wins or loses the bar&apos;s absolute move and always pays the cost, so with hit rate q the expected net return is (2q − 1)·E|y| − c, and break-even is
          q* = ½ + c / (2·E|y|). <strong>E|y|, not the standard deviation</strong>: the gain when a call is right is the realised absolute move, and the standard deviation
          of this series ({sci(summary.pooled_target_standard_deviation, 3)}) is {fmt(summary.pooled_target_standard_deviation / meanAbsoluteTarget, 2)} times E|y| because the tails are fat
          (kurtosis {fmt(summary.target_kurtosis, 0)}).
        </Finding>

        <ControlBar
          onReset={() => {
            onCostPoints(defaultCost);
            onIndexLevel(defaultIndexLevel);
          }}
        >
          <SliderControl label="Round-turn cost (index points)" value={costPoints} min={0} max={3} step={0.05} onChange={onCostPoints} format={(v) => fmt(v, 3)} hint={`The run's own cost: ${defaultCost} points`} />
          <SliderControl label="Index level for the conversion" value={indexLevel} min={10000} max={30000} step={100} onChange={onIndexLevel} format={(v) => fmt(v, 0)} hint="The cost in points is divided by this to become a log return" />
        </ControlBar>

        <div className="grid gap-2 grid-cols-2 xl:grid-cols-3">
          <Stat label="Cost as a log return" value={sci(result.costLogReturn, 4)} hint="cost points / index level" />
          <Stat label="E|target|, the gain when right" value={sci(meanAbsoluteTarget, 4)} hint={`re-measured on the ${summary.pooled_nonzero_target_window_count.toLocaleString("en-US")} non-zero out-of-sample targets`} />
          <Stat label="Break-even directional accuracy" value={fmt(result.breakEvenAccuracy, 4)} tone={OKABE.orange} />
          <Stat label="Measured directional accuracy" value={fmt(measuredAccuracy, 4)} tone={OKABE.blue} hint="pooled over the non-zero targets of all six folds" />
          <Stat label="Shortfall" value={`${fmt(result.shortfallPercentagePoints, 2)} percentage points`} />
          <Stat label="Edge needed vs edge held" value={`${fmt(result.edgeRatio, 1)}×`} hint="(q* − ½) / (q − ½)" />
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <FormulaCard
            tex={"q^{*}=\\frac{1}{2}+\\frac{c}{2\\,E|y|}\\qquad c=\\frac{\\text{cost points}}{\\text{index level}}"}
            caption="Break-even directional accuracy: set the expected net return (2q − 1)·E|y| − c to zero and solve for q."
            symbols={[
              { tex: "q^{*}", name: "break-even directional accuracy", value: fmt(result.breakEvenAccuracy, 4) },
              { tex: "c", name: "round-turn cost as a log return", value: sci(result.costLogReturn, 4) },
              { tex: "\\text{cost points}", name: "round-turn cost in index points (slider)", value: fmt(costPoints, 3) },
              { tex: "\\text{index level}", name: "index level used to convert (slider)", value: fmt(indexLevel, 0) },
              { tex: "E|y|", name: "mean absolute next-bar log return", value: sci(meanAbsoluteTarget, 4) },
            ]}
          />
          <FormulaCard
            tex={"\\mathbb{E}[\\text{net}]=(2q-1)\\,E|y|-c"}
            caption="Expected net return per trade at the measured hit rate; break-even cost is where this is zero."
            symbols={[
              { tex: "q", name: "measured directional accuracy", value: fmt(measuredAccuracy, 6) },
              { tex: "2q-1", name: "edge over a coin flip", value: fmt(2 * measuredAccuracy - 1, 6) },
              { tex: "\\mathbb{E}[\\text{net}]", name: "expected net return per trade (log return)", value: sci(result.expectedNetPerTrade, 3) },
              { tex: "c_{0}", name: "cost at which q would just break even, index points", value: `${fmt(result.breakEvenCostPoints, 4)} points ($${fmt(breakEvenDollars, 2)} per MNQ contract at $${fmt(pointValueUsd, 2)} a point)` },
            ]}
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <h4 className="mb-1 text-xs font-semibold text-neutral-200">Break-even accuracy as the cost grows, at index level {fmt(indexLevel, 0)}</h4>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={curve} margin={{ top: 8, right: 12, left: 4, bottom: 16 }}>
                <CartesianGrid {...GRID} />
                <XAxis
                  type="number" dataKey="cost" domain={[0, 3]} {...AXIS} tickFormatter={(v: number) => fmt(v, 1)}
                  label={{ value: "round-turn cost (index points)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }}
                />
                <YAxis domain={[0.48, "auto"]} {...AXIS} tickFormatter={(v: number) => fmt(v, 2)} width={40} />
                <Tooltip {...TOOLTIP} labelFormatter={(v) => `${fmt(Number(v), 2)} points`} formatter={(value) => [fmt(Number(value), 4), "break-even accuracy"]} />
                <ReferenceLine y={measuredAccuracy} stroke={OKABE.blue} strokeDasharray="5 3" label={{ value: `measured ${fmt(measuredAccuracy, 4)}`, fill: OKABE.blue, fontSize: 10, position: "insideTopRight" }} />
                <ReferenceLine x={result.breakEvenCostPoints} stroke={OKABE.sky} strokeDasharray="2 3" label={{ value: `c₀ ${fmt(result.breakEvenCostPoints, 3)}`, fill: OKABE.sky, fontSize: 10, position: "top" }} />
                <Line dataKey="breakEven" name="break-even accuracy" stroke={OKABE.orange} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                <ReferenceDot x={costPoints} y={result.breakEvenAccuracy} r={6} fill={OKABE.yellow} stroke="#0a0a0a" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="min-w-0">
            <h4 className="mb-1 text-xs font-semibold text-neutral-200">Per fold: accuracy required at that fold&apos;s own price level and E|y|, against measured</h4>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={perFold} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="fold" {...AXIS} />
                <YAxis domain={[0.45, "auto"]} {...AXIS} tickFormatter={(v: number) => fmt(v, 2)} width={40} />
                <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="4 3" />
                <Tooltip
                  {...TOOLTIP}
                  content={({ payload, label }) => {
                    const row = payload?.[0]?.payload as (typeof perFold)[number] | undefined;
                    if (!row) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                        <div className="font-semibold">{String(label)}</div>
                        <div>required {fmt(row.required, 4)}</div>
                        <div>measured {fmt(row.measured, 4)}</div>
                        <div>mean price {fmt(row.level, 0)} · E|y| {sci(row.meanAbsoluteTarget, 3)}</div>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="required" name="required (break-even)" fill={OKABE.orange} isAnimationActive={false} />
                <Bar dataKey="measured" name="measured" fill={OKABE.blue} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <Finding>
          At {fmt(costPoints, 2)} points and index level {fmt(indexLevel, 0)} the model would need {fmt(result.breakEvenAccuracy, 4)} and holds {fmt(measuredAccuracy, 4)}: {fmt(result.shortfallPercentagePoints, 2)} percentage points short.
          The accuracy it does hold pays for {fmt(result.breakEvenCostPoints, 3)} points of round-turn cost, against the {fmt(defaultCost, 3)} points the run charged.
        </Finding>
      </div>
    </Section>
  );
}
