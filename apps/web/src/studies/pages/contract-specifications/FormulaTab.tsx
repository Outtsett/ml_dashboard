/** Tab 2: tick value and profit, operated tick by tick. */

import { CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SelectControl, SliderControl, Stat, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import { profitInCurrency, staircase, ticksMoved, type SpecificationRow } from "@shared/studies/contract-specifications";
import type { Controls, SetControl } from "./controls";

const MAX_TICKS = 200;

export function FormulaTab({ rows, controls, set }: { rows: readonly SpecificationRow[]; controls: Controls; set: SetControl }) {
  const symbols = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const picked = rows.find((row) => row.symbol === controls.contract) ?? rows.find((row) => row.symbol === "MNQ") ?? rows[0];
  if (!picked) return null;

  const tickSize = picked.tick_size_index_points;
  const multiplier = picked.contract_multiplier_per_index_point;
  const tickValue = picked.tick_value_per_contract;
  const currency = picked.currency;
  const n = controls.contractsHeld;
  const ticks = Math.max(-MAX_TICKS, Math.min(MAX_TICKS, Math.round(controls.ticksMoved)));
  const indexPointsMoved = ticks * tickSize;
  const recoveredTicks = ticksMoved(indexPointsMoved, tickSize);
  const profit = profitInCurrency(recoveredTicks, tickValue, n);
  const direction = recoveredTicks >= 0 ? 1 : -1;
  const steps = Math.abs(recoveredTicks);
  const stepShown = controls.stepIndex <= 0 ? steps : Math.min(controls.stepIndex, steps);
  const termAtStep = direction * tickValue * n;
  const runningAtStep = direction * stepShown * tickValue * n;

  const stairs = staircase(recoveredTicks, tickSize, tickValue, n).sort((a, b) => a.tick_index - b.tick_index);
  const lineColor = profit >= 0 ? OKABE.orange : OKABE.blue;
  const glyph = profit >= 0 ? "▲" : "▼";

  // The identity the notebook states: tick value = tick size x multiplier. How far does each contract's listed tick value sit from it?
  const deviations = rows.map((row) => Math.abs(row.tick_value_per_contract - row.tick_size_index_points * row.contract_multiplier_per_index_point));
  const worstDeviation = Math.max(...deviations);

  return (
    <div className="space-y-3">
      <Section title="The formula, operated" question="Pick a contract, drag how far the index moved and how many contracts you hold. Every symbol shows the value it holds now.">
        <ControlBar>
          <SelectControl label="Contract" value={picked.symbol} options={symbols.map((row) => ({ value: row.symbol, label: `${row.symbol} · ${row.name}` }))} onChange={(value) => set("contract", value)} />
          <SliderControl label="Contracts held (n)" value={n} min={1} max={20} onChange={(value) => set("contractsHeld", value)} />
          <SliderControl
            label={`Index moved, Δp (one step = one tick of ${fmt(tickSize, 4)})`}
            value={ticks} min={-MAX_TICKS} max={MAX_TICKS}
            format={(value) => `${value >= 0 ? "+" : ""}${fmt(value * tickSize, 4)} pts`}
            onChange={(value) => set("ticksMoved", value)}
            hint="The slider steps in whole ticks so the price can only land where the exchange lets it trade."
          />
          <SliderControl label="Step i of the running sum (0 = all)" value={controls.stepIndex} min={0} max={Math.max(1, steps)} onChange={(value) => set("stepIndex", value)} />
        </ControlBar>

        <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Stat label="Tick value" value={`${currency} ${fmt(tickValue, 4)}`} hint="tick_value_per_contract" />
          <Stat label="Ticks moved" value={`${recoveredTicks >= 0 ? "+" : ""}${fmtInt(recoveredTicks)}`} />
          <Stat label={`Profit ${glyph}`} value={`${profit >= 0 ? "+" : "−"}${currency} ${fmt(Math.abs(profit), 2)}`} tone={lineColor} />
          <Stat label={`After step ${stepShown}`} value={`${runningAtStep >= 0 ? "+" : "−"}${currency} ${fmt(Math.abs(runningAtStep), 2)}`} hint="running total through tick i" />
        </div>

        <div className="mt-2">
          <FormulaCard
            tex={"v = s \\times m \\qquad\\qquad \\text{profit} = \\frac{\\Delta p}{s}\\, v\\, n = \\sum_{i=1}^{|k|} \\operatorname{sgn}(k)\\, v\\, n"}
            caption={`${picked.name} (${picked.symbol}): ${fmt(tickSize, 4)} × ${fmt(multiplier, 4)} = ${fmt(tickSize * multiplier, 4)}; the listed tick value is ${fmt(tickValue, 4)}. Term i adds ${currency} ${fmt(termAtStep, 2)}; after ${stepShown} of ${steps} ticks the total is ${currency} ${fmt(runningAtStep, 2)}.`}
            symbols={[
              { tex: "s", name: "tick size: minimum price step of the contract, in index points (tick_size_index_points)", value: `${fmt(tickSize, 4)} points` },
              { tex: "m", name: "multiplier: money one index point is worth for one contract (contract_multiplier_per_index_point)", value: `${currency} ${fmt(multiplier, 4)} per point` },
              { tex: "v", name: "tick value: money one tick is worth for one contract = s × m (tick_value_per_contract)", value: `${currency} ${fmt(tickValue, 4)}` },
              { tex: "\\Delta p", name: "how far the index moved, from the slider", value: `${indexPointsMoved >= 0 ? "+" : ""}${fmt(indexPointsMoved, 4)} points` },
              { tex: "k", name: "whole ticks moved = Δp ÷ s (negative when the index fell)", value: `${recoveredTicks >= 0 ? "+" : ""}${recoveredTicks} ticks` },
              { tex: "n", name: "contracts held, from the slider", value: String(n) },
              { tex: "i", name: "tick index running from 1 to |k|, each tick adding one term", value: `${stepShown} of ${steps}` },
              { tex: "\\operatorname{sgn}(k)", name: "direction of the move: +1 up, −1 down", value: direction > 0 ? "+1 ▲" : "−1 ▼" },
              { tex: "\\text{profit}", name: "money made or lost, in the contract's currency", value: `${profit >= 0 ? "+" : "−"}${currency} ${fmt(Math.abs(profit), 2)}` },
            ]}
          />
        </div>
      </Section>

      <Section title="Each tick adds its tick value" question={`${picked.name} (${picked.symbol}): each tick adds ${currency} ${fmt(tickValue * n, 4)} for ${n} contract${n === 1 ? "" : "s"}. ${glyph} ${profit >= 0 ? "gain" : "loss"}.`}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={stairs} margin={{ top: 8, right: 14, left: 8, bottom: 18 }}>
            <CartesianGrid {...GRID} />
            <XAxis type="number" dataKey="tick_index" domain={["dataMin", "dataMax"]} {...AXIS} label={{ value: "tick number i (each step is one tick)", position: "insideBottom", offset: -10, fill: "#a3a3a3", fontSize: 10 }} />
            <YAxis {...AXIS} label={{ value: `running total, ${currency}`, angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
            <ReferenceLine y={0} stroke={OKABE.grey} />
            <Tooltip
              {...TOOLTIP}
              content={({ payload }) => {
                const point = payload?.[0]?.payload as { tick_index: number; running_total: number; index_price_move_points: number } | undefined;
                if (!point) return null;
                return (
                  <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                    <div>tick i {point.tick_index}</div>
                    <div>index moved {fmt(point.index_price_move_points, 4)} points</div>
                    <div>running total {currency} {fmt(point.running_total, 2)}</div>
                  </div>
                );
              }}
            />
            <Line type="stepAfter" dataKey="running_total" stroke={lineColor} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <ReferenceDot x={direction * stepShown} y={runningAtStep} r={6} fill={lineColor} stroke="#fafafa" ifOverflow="extendDomain" />
          </ComposedChart>
        </ResponsiveContainer>
        <Finding>
          Across all {rows.length} contracts the largest gap between the listed tick value and tick size × multiplier is {fmt(worstDeviation, 6)} in the contract's own currency.
        </Finding>
      </Section>
    </div>
  );
}
