/**
 * Scoreboard: every development trial against the five gates. The table is the
 * headline (which gates each trial meets), the four dot plots put each trial
 * beside its gate line, and the profit-factor formula shows why gates G3 and
 * G4 are hard to meet together. Selecting a row chooses the trial every other
 * tab describes.
 */

import type { ReactNode } from "react";
import {
  CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  GATE_DEFINITIONS, GATE_KEYS, breakevenWinRate, profitFactorFrom, winRateForProfitFactor, type MultimodalBody, type TrialRow,
} from "@shared/studies/multimodal-model";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, Stat, TOOLTIP, fmt, fmtInt, fmtPercent, fmtUsd,
} from "@/studies/kit";
import type { TabProps } from "./controls";
import { GateChips, SortHeader, Signed } from "./parts";

type NumericKey = {
  [K in keyof TrialRow]: TrialRow[K] extends number | null ? K : never;
}[keyof TrialRow];

interface Column {
  key: NumericKey | "label" | "gates";
  label: string;
  hint: string;
  show: (trial: TrialRow) => ReactNode;
}

const COLUMNS: Column[] = [
  { key: "label", label: "trial", hint: "start time of the run (month day, hour:minute); family and input blocks from the plan's trial ledger", show: (t) => <span>{t.label} <span className="text-neutral-500">{t.family ?? "?"}</span></span> },
  { key: "trade_count", label: "trades", hint: "closed trades on the canonical window", show: (t) => fmtInt(t.trade_count) },
  { key: "sessions_traded_share", label: "sessions traded", hint: "share of sessions with a closed trade (G2 needs 100%)", show: (t) => fmtPercent(t.sessions_traded_share, 0) },
  { key: "win_rate", label: "win rate", hint: "share of trades that win after costs (G3 needs 40%)", show: (t) => fmtPercent(t.win_rate) },
  { key: "payoff_ratio", label: "win ÷ loss", hint: "average win over average loss (G4 needs 2)", show: (t) => fmt(t.payoff_ratio, 2) },
  { key: "profit_factor", label: "profit factor", hint: "gross wins over gross losses (G4 needs 2)", show: (t) => fmt(t.profit_factor, 3) },
  { key: "net_profit_usd", label: "net USD", hint: "after AMP costs, per contract (G1 needs above 0)", show: (t) => <Signed value={t.net_profit_usd} text={fmtUsd(t.net_profit_usd)} /> },
  { key: "quarters_positive_share", label: "quarters up", hint: "share of the 17 quarters with a positive net (G5 needs 75%)", show: (t) => fmtPercent(t.quarters_positive_share, 0) },
  { key: "bootstrap_probability_profitable", label: "P(profit)", hint: "share of bootstrap resamples of the trades that end above zero", show: (t) => fmtPercent(t.bootstrap_probability_profitable, 0) },
  { key: "gate_passed_count", label: "gates", hint: "how many of G1 to G5 the trial meets", show: (t) => <span className="inline-flex items-center gap-1"><span className="font-mono">{t.gate_passed_count}/5</span><GateChips gate={t.gate} /></span> },
];

function sortValue(trial: TrialRow, key: Column["key"]): number | string {
  if (key === "label") return trial.recipe;
  if (key === "gates") return trial.gate_passed_count;
  return trial[key] ?? Number.NEGATIVE_INFINITY;
}

