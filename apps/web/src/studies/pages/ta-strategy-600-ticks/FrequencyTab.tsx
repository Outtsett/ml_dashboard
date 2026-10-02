/**
 * §11 · Frequency (round 4): the three frozen strategies traded ETH and RTH, long and short, with looser entry
 * thresholds. What each trade must capture for the day to total 600, net against trades, all three books year by
 * year, where the ticks come from by hour, and every column of the variants.
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, ComposedChart } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, StudyNotes, StudyState,
  TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import { requiredGrossPerTrade, type FrequencyBody, type Row } from "@shared/studies/ta-strategy-600-ticks";
import { BLACK, DataTable, GlyphMark, GridHeatmap, GroupedBars, Key, SubHeading, asNumber, useTa, type Glyph } from "./common";
import type { TabProps } from "./controls";

const TIMEFRAME_COLOUR: Record<string, string> = { "15m": OKABE.blue, "5m": OKABE.orange, "1m": OKABE.purple };
const WINDOW_GLYPH: Record<string, Glyph> = { frozen: "circle", overnight: "triangle-up", whole_day: "square" };
const STRICTNESS_GLYPH: Record<string, Glyph> = { frozen: "circle", looser: "diamond", loosest: "triangle-down" };

/** Symmetric log: sign(y) log10(1 + |y|), so losing variants stay on the axis the notebook drew with a symlog scale. */
const symlog = (value: number) => Math.sign(value) * Math.log10(1 + Math.abs(value));
const unsymlog = (value: number) => Math.sign(value) * (10 ** Math.abs(value) - 1);

function glyphShape(glyph: Glyph, colour: string, size = 4) {
  return (props: unknown) => {
    const { cx, cy } = props as { cx?: number; cy?: number };
    return typeof cx === "number" && typeof cy === "number" ? <GlyphMark glyph={glyph} x={cx} y={cy} size={size} colour={colour} /> : <g />;
  };
}

