/**
 * Section 4: the 1-minute "last move" baseline that beat its null, traded.
 * Repeat or fade the last close-to-close move, enter at the next open, exit
 * at that candle's close; whether it pays is net = h·W − (1 − h)·L − c.
 * Drag the cost and the hit rate, and step through the terms.
 */

import {
  Bar, BarChart, Cell, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, TOOLTIP, fmt, fmtInt,
  fmtPercent,
} from "@/studies/kit";
import { persistenceTerms, repriceRule, type LastMoveRule } from "@shared/studies/pattern-casebook";
import { TIMEFRAME_LABELS, type Controls, type SetControl } from "./controls";
import { signed, signedDollars } from "./format";
import { glyphShape } from "./glyphs";

const TERM_COLOURS = [OKABE.orange, OKABE.blue, OKABE.vermillion, "#e5e5e5"];
const NOT_YET = "#3f3f3f";
const RULE_COLUMNS: Array<keyof LastMoveRule> = [
  "rule", "period", "trade_count", "trades_per_session", "close_to_next_close_hit_rate_excluding_unchanged", "close_to_next_close_ticks_per_call",
  "close_to_next_open_ticks_per_call", "hit_rate_gross", "hit_rate_excluding_flat_next_candles", "average_winning_trade_ticks",
  "average_losing_trade_ticks", "gross_ticks_per_trade", "net_dollars_per_trade", "net_dollars_per_session", "break_even_cost_ticks",
  "break_even_hit_rate_at_cost", "always_long_net_dollars_per_trade", "gross_ticks_mean", "gross_ticks_median", "gross_ticks_standard_deviation",
  "gross_ticks_skewness", "gross_ticks_excess_kurtosis", "gross_ticks_percentile_25", "gross_ticks_percentile_75", "gross_ticks_minimum",
  "gross_ticks_maximum",
];