function TrialTable({ trials, selected, controls, set }: { trials: TrialRow[]; selected: string | null } & TabProps) {
  const sorted = [...trials].sort((a, b) => {
    const left = sortValue(a, controls.scoreboardSort as Column["key"]);
    const right = sortValue(b, controls.scoreboardSort as Column["key"]);
    const order = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left) - Number(right);
    return controls.scoreboardDescending ? -order : order;
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[11px] font-mono tnum">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <SortHeader
                key={column.key}
                label={column.label}
                hint={column.hint}
                align={column.key === "label" ? "left" : "right"}
                active={controls.scoreboardSort === column.key}
                descending={controls.scoreboardDescending}
                onClick={() => {
                  if (controls.scoreboardSort === column.key) set("scoreboardDescending", !controls.scoreboardDescending);
                  else {
                    set("scoreboardSort", column.key);
                    set("scoreboardDescending", column.key !== "label");
                  }
                }}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((trial) => {
            const isSelected = trial.recipe === selected;
            return (
              <tr
                key={trial.recipe}
                onClick={() => set("trial", trial.recipe)}
                aria-selected={isSelected}
                title={trial.recipe}
                className={`cursor-pointer border-t border-neutral-900 hover:bg-neutral-900 ${isSelected ? "bg-neutral-800/70 outline outline-1 -outline-offset-1 outline-[#56B4E9]" : ""}`}
              >
                {COLUMNS.map((column) => (
                  <td key={column.key} className={`py-1 pr-2 text-neutral-200 ${column.key === "label" ? "text-left" : "text-right"}`}>
                    {column.key === "label" && isSelected && <span className="mr-1 text-[#56B4E9]">◀</span>}
                    {column.show(trial)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface DotPoint {
  x: number;
  y: number;
  label: string;
  recipe: string;
  meets: boolean;
  selected: boolean;
}

function dotShape(props: unknown) {
  const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: DotPoint };
  if (cx === undefined || cy === undefined || !payload) return <g />;
  const size = payload.selected ? 7 : 5;
  return (
    <g style={{ cursor: "pointer" }}>
      {payload.selected && <circle cx={cx} cy={cy} r={size + 4} fill="none" stroke="#56B4E9" strokeWidth={1.5} />}
      {payload.meets ? (
        <circle cx={cx} cy={cy} r={size} fill={OKABE.orange} stroke="#111" />
      ) : (
        <path d={`M${cx},${cy - size - 1} L${cx + size + 1},${cy} L${cx},${cy + size + 1} L${cx - size - 1},${cy} Z`} fill={OKABE.blue} stroke="#111" />
      )}
    </g>
  );
}

function GateDotPlot({
  trials, selected, metric, line, title, digits, onSelect, meets,
}: {
  trials: TrialRow[]; selected: string | null; metric: NumericKey; line: number; title: string; digits: number;
  onSelect: (recipe: string) => void; meets: (value: number) => boolean;
}) {
  const points: DotPoint[] = trials.flatMap((trial, index) => {
    const value = trial[metric];
    if (value === null || value === undefined) return [];
    return [{ x: index + 1, y: value, label: trial.label, recipe: trial.recipe, meets: meets(value), selected: trial.recipe === selected }];
  });
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">{title}</div>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0.5, trials.length + 0.5]}
            ticks={trials.map((_, index) => index + 1)}
            tickFormatter={(value: number) => trials[value - 1]?.label ?? ""}
            angle={-40}
            textAnchor="end"
            height={58}
            interval={0}
            {...AXIS}
          />
          <YAxis type="number" dataKey="y" width={52} {...AXIS} domain={["auto", "auto"]} tickFormatter={(value: number) => fmt(value, digits === 0 ? 0 : 2)} />
          <ReferenceLine y={line} stroke={OKABE.orange} strokeDasharray="6 4" label={{ value: `gate ${fmt(line, digits === 0 ? 0 : 2)}`, fill: OKABE.orange, fontSize: 9, position: "insideTopRight" }} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const point = payload?.[0]?.payload as DotPoint | undefined;
              if (!point) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{point.label}</div>
                  <div>{title}: {fmt(point.y, digits === 0 ? 0 : 4)}</div>
                  <div>{point.meets ? "● meets the gate" : "◆ misses the gate"}</div>
                </div>
              );
            }}
          />
          <Scatter data={points} shape={dotShape} isAnimationActive={false} onClick={(point: unknown) => onSelect((point as DotPoint).recipe)} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

const FAMILY_SHAPE: Record<string, "circle" | "diamond" | "triangle" | "square"> = { gbdt: "circle", fusion: "diamond", ensemble: "triangle" };

function ProfitFactorSection({ trials, selectedTrial, controls, set }: { trials: TrialRow[]; selectedTrial: TrialRow | null } & TabProps) {
  const winRate = controls.whatIfWinRate;
  const payoff = controls.whatIfPayoff;
  const curve = Array.from({ length: 56 }, (_, index) => {
    const p = 0.05 + index * 0.01;
    return {
      p,
      slider: profitFactorFrom(p, payoff),
      r2: profitFactorFrom(p, 2),
      r3: profitFactorFrom(p, 3),
    };
  });
  const profitFactor = profitFactorFrom(winRate, payoff);
  const breakeven = breakevenWinRate(payoff);
  const needed = winRateForProfitFactor(payoff, 2);
  const shapes = (["gbdt", "fusion", "ensemble"] as const).map((family) => ({
    family,
    data: trials
      .filter((trial) => trial.family === family && trial.win_rate !== null && trial.profit_factor !== null)
      .map((trial) => ({ p: trial.win_rate as number, pf: trial.profit_factor as number, label: trial.label, recipe: trial.recipe })),
  }));
  return (
    <Section
      title="Why gates G3 and G4 are hard together"
      question="A trade that wins a share p of the time, paying R times what a loser costs, earns a profit factor of p·R ÷ (1 − p). Drag p and R: the curve is every profit factor those two numbers allow, and each trial sits where its own p and PF put it."
    >
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="space-y-2">
          <FormulaCard
            tex={"\\mathrm{PF} \\;=\\; \\frac{\\sum \\text{wins}}{\\sum \\text{losses}} \\;=\\; \\frac{p \\, R}{1 - p} \\qquad\\qquad p_{\\mathrm{PF}\\ge 2} \\;=\\; \\frac{2}{R + 2}"}
            symbols={[
              { tex: "\\mathrm{PF}", name: "profit factor: gross winnings divided by gross losses, after costs (G4 needs 2 or more)", value: fmt(profitFactor, 3) },
              { tex: "p", name: "win rate: the share of trades that end above zero after costs (G3 needs 40% or more)", value: fmtPercent(winRate, 1) },
              { tex: "R", name: "payoff ratio: average winning trade divided by average losing trade, in points (G4 needs 2 or more)", value: fmt(payoff, 2) },
              { tex: "1-p", name: "loss rate: the share of trades that do not win", value: fmtPercent(1 - winRate, 1) },
              { tex: "p_{\\mathrm{PF}\\ge 2}", name: "the win rate at which PF reaches 2 for this R", value: fmtPercent(needed, 1) },
            ]}
            caption={`Break-even win rate 1 ÷ (1 + R) = ${fmtPercent(breakeven, 1)}. A 3:1 bracket needs 40% to reach PF 2 (exactly G3); a 2:1 bracket needs 50%.`}
          />
          <ControlBar>
            <SliderControl label="Win rate p" value={winRate} min={0.05} max={0.6} step={0.005} onChange={(v) => set("whatIfWinRate", v)} format={(v) => fmtPercent(v, 1)} />
            <SliderControl label="Payoff ratio R" value={payoff} min={1} max={4} step={0.05} onChange={(v) => set("whatIfPayoff", v)} format={(v) => fmt(v, 2)} />
            {selectedTrial && selectedTrial.win_rate !== null && selectedTrial.payoff_ratio !== null && (
              <button
                type="button"
                onClick={() => {
                  set("whatIfWinRate", Math.round((selectedTrial.win_rate as number) * 200) / 200);
                  set("whatIfPayoff", Math.round((selectedTrial.payoff_ratio as number) * 20) / 20);
                }}
                className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500"
              >
                Set to the selected trial ({selectedTrial.label})
              </button>
            )}
          </ControlBar>
          {selectedTrial && (
            <Finding>
              The selected trial wins {fmtPercent(selectedTrial.win_rate, 1)} of its trades at {fmt(selectedTrial.payoff_ratio, 2)} to 1, so p·R ÷ (1 − p) gives{" "}
              {fmt(profitFactorFrom(selectedTrial.win_rate ?? 0, selectedTrial.payoff_ratio ?? 0), 3)}; the landed profit factor is {fmt(selectedTrial.profit_factor, 3)}. It would need{" "}
              {fmtPercent(winRateForProfitFactor(selectedTrial.payoff_ratio ?? 0, 2), 1)} winners to reach 2.
            </Finding>
          )}
        </div>
        <div className="min-w-0">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={curve} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
              <CartesianGrid {...GRID} />
              <XAxis type="number" dataKey="p" domain={[0.05, 0.6]} {...AXIS} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} label={{ value: "win rate p", position: "insideBottom", offset: -8, fill: "#999", fontSize: 10 }} />
              <YAxis type="number" domain={[0, 3.5]} width={36} {...AXIS} label={{ value: "profit factor", angle: -90, position: "insideLeft", fill: "#999", fontSize: 10 }} />
              <ReferenceLine y={2} stroke={OKABE.orange} strokeDasharray="6 4" label={{ value: "G4: PF 2", fill: OKABE.orange, fontSize: 9, position: "insideTopLeft" }} />
              <ReferenceLine y={1} stroke={OKABE.grey} />
              <ReferenceLine x={0.4} stroke={OKABE.orange} strokeDasharray="6 4" label={{ value: "G3: 40%", fill: OKABE.orange, fontSize: 9, position: "insideTopRight" }} />
              <ReferenceLine x={winRate} stroke={OKABE.sky} strokeDasharray="2 3" />
              <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [fmt(value, 3), name]} labelFormatter={(label: number) => `win rate ${fmtPercent(label, 1)}`} />
              <Line type="monotone" dataKey="r2" name="PF at R = 2" stroke={OKABE.grey} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="r3" name="PF at R = 3" stroke={OKABE.grey} strokeDasharray="1 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="slider" name={`PF at R = ${fmt(payoff, 2)}`} stroke={OKABE.sky} strokeWidth={2} dot={false} isAnimationActive={false} />
              {shapes.map((series) => (
                <Scatter key={series.family} data={series.data} dataKey="pf" name={`trial (${series.family})`} fill={OKABE.orange} stroke="#111" shape={FAMILY_SHAPE[series.family] ?? "circle"} isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-neutral-400">
            <span style={{ color: OKABE.sky }}>━ PF at your R</span> · <span className="text-neutral-400">┅ R = 2 · ┈ R = 3</span> · trials: ● gradient-boosted trees, ◆ fusion network, ▲ ensemble. A trial sits under the PF 2 line and left of the 40% line.
          </p>
        </div>
      </div>
    </Section>
  );
}

export function Scoreboard({ controls, set, body }: TabProps & { body: MultimodalBody }) {
  const trials = body.trials;
  if (trials.length === 0) return <Empty>No trial has landed in derived_multimodal_runs_summary yet.</Empty>;
  const selectedTrial = trials.find((trial) => trial.recipe === body.selectedRecipe) ?? null;
  const passing = trials.filter((trial) => trial.gate_passed_count === GATE_KEYS.length).length;
  const bestProfitFactor = trials.reduce<TrialRow | null>((best, trial) => ((trial.profit_factor ?? -Infinity) > (best?.profit_factor ?? -Infinity) ? trial : best), null);
  const select = (recipe: string) => set("trial", recipe);

  const gateCounts = GATE_KEYS.map((key) => ({ key, met: trials.filter((trial) => trial.gate[key] === true).length }));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Development trials" value={fmtInt(trials.length)} hint={`${fmtInt(body.holdout.ledgerLines)} lines in the plan's trials.jsonl`} />
        <Stat label="Trials that meet all five gates" value={`${passing} of ${trials.length}`} tone={passing > 0 ? OKABE.orange : OKABE.blue} />
        <Stat label="Best profit factor (gate 2.0)" value={fmt(bestProfitFactor?.profit_factor, 3)} hint={bestProfitFactor ? `${bestProfitFactor.label} ${bestProfitFactor.family ?? ""}; coin-flip entries score 0.88 to 0.95` : undefined} />
        <Stat
          label="Locked holdout looks"
          value={`${body.holdout.looks ?? "?"} of ${body.holdout.lookBudget ?? "?"}`}
          hint="2025-07-01 to 2025-12-31 stays unread until the gate's single look"
          tone={(body.holdout.looks ?? 0) > 0 ? OKABE.orange : undefined}
        />
      </div>

      <Section title="The five gates" question="A trial is accepted only if it meets every one, scored after AMP costs on the canonical window 2021Q2 to 2025Q2.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[11px]">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-1 font-normal">gate</th>
                <th className="py-1 font-normal">what it asks</th>
                <th className="py-1 font-normal">threshold</th>
                <th className="py-1 text-right font-normal">trials that meet it</th>
              </tr>
            </thead>
            <tbody>
              {GATE_KEYS.map((key, index) => (
                <tr key={key} className="border-t border-neutral-900 align-top">
                  <td className="py-1 pr-2 font-mono text-neutral-100">{key}</td>
                  <td className="py-1 pr-2 text-neutral-300">{GATE_DEFINITIONS[key].name}: {GATE_DEFINITIONS[key].asks}</td>
                  <td className="py-1 pr-2 text-neutral-300">{GATE_DEFINITIONS[key].threshold}</td>
                  <td className="py-1 text-right font-mono tnum text-neutral-200">{gateCounts[index]?.met} of {trials.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Every trial, canonical window (2021Q2 to 2025Q2)" question="Click a row to choose the trial the other tabs describe; click a header to sort. A trial scored before the canonical window existed keeps its policy-tuned scope, which covers the same quarters.">
        <TrialTable trials={trials} selected={body.selectedRecipe} controls={controls} set={set} />
        <p className="mt-1 text-[11px] text-neutral-500">
          Gate chips: <span style={{ background: OKABE.orange, color: "#111" }} className="rounded px-1 font-mono">G1✓</span> met,{" "}
          <span style={{ border: `1px solid ${OKABE.blue}`, color: OKABE.sky }} className="rounded px-1 font-mono">G1✗</span> missed. Scope used: {[...new Set(trials.map((trial) => trial.scope))].join(", ")}.
        </p>
      </Section>

      <Section title="Each trial against its gate line" question="Orange dashed line = the gate. ● orange circle meets it, ◆ blue diamond misses it. Click a point to select that trial.">
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <GateDotPlot trials={trials} selected={body.selectedRecipe} metric="profit_factor" line={2} digits={2} title="Profit factor (gate 2.0; coin-flip entries 0.88 to 0.95)" onSelect={select} meets={(value) => value >= 2} />
          <GateDotPlot trials={trials} selected={body.selectedRecipe} metric="win_rate" line={0.4} digits={2} title="Win rate (gate 0.40)" onSelect={select} meets={(value) => value >= 0.4} />
          <GateDotPlot trials={trials} selected={body.selectedRecipe} metric="payoff_ratio" line={2} digits={2} title="Average win ÷ average loss (gate 2.0)" onSelect={select} meets={(value) => value >= 2} />
          <GateDotPlot trials={trials} selected={body.selectedRecipe} metric="net_profit_usd" line={0} digits={0} title="Net profit, USD per contract (gate above 0)" onSelect={select} meets={(value) => value > 0} />
        </div>
        <Finding>
          Payoff clears 2 in every trial because the brackets are 2:1 and 3:1; the win rate is what fails ({fmtPercent(Math.min(...trials.map((trial) => trial.win_rate ?? 1)), 1)} to {fmtPercent(Math.max(...trials.map((trial) => trial.win_rate ?? 0)), 1)} against a gate of 40%), and with it the profit factor.
        </Finding>
      </Section>

      <ProfitFactorSection trials={trials} selectedTrial={selectedTrial} controls={controls} set={set} />

      <Section title="Every number in the trial table, as a distribution" question="One panel per column across the trials (nine values each).">
        <ColumnGrid rows={trials.map(({ gate: _gate, quarter_net_points: _quarters, ...metrics }) => metrics)} exclude={["gate_passed_count"]} title="Trial table columns" />
      </Section>
    </div>
  );
}