export function FrequencyTab({ controls, set, overview }: TabProps) {
  const query = useTaFrequency(controls);
  const body = query.data?.data;
  const symbols = [...new Set((body?.variants ?? []).map((row) => String(row.symbol)))].sort();
  const symbol = symbols.includes(controls.frequencyMarket) ? controls.frequencyMarket : (symbols[0] ?? "MNQ");
  const variants = (body?.variants ?? []).filter((row) => row.symbol === symbol);
  const n = controls.frequencyTrades;
  const cost = overview.costTicks;
  const goal = overview.goalTicks;
  const needGross = requiredGrossPerTrade(goal, n, cost);
  const needNet = goal / n;
  const curve = Array.from({ length: 120 }, (_, index) => {
    const trades = 0.2 * 1000 ** (index / 119);
    return { x: trades, y: symlog(requiredGrossPerTrade(goal, trades, cost)) };
  });
  const dots = variants.filter((row) => asNumber(row.gross_ticks_per_trade) !== null && (asNumber(row.trades_per_session_day) ?? 0) > 0);
  const above = dots.filter((row) => (asNumber(row.gross_ticks_per_trade) as number) >= requiredGrossPerTrade(goal, asNumber(row.trades_per_session_day) as number, cost)).length;
  const yTicks = [-100, -10, -1, 0, 1, 5.56, 10, 100, 1000, 3000].map(symlog);

  return (
    <div className="space-y-3">
      <Section title="11 · Frequency: ETH and RTH, long and short, many trades a day"
        question="600 ticks is the day's total: every trade, long or short, overnight (ETH, 13:00 to 06:30 Pacific) or regular hours (RTH, 06:30 to 13:00). Round 4 takes the three frozen strategies and changes only the session window, the entry cap, the bar and a pre-declared ladder of looser entry thresholds.">
        <ControlBar>
          <SelectControl label="Market" value={symbol} options={(symbols.length ? symbols : ["MNQ"]).map((value) => ({ value, label: value }))} onChange={(value) => set("frequencyMarket", value)} />
          <SegmentControl label="Session window" value={controls.window} options={["frozen", "overnight", "whole_day"].map((value) => ({ value, label: value }))} onChange={(value) => set("window", value)} />
          <SegmentControl label="Entries per session" value={controls.cap} options={[{ value: 2, label: "2 per session" }, { value: 0, label: "unlimited" }]} onChange={(value) => set("cap", value)} />
          <SegmentControl label="Bar" value={controls.barSize} options={["15m", "5m", "1m"].map((value) => ({ value, label: value }))} onChange={(value) => set("barSize", value)} />
          <SegmentControl label="Entry thresholds" value={controls.strictness} options={["frozen", "looser", "loosest"].map((value) => ({ value, label: value }))} onChange={(value) => set("strictness", value)} />
        </ControlBar>
      </Section>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {variants.length === 0 ? <Empty>Round 4 has not landed.</Empty> : (
          <>
            <Section title="What each trade has to capture for the day to total 600" question="Drag N: the cross slides along the curve. Every dot is one round-4 variant (colour: bar size; shape: session window).">
              <FormulaCard
                tex={"\\text{net per day} = \\sum_{i=1}^{N}\\left(g_i - c\\right) \\ge 600 \\iff \\bar g \\ge \\frac{600}{N} + c"}
                symbols={[
                  { tex: "\\sum_{i=1}^{N}", name: "sum over every trade i of the session day, 1 to N", value: `${n} trades` },
                  { tex: "N", name: "trades per day: round trips, long and short, ETH and RTH", value: String(n) },
                  { tex: "g_i", name: "gross ticks of trade i: exit minus entry in ticks, signed by the side", value: "—" },
                  { tex: "\\bar g", name: "average gross ticks per trade the strategy must capture", value: `needs ${fmt(needGross, 2)}` },
                  { tex: "c", name: "round-trip cost: 1.39 USD × 2 sides ÷ 0.50 USD a tick (stops also pay a tick of slippage, not in this line)", value: `${fmt(cost, 2)} ticks` },
                  { tex: "600/N", name: "net each trade must keep: the goal split over the day's trades", value: fmt(needNet, 2) },
                ]}
              />
              <ControlBar>
                <SliderControl label="N · trades per day" value={n} min={1} max={200} onChange={(value) => set("frequencyTrades", value)} />
              </ControlBar>
              <Finding><b>A dot above the curve totals 600 a day; {above} of {dots.length} are above it.</b> The dashed line is the cost alone: below it a strategy loses on every trade before slippage.</Finding>
              <Key items={[
                ...Object.entries(TIMEFRAME_COLOUR).map(([label, colour]) => ({ label: `bar ${label}`, colour, glyph: "circle" as const })),
                ...Object.entries(WINDOW_GLYPH).map(([label, glyph]) => ({ label: `window ${label}`, colour: "#a3a3a3", glyph })),
                { label: "600/N + c", colour: OKABE.vermillion, dash: "" }, { label: "cost c", colour: BLACK, dash: "4 3" }, { label: "your N", colour: OKABE.vermillion, glyph: "cross" },
              ]} />
              <ResponsiveContainer width="100%" height={380}>
                <ComposedChart margin={{ top: 8, right: 12, left: 4, bottom: 14 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis type="number" dataKey="x" scale="log" domain={[0.2, 200]} allowDataOverflow {...AXIS} ticks={[0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200]}
                    label={{ value: "trades per session day (log)", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
                  <YAxis type="number" dataKey="y" domain={[symlog(-100), symlog(4000)]} ticks={yTicks} tickFormatter={(value: number) => fmt(unsymlog(value), Math.abs(unsymlog(value)) < 10 ? 2 : 0)} {...AXIS}
                    label={{ value: "gross ticks per trade (symlog)", angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 10 }} />
                  <ZAxis range={[40, 40]} />
                  <Tooltip {...TOOLTIP} content={({ payload }) => {
                    const row = payload?.[0]?.payload as Row | undefined;
                    if (!row) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="px-2 py-1 text-[11px]">
                        {row.variant ? <div className="font-semibold">{String(row.variant)}</div> : null}
                        <div>trades/day {fmt(asNumber(row.x), 2)} · gross/trade {fmt(unsymlog(asNumber(row.y) ?? 0), 2)}</div>
                        {row.net_ticks_per_session_day !== undefined && <div>net/day {fmt(asNumber(row.net_ticks_per_session_day), 1)}</div>}
                      </div>
                    );
                  }} />
                  <ReferenceLine y={symlog(cost)} stroke={BLACK} strokeDasharray="4 3" />
                  <Line data={curve} dataKey="y" stroke={OKABE.vermillion} strokeWidth={2} dot={false} isAnimationActive={false} />
                  {Object.keys(TIMEFRAME_COLOUR).flatMap((timeframe) => Object.keys(WINDOW_GLYPH).map((window) => (
                    <Scatter key={`${timeframe}-${window}`} isAnimationActive={false}
                      data={dots.filter((row) => row.timeframe === timeframe && row.session_window === window).map((row) => ({ ...row, x: asNumber(row.trades_per_session_day), y: symlog(asNumber(row.gross_ticks_per_trade) as number) }))}
                      shape={glyphShape(WINDOW_GLYPH[window] as Glyph, TIMEFRAME_COLOUR[timeframe] as string)} />
                  )))}
                  <Scatter data={[{ x: n, y: symlog(needGross) }]} shape={glyphShape("cross", OKABE.vermillion, 7)} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Section>

            <Section title="More trades, fewer ticks each" question="Net per day against trades per day, unlimited entries; one panel per strategy × session window (colour: bar; shape: entry thresholds); vermillion dashed = 600.">
              <Key items={[
                ...Object.entries(TIMEFRAME_COLOUR).map(([label, colour]) => ({ label: `bar ${label}`, colour, glyph: "circle" as const })),
                ...Object.entries(STRICTNESS_GLYPH).map(([label, glyph]) => ({ label: `thresholds ${label}`, colour: "#a3a3a3", glyph })),
              ]} />
              <FacetGrid variants={variants.filter((row) => asNumber(row.maximum_entries_per_session) === 0)} goal={goal} />
            </Section>

            <Portfolio body={body} symbol={symbol} controls={controls} goal={goal} />

            <Section title="Where the day's ticks come from" question="Hour of entry (Pacific; RTH is 6:30-13:00; + / − marks the sign of the net per trade) and the long / short / RTH / ETH split, for the settings above.">
              <HourHeat rows={body?.hours ?? []} />
              <SplitBars variants={variants} controls={controls} />
            </Section>

            <Section title={`Round-4 variants on ${symbol}: every column, and its eight numbers`}>
              <ColumnGrid rows={variants} exclude={["round"]} />
              <DataTable rows={variants} pageSize={10} />
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}

function useTaFrequency(controls: TabProps["controls"]) {
  return useTa<FrequencyBody>("frequency", { symbol: controls.frequencyMarket, window: controls.window, cap: controls.cap, barSize: controls.barSize, strictness: controls.strictness });
}

function FacetGrid({ variants, goal }: { variants: Row[]; goal: number }) {
  const names = [...new Set(variants.map((row) => String(row.name)))].sort();
  const windows = ["frozen", "overnight", "whole_day"];
  return (
    <div className="grid gap-2 xl:grid-cols-3">
      {windows.flatMap((window) => names.map((name) => {
        const rows = variants.filter((row) => row.name === name && row.session_window === window && (asNumber(row.trades_per_session_day) ?? 0) > 0);
        return (
          <div key={`${window}-${name}`} className="min-w-0 rounded border border-neutral-800 p-1">
            <div className="truncate text-[10px] text-neutral-300">{name} · {window}</div>
            {rows.length === 0 ? <Empty>none</Empty> : (
              <ResponsiveContainer width="100%" height={170}>
                <ScatterChart margin={{ top: 4, right: 6, left: 0, bottom: 4 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis type="number" dataKey="x" scale="log" domain={["auto", "auto"]} {...AXIS} />
                  <YAxis type="number" dataKey="y" {...AXIS} width={44} />
                  <ZAxis range={[40, 40]} />
                  <Tooltip {...TOOLTIP} content={({ payload }) => {
                    const row = payload?.[0]?.payload as Row | undefined;
                    return row ? (
                      <div style={TOOLTIP.contentStyle} className="px-2 py-1 text-[11px]">
                        <div className="font-semibold">{String(row.variant)}</div>
                        <div>net/trade {fmt(asNumber(row.net_ticks_per_trade), 2)} · excess/day {fmt(asNumber(row.excess_ticks_per_session_day), 1)} (Newey-West t {fmt(asNumber(row.excess_newey_west_t), 2)})</div>
                        <div>win rate {fmt(asNumber(row.win_rate), 3)} · net/day {fmt(asNumber(row.net_ticks_per_session_day), 1)}</div>
                      </div>
                    ) : null;
                  }} />
                  <ReferenceLine y={0} stroke={BLACK} />
                  <ReferenceLine y={goal} stroke={OKABE.vermillion} strokeDasharray="6 3" />
                  {Object.keys(TIMEFRAME_COLOUR).flatMap((timeframe) => Object.keys(STRICTNESS_GLYPH).map((strictness) => (
                    <Scatter key={`${timeframe}-${strictness}`} isAnimationActive={false}
                      data={rows.filter((row) => row.timeframe === timeframe && row.entry_strictness === strictness).map((row) => ({ ...row, x: asNumber(row.trades_per_session_day), y: asNumber(row.net_ticks_per_session_day) }))}
                      shape={glyphShape(STRICTNESS_GLYPH[strictness] as Glyph, TIMEFRAME_COLOUR[timeframe] as string)} />
                  )))}
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </div>
        );
      }))}
    </div>
  );
}

function Portfolio({ body, symbol, controls, goal }: { body: FrequencyBody | undefined; symbol: string; controls: TabProps["controls"]; goal: number }) {
  const portfolio = (body?.portfolio ?? []).find((row) => row.symbol === symbol && row.session_window === controls.window
    && asNumber(row.maximum_entries_per_session) === controls.cap && row.timeframe === controls.barSize && row.entry_strictness === controls.strictness);
  const years = body?.years ?? [];
  const prices = body?.prices ?? [];
  const head = portfolio
    ? `${fmt(asNumber(portfolio.net_ticks_per_session_day), 1)} net ticks/day over the span (${fmt((asNumber(portfolio.share_of_goal_600) ?? 0) * 100, 1)}% of 600) from ${fmt(asNumber(portfolio.trades_per_session_day), 2)} trades/day; excess over matched random ${fmt(asNumber(portfolio.excess_ticks_per_session_day), 1)} (Newey-West t ${fmt(asNumber(portfolio.excess_newey_west_t), 2)}); worst drawdown ${fmtInt(asNumber(portfolio.maximum_drawdown_ticks))} ticks`
    : "no book with these settings";
  return (
    <Section title={`All three books together, one contract each (up to 3 open at once), year by year (${symbol}, ${controls.window}, ${controls.cap === 0 ? "unlimited" : controls.cap} entries, ${controls.barSize}, ${controls.strictness} thresholds)`}
      question="The same percentage move is more ticks at a higher price, so read the bars beside the price line.">
      <Finding>{head}.</Finding>
      <div className="grid gap-3 xl:grid-cols-2">
        <GroupedBars bars={years.map((row) => ({
          category: String(row.year), group: "books", value: asNumber(row.net_ticks_per_session_day),
          tooltip: `${String(row.year)}: net/day ${fmt(asNumber(row.net_ticks_per_session_day), 1)} · excess ${fmt(asNumber(row.excess_ticks_per_session_day), 1)} · days at or above 600 ${fmt((asNumber(row.share_of_days_at_or_above_600) ?? 0) * 100, 1)}%`,
        }))} groups={["books"]} colourOf={() => OKABE.orange} signColoured yLabel="three books: net ticks per day" height={260}
          references={[{ value: goal, colour: OKABE.vermillion, label: "600", dash: "6 3" }]} />
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={prices} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="year" {...AXIS} />
            <YAxis {...AXIS} width={60} label={{ value: "average price (index points)", angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 10 }} />
            <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 0)} />
            <Line dataKey="average_close_price" stroke={BLACK} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable rows={years} />
    </Section>
  );
}

function HourHeat({ rows }: { rows: Row[] }) {
  const names = [...new Set(rows.map((row) => String(row.name)))].sort();
  const hours = [...new Set(rows.map((row) => Number(row.entry_hour_pacific)))].sort((a, b) => a - b).map(String);
  const lookup = new Map(rows.map((row) => [`${String(row.name)}|${String(row.entry_hour_pacific)}`, asNumber(row.net_ticks_per_trade)]));
  if (names.length === 0) return <Empty>No entries for these settings.</Empty>;
  return <GridHeatmap rows={names} columns={hours} value={(row, column) => lookup.get(`${row}|${column}`) ?? null} signs label="net ticks per trade by entry hour" />;
}

function SplitBars({ variants, controls }: { variants: Row[]; controls: TabProps["controls"] }) {
  const picked = variants.filter((row) => asNumber(row.maximum_entries_per_session) === controls.cap && row.timeframe === controls.barSize
    && row.entry_strictness === controls.strictness && (row.session_window === controls.window || row.name === "opening_range_breakout_runner"));
  const parts = ["long_net_ticks_per_session_day", "short_net_ticks_per_session_day", "regular_hours_net_ticks_per_session_day", "overnight_net_ticks_per_session_day"];
  return (
    <>
      <SubHeading>Long / short / regular hours / overnight, net ticks per session day (orange ▲ positive, blue ▼ negative)</SubHeading>
      <GroupedBars bars={picked.flatMap((row) => parts.map((part) => ({
        category: String(row.name), group: part, value: asNumber(row[part]), tooltip: `${String(row.name)} · ${part}: ${fmt(asNumber(row[part]), 2)}`,
      })))} groups={parts} colourOf={() => OKABE.orange} signColoured yLabel="net ticks per session day" height={220} />
      <p className="text-[10px] text-neutral-500">Within each strategy the four bars are, left to right: {parts.join(", ")}.</p>
    </>
  );
}