export function PersistenceSection({ controls, set, rules, defaultCost, dollarsPerTick }: {
  controls: Controls; set: SetControl; rules: LastMoveRule[]; defaultCost: number; dollarsPerTick: number;
}) {
  const periods = [...new Set(rules.map((rule) => rule.period))].sort();
  const row = rules.find((rule) => rule.timeframe === controls.ruleTimeframe && rule.rule === controls.rule && rule.period === controls.period);
  // a new rule starts again from its own measured hit rate, as the notebook's slider did
  const choose = <K extends "ruleTimeframe" | "rule" | "period">(key: K, value: Controls[K]) => {
    set(key, value);
    set("hitRate", -1);
  };
  if (!row) {
    return (
      <Section title="4 · The 1-minute 'edge' that beat its null, traded">
        <p className="text-xs text-neutral-400">No last-move rule for {controls.ruleTimeframe}, {controls.rule}, {controls.period}.</p>
      </Section>
    );
  }
  const cost = controls.ruleCost >= 0 ? controls.ruleCost : Math.round(defaultCost * 10) / 10;
  const hitRate = controls.hitRate >= 0 ? controls.hitRate : Math.round(row.hit_rate_gross * 10_000) / 10_000;
  const win = row.average_winning_trade_ticks;
  const loss = row.average_losing_trade_ticks;
  const arithmetic = persistenceTerms(hitRate, win, loss, cost);
  const upTo = arithmetic.terms[controls.terms - 1]?.end ?? arithmetic.net;
  const waterfall = [
    ...arithmetic.terms.map((term) => ({ term: `${term.index}. ${term.name}`, range: [term.start, term.end] as [number, number], value: term.value, added: term.index <= controls.terms, colour: TERM_COLOURS[term.index - 1] as string })),
    { term: "4. net per trade", range: [0, upTo] as [number, number], value: upTo, added: controls.terms === 3, colour: TERM_COLOURS[3] as string },
  ];
  const lowH = Math.min(0.4, arithmetic.breakEvenHitRate, row.hit_rate_gross, hitRate);
  const highH = Math.max(0.65, arithmetic.breakEvenHitRate, row.hit_rate_gross, hitRate);
  const curve = Array.from({ length: 251 }, (_, index) => {
    const h = 0.4 + (index * 0.25) / 250;
    return { hit_rate: h, net_ticks_per_trade: h * win - (1 - h) * loss - cost };
  });
  const measured = [{ hit_rate: row.hit_rate_gross, net_ticks_per_trade: row.hit_rate_gross * win - (1 - row.hit_rate_gross) * loss - cost }];
  const breakEven = [{ hit_rate: arithmetic.breakEvenHitRate, net_ticks_per_trade: 0 }];
  const yours = [{ hit_rate: hitRate, net_ticks_per_trade: arithmetic.net }];
  // the prose prices the rule at the page's round trip, as the notebook's text used the build's, whatever the slider says
  const priced = repriceRule(row, defaultCost, dollarsPerTick);
  const onThese = rules.filter((rule) => rule.timeframe === controls.ruleTimeframe);

  return (
    <Section
      title="4 · The 1-minute 'edge' that beat its null, traded"
      question="The last-bar-direction baseline beat its circular-shift null on the next 1-minute candle (AUC 0.5072 against a null 95th percentile of 0.5040, p = 0.003). AUC counts a lean either way, and on MNQ the lean is reversal. Here are both readings as trades."
    >
      <ControlBar>
        <SegmentControl label="Candles" value={controls.ruleTimeframe} options={Object.entries(TIMEFRAME_LABELS).map(([value, label]) => ({ value, label }))} onChange={(value) => choose("ruleTimeframe", value)} />
        <SegmentControl label="Rule" value={controls.rule} options={[{ value: "fade the last move", label: "fade the last move" }, { value: "repeat the last move", label: "repeat the last move" }]} onChange={(value) => choose("rule", value)} />
        <div className="w-72">
          <SelectControl label="Period" value={controls.period} options={periods.map((period) => ({ value: period, label: period }))} onChange={(value) => choose("period", value)} />
        </div>
      </ControlBar>
      <div className="mt-2">
        <ControlBar onReset={() => { set("ruleCost", -1); set("hitRate", -1); set("terms", 3); }}>
          <SliderControl label="c, round-trip cost in ticks" value={cost} min={0} max={10} step={0.1} onChange={(value) => set("ruleCost", value)} format={(value) => `${value.toFixed(1)} (${signedDollars(value * dollarsPerTick)})`} />
          <SliderControl label="h, hit rate (what if)" value={hitRate} min={0.4} max={0.65} step={0.0001} onChange={(value) => set("hitRate", value)} format={(value) => fmtPercent(value, 2)} />
          <SliderControl label="Terms added so far, i" value={controls.terms} min={1} max={3} onChange={(value) => set("terms", value)} />
        </ControlBar>
      </div>
      <div className="mt-2 grid min-w-0 gap-3 xl:grid-cols-2">
        <FormulaCard
          tex={"\\text{net} = \\underbrace{h \\cdot W}_{\\text{term 1}} - \\underbrace{(1-h)\\cdot L}_{\\text{term 2}} - \\underbrace{c}_{\\text{term 3}} \\qquad h^{*} = \\frac{c + L}{W + L}"}
          caption={`Running total after ${controls.terms} term(s): ${signed(upTo)} ticks per trade.`}
          symbols={[
            { tex: "h", name: `hit rate: share of trades that gained at least one tick before costs (measured ${fmtPercent(row.hit_rate_gross, 2)})`, value: fmtPercent(hitRate, 2) },
            { tex: "W", name: "average win: mean gross ticks of the winning trades", value: `${fmt(win, 2)} ticks` },
            { tex: "L", name: "average loss: mean gross ticks lost by the other trades, flat ones counted as 0", value: `${fmt(loss, 2)} ticks` },
            { tex: "c", name: "cost: the round trip, commission plus slippage", value: `${fmt(cost, 2)} ticks = ${signedDollars(cost * dollarsPerTick)}` },
            { tex: "h \\cdot W", name: "term 1: what the winners add per trade", value: `${signed(hitRate * win)} ticks` },
            { tex: "(1-h) \\cdot L", name: "term 2: what the losers take per trade", value: `${signed(-(1 - hitRate) * loss)} ticks` },
            { tex: "\\text{net}", name: "net per trade: term 1 − term 2 − term 3", value: `${signed(arithmetic.net)} ticks = ${signedDollars(arithmetic.net * dollarsPerTick)}` },
            { tex: "h^{*}", name: "break-even hit rate: the hit rate at which net is zero, at this cost", value: fmtPercent(arithmetic.breakEvenHitRate, 2) },
          ]}
        />
        <Finding>
          <strong>{row.rule.charAt(0).toUpperCase() + row.rule.slice(1)}</strong>, {row.period}, {row.timeframe} candles. Scored the way the study scored it, from this close to the next close, the call is right{" "}
          <strong>{fmtPercent(row.close_to_next_close_hit_rate_excluding_unchanged, 2)}</strong> of the time (unchanged closes left out) and worth{" "}
          <strong>{signed(row.close_to_next_close_ticks_per_call, 3)} ticks</strong>, of which <strong>{signed(row.close_to_next_open_ticks_per_call, 3)}</strong> is the jump from the close to the next open, a price nobody can buy.
          Traded from that open, it is right {fmtPercent(row.hit_rate_excluding_flat_next_candles, 2)} of the candles that move and makes <strong>{signed(row.gross_ticks_per_trade, 3)} ticks gross</strong> a trade, so it would break even at a cost of{" "}
          <strong>{fmt(row.break_even_cost_ticks, 3)} ticks</strong>; the real round trip is {fmt(defaultCost, 2)}. Taken every time it applies ({fmtInt(row.trades_per_session)} trades a session), that is{" "}
          <strong>{signedDollars(priced.netDollarsPerSession, 0)} per session</strong> on one contract. Buying every candle instead would make {signedDollars(priced.alwaysLongNetDollarsPerTrade)} a trade.
        </Finding>
      </div>
      <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[11px] text-neutral-400">
            Running total after {controls.terms} term(s): <span className="font-mono">{signed(upTo)} ticks</span> · grey = not yet added
          </p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={waterfall} margin={{ top: 18, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="term" interval={0} {...AXIS} tick={{ fontSize: 9, fill: "#a3a3a3" }} />
              <YAxis {...AXIS} width={44} tickFormatter={(value: number) => fmt(value, 1)} />
              <Tooltip {...TOOLTIP} formatter={(_value, _name, item) => [`${signed((item.payload as { value: number }).value, 3)} ticks`, (item.payload as { added: boolean }).added ? "added" : "not yet added"]} />
              <ReferenceLine y={0} stroke="#e5e5e5" />
              <Bar dataKey="range" isAnimationActive={false}>
                {waterfall.map((entry) => (
                  <Cell key={entry.term} fill={entry.added ? entry.colour : NOT_YET} />
                ))}
                <LabelList dataKey="value" position="top" fill="#d4d4d4" fontSize={11} formatter={(value: unknown) => signed(Number(value))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-neutral-400">
            What hit rate pays, at this cost ·{" "}
            <span style={{ color: OKABE.blue }}>● measured hit rate</span> · <span className="text-neutral-200">◆ break-even h*</span> · <span style={{ color: OKABE.orange }}>▲ your h</span>
          </p>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} />
              <XAxis type="number" dataKey="hit_rate" domain={[lowH, highH]} tickFormatter={(value: number) => fmtPercent(value, 0)} {...AXIS} />
              <YAxis type="number" dataKey="net_ticks_per_trade" {...AXIS} width={44} tickFormatter={(value: number) => fmt(value, 1)} />
              <Tooltip {...TOOLTIP} labelFormatter={(value) => `h = ${fmtPercent(Number(value), 2)}`} formatter={(value) => [`${signed(Number(value))} ticks`, "net per trade"]} />
              <ReferenceLine y={0} stroke="#e5e5e5" strokeDasharray="4 3" />
              <Line data={curve} dataKey="net_ticks_per_trade" stroke={OKABE.grey} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Scatter data={measured} shape={glyphShape("circle", OKABE.blue, 6)} isAnimationActive={false} name="measured hit rate" />
              <Scatter data={breakEven} shape={glyphShape("diamond", "#e5e5e5", 7)} isAnimationActive={false} name="break-even hit rate h*" />
              <Scatter data={yours} shape={glyphShape("triangle-up", OKABE.orange, 7)} isAnimationActive={false} name="your h" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-neutral-400"><strong>Every period on {TIMEFRAME_LABELS[controls.ruleTimeframe]} candles.</strong> The eight numbers are of gross ticks per trade; the dollar columns are at the casebook's cost.</p>
      <div className="max-h-[360px] overflow-auto rounded border border-neutral-800">
        <table className="w-full min-w-[1600px] text-right font-mono text-[11px] tnum">
          <thead className="sticky top-0 bg-neutral-900 text-neutral-400">
            <tr>
              {RULE_COLUMNS.map((column) => (
                <th key={column} className="px-2 py-1 text-left font-normal">{String(column).replace(/_/g, " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {onThese.map((rule) => (
              <tr key={`${rule.rule}|${rule.period}`} className={`border-t border-neutral-900 ${rule === row ? "bg-neutral-800/60" : ""}`}>
                {RULE_COLUMNS.map((column) => {
                  const value = rule[column];
                  return (
                    <td key={column} className="whitespace-nowrap px-2 py-0.5 text-left text-neutral-200">
                      {typeof value === "number" ? fmt(value, 3) : String(value ?? "—")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-neutral-400">Every column of the last-move rules table (all timeframes and periods)</summary>
        <div className="mt-2">
          <ColumnGrid rows={rules as unknown as Array<Record<string, unknown>>} title="last_move_rules" />
        </div>
      </details>
    </Section>
  );
}
