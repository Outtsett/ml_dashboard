/**
 * §1 · The goal as a formula you can operate: the win rate N trades a day need to net G ticks, and a
 * representative day's sum of trades stepped term by term.
 */

import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, TOOLTIP, fmt, fmtPercent } from "@/studies/kit";
import { winRateBreakEven, winRateCurve, winRateNeeded } from "@shared/studies/ta-strategy-600-ticks";
import { BLACK, Key } from "./common";
import type { TabProps } from "./controls";

export function GoalTab({ controls, set, overview }: TabProps) {
  const inputs = {
    goalTicks: controls.goalTicks, tradesPerDay: controls.goalTrades, riskTicks: controls.goalRisk,
    rewardToRisk: controls.goalReward, contracts: controls.goalContracts, costTicks: overview.costTicks,
  };
  const needed = winRateNeeded(inputs);
  const breakEven = winRateBreakEven(inputs);
  const perContract = controls.goalTicks / controls.goalContracts;
  const curve = winRateCurve(inputs);
  const here = [{ tradesPerDay: controls.goalTrades, winRateNeeded: Math.min(needed, 1.2) }];

  // A representative day at the needed rate: round(p N) winners spread evenly through the N trades.
  const winners = Math.min(controls.goalTrades, Math.max(0, Math.round(Math.min(needed, 1) * controls.goalTrades)));
  let running = 0;
  const day = Array.from({ length: controls.goalTrades }, (_, index) => {
    const wins = Math.floor(((index + 1) * winners) / controls.goalTrades) - Math.floor((index * winners) / controls.goalTrades);
    const gross = wins ? controls.goalReward * controls.goalRisk : -controls.goalRisk;
    const net = gross - overview.costTicks;
    running += net;
    return { trade: index + 1, gross, net, running, won: wins > 0 };
  });
  const step = Math.min(Math.max(1, controls.goalStep), controls.goalTrades);
  const term = day[step - 1];

  return (
    <div className="space-y-3">
      <Section title="1 · The goal as a formula you can operate"
        question="A day's net ticks is the sum of its trades, each trade's gross move minus the round-trip cost. Solve it for the win rate you would need.">
        <ControlBar onReset={() => { set("goalTrades", 20); set("goalRisk", 80); set("goalReward", 1); set("goalContracts", 1); set("goalTicks", 600); set("goalStep", 20); }}>
          <SliderControl label="N · trades per day" value={controls.goalTrades} min={1} max={100} onChange={(value) => set("goalTrades", value)} />
          <SliderControl label="T · risk per trade (ticks)" value={controls.goalRisk} min={4} max={400} step={4} onChange={(value) => set("goalRisk", value)} />
          <SliderControl label="R · reward-to-risk" value={controls.goalReward} min={0.5} max={4} step={0.25} onChange={(value) => set("goalReward", value)} format={(value) => value.toFixed(2)} />
          <SliderControl label="k · contracts" value={controls.goalContracts} min={1} max={20} onChange={(value) => set("goalContracts", value)} />
          <SliderControl label="G · goal (ticks/day, one contract)" value={controls.goalTicks} min={50} max={1200} step={50} onChange={(value) => set("goalTicks", value)} />
        </ControlBar>
        <div className="mt-2 grid gap-3 xl:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <FormulaCard
              tex={"\\text{net ticks per day} = \\sum_{t=1}^{N}\\big(g_t - c\\big) = N\\big(pT - (1-p)T - c\\big), \\qquad p_{\\text{needed}} = \\frac{G/k/N + c + T}{(R+1)\\,T}"}
              caption="With a reward-to-risk R a winner makes R·T and a loser loses T; spread over k contracts each contract needs only G/k."
              symbols={[
                { tex: "G", name: "goal: net ticks wanted per day", value: `${fmt(controls.goalTicks, 0)} ticks/day` },
                { tex: "N", name: "trades per day: round trips a day", value: String(controls.goalTrades) },
                { tex: "T", name: "risk per trade: ticks lost on a losing trade", value: `${controls.goalRisk} ticks` },
                { tex: "R", name: "reward-to-risk: ticks won on a winner / ticks lost on a loser", value: fmt(controls.goalReward, 2) },
                { tex: "c", name: "round-trip cost: fees plus 1 tick of slippage per side", value: `${fmt(overview.costTicks, 2)} ticks` },
                { tex: "k", name: "contracts: the same trade on k contracts", value: String(controls.goalContracts) },
                { tex: "G/k", name: "goal per contract: what each contract must earn", value: `${fmt(perContract, 1)} ticks/day` },
                { tex: "g_t", name: "gross ticks of trade t: +R·T on a winner, −T on a loser", value: term ? `${fmt(term.gross, 0)} (trade ${step})` : "—" },
                { tex: "p_{\\text{needed}}", name: "win rate needed: share of trades that must win", value: needed > 1 ? "impossible (> 1)" : fmt(needed, 3) },
                { tex: "p_{\\text{break-even}}", name: "win rate to net zero: (c + T) / ((R + 1) T)", value: fmt(breakEven, 3) },
              ]}
            />
            <Finding>
              <b>Win rate needed: {needed > 1 ? "impossible — above 100%" : fmtPercent(needed, 1)}</b> (break-even {fmtPercent(breakEven, 1)}).
              At the notebook's defaults (N 20, T 80, R 1, k 1, G 600) it is 72.2%: a coin-flip edge nets nothing, and each extra point of win rate
              is worth N·(R+1)·T/100 ticks a day.
            </Finding>
          </div>
          <div className="min-w-0">
            <Key items={[
              { label: "win rate needed at each N", colour: OKABE.blue, dash: "" },
              { label: "your settings", colour: OKABE.orange, glyph: "diamond" },
              { label: "break-even", colour: BLACK, dash: "4 4" },
              { label: "100%", colour: OKABE.vermillion, dash: "" },
            ]} />
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={curve} margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="tradesPerDay" type="number" domain={[1, 100]} {...AXIS} label={{ value: "N · trades per day", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
                <YAxis domain={[0.3, 1.2]} allowDataOverflow {...AXIS} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} />
                <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 3)} labelFormatter={(value) => `N = ${value}`} />
                <ReferenceLine y={breakEven} stroke={BLACK} strokeDasharray="4 4" />
                <ReferenceLine y={1} stroke={OKABE.vermillion} />
                <Line dataKey="winRateNeeded" name="win rate needed" stroke={OKABE.blue} dot={false} isAnimationActive={false} />
                <Scatter data={here} dataKey="winRateNeeded" name="your settings" fill={OKABE.orange} shape="diamond" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Section>

      <Section title="Step the sum, trade by trade" question={`A day of ${controls.goalTrades} trades at the needed rate (${winners} winners spread evenly): each bar is one term g_t − c, the line its running total.`}>
        <ControlBar>
          <SliderControl label="t · trade" value={step} min={1} max={controls.goalTrades} onChange={(value) => set("goalStep", value)} />
        </ControlBar>
        <Finding>
          Trade {step}: g<sub>{step}</sub> − c = {fmt(term?.gross, 0)} − {fmt(overview.costTicks, 2)} = <b>{fmt(term?.net, 2)}</b> ticks;
          running total after {step} of {controls.goalTrades}: <b>{fmt(term?.running, 1)}</b> (the day ends at {fmt(running, 1)} against G = {controls.goalTicks}).
        </Finding>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={day} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="trade" {...AXIS} />
            <YAxis {...AXIS} />
            <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 2), name === "net" ? "g_t − c" : String(name)]} labelFormatter={(value) => `trade ${value}`} />
            <ReferenceLine y={0} stroke="#737373" />
            <ReferenceLine x={step} stroke={OKABE.purple} />
            <Bar dataKey="net" isAnimationActive={false}>
              {day.map((entry) => <Cell key={entry.trade} fill={entry.won ? OKABE.orange : OKABE.blue} opacity={entry.trade <= step ? 0.95 : 0.3} />)}
            </Bar>
            <Line dataKey="running" name="running total" stroke={BLACK} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <Key items={[{ label: "▲ winner: +R·T − c", colour: OKABE.orange, glyph: "triangle-up" }, { label: "▼ loser: −T − c", colour: OKABE.blue, glyph: "triangle-down" }, { label: "trade t", colour: OKABE.purple, dash: "" }, { label: "running total", colour: BLACK, dash: "" }]} />
      </Section>
    </div>
  );
}
