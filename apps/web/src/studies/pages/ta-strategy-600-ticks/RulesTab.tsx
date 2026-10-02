/**
 * §9 · Conditional TA-Lib rules with 2:1 brackets (derived_ta_rule_strategies_600_ticks_*): every strategy's
 * rate against its random-entry null, in-sample against out-of-sample, and one kept strategy's equity, exits,
 * year-by-year lift and every column.
 */

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, LineChart, Line, Legend } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, StudyNotes, StudyState, SummaryTable,
  TOOLTIP, eightNumberSummary, fmt, fmtInt,
} from "@/studies/kit";
import type { RulePoint, RulesBody, RulesRoundBody, RulesStrategyBody, Row } from "@shared/studies/ta-strategy-600-ticks";
import { BLACK, ChipSelect, DataTable, GlyphMark, GroupedBars, Key, ProfileGrid, SubHeading, asNumber, splitList, useTa, type Glyph } from "./common";
import type { TabProps } from "./controls";

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h"];
const TIMEFRAME_COLOUR: Record<string, string> = { "1m": OKABE.sky, "5m": OKABE.blue, "15m": OKABE.orange, "30m": OKABE.green, "1h": OKABE.purple };
const SHAPES: Glyph[] = ["circle", "triangle-up", "square", "diamond", "triangle-down", "cross", "triangle-right"];
const REVIEW_COLUMNS = ["round", "rank", "title", "category", "evidence", "expected_ticks_per_day_low", "expected_ticks_per_day_high", "confidence", "verified", "survived_verification", "verifier_reason"];

function glyphShape(glyph: Glyph, colour: string, filled = true) {
  return (props: unknown) => {
    const { cx, cy } = props as { cx?: number; cy?: number };
    if (typeof cx !== "number" || typeof cy !== "number") return <g />;
    return <GlyphMark glyph={glyph} x={cx} y={cy} size={3.5} colour={colour} filled={filled} strokeWidth={1} />;
  };
}

function clamp(value: number | null, low: number, high: number): number | null {
  return value === null ? null : Math.min(Math.max(value, low), high);
}

export function RulesTab({ controls, set, overview }: TabProps) {
  const roundsQuery = useTa<RulesBody>("rules");
  const rounds = roundsQuery.data?.data.rounds ?? [];
  const recipe = controls.ruleRound || String(rounds[rounds.length - 1]?.recipe ?? "");
  const timeframes = splitList(controls.ruleTimeframes);
  const roundQuery = useTa<RulesRoundBody>("rules_round", {
    recipe, period: controls.period, timeframes: controls.ruleTimeframes, minimumTrades: controls.minimumTrades, bins: controls.bins,
  }, recipe !== "");
  const body = roundQuery.data?.data;
  const points = body?.points ?? [];
  const filters = [...new Set(points.map((point) => point.filter))].sort();
  const shapeOf = (filter: string) => SHAPES[filters.indexOf(filter) % SHAPES.length] as Glyph;
  const groups = new Map<string, RulePoint[]>();
  for (const point of points) {
    const key = `${point.timeframe}|${point.filter}`;
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  const stop = controls.stopTicks;
  const cost = overview.costTicks;
  const netPerTrade = 0.2 * stop - cost;
  const tradesNeeded = netPerTrade > 0 ? overview.goalTicks / netPerTrade : null;
  const kept = body?.keptStrategies ?? [];
  const strategy = kept.includes(controls.keptStrategy) ? controls.keptStrategy : (kept[0] ?? "");
  const inTarget = points.filter((point) => (point.rate ?? 0) >= 0.4 && (point.profit_factor ?? 0) >= 1.333).length;
  const aboveNull = points.filter((point) => (point.lift_over_random ?? 0) > 0).length;

  return (
    <div className="space-y-3">
      <StudyState isLoading={roundsQuery.isLoading} error={roundsQuery.error}>
        <StudyNotes notes={roundsQuery.data?.notes ?? []} />
        <Section title="9 · Conditional TA-Lib rules with 2:1 brackets (no model)"
          question="Each strategy is a TA-Lib condition plus a filter, entering at the next open into a bracket: stop S ticks, target 2S. The target is a 40% win rate at 2:1.">
          <FormulaCard
            tex={"\\text{profit factor} = \\frac{0.40 \\times 2}{0.60 \\times 1} = 1.33, \\qquad \\overline{\\text{net}} = 0.4\\cdot 2S - 0.6\\cdot S - c = 0.2S - c, \\qquad N \\ge \\frac{600}{0.2S - c}"}
            caption="Drag the stop: the net a trade keeps at exactly 40% wins, and the trades a day 600 then needs."
            symbols={[
              { tex: "S", name: "stop distance of the bracket (the target is 2S)", value: `${stop} ticks` },
              { tex: "c", name: "round-trip cost", value: `${fmt(cost, 2)} ticks` },
              { tex: "\\text{profit factor}", name: "profit factor at 40% wins, 2:1, before costs", value: "1.333" },
              { tex: "\\overline{\\text{net}}", name: "net ticks a trade keeps at 40% wins", value: fmt(netPerTrade, 2) },
              { tex: "N", name: "trades per day 600 needs at that net", value: tradesNeeded === null ? "never (net ≤ 0)" : fmt(tradesNeeded, 1) },
            ]}
          />
          <ControlBar>
            <SelectControl label="Rule round" value={recipe || "—"} options={(rounds.length ? rounds : [{ recipe: "—", round: "" }]).map((row) => ({ value: String(row.recipe), label: `rule round ${String(row.round)} · ${String(row.recipe)}` }))}
              onChange={(value) => set("ruleRound", value)} />
            <SegmentControl label="Period (all_years: rounds 2+)" value={controls.period} options={["all_years", "in_sample", "out_of_sample"].map((value) => ({ value, label: value }))} onChange={(value) => set("period", value)} />
            <ChipSelect label="Timeframes" options={TIMEFRAMES} selected={timeframes} onChange={(next) => set("ruleTimeframes", next.join(","))} />
            <SliderControl label="Minimum trades" value={controls.minimumTrades} min={0} max={1000} step={25} onChange={(value) => set("minimumTrades", value)} />
            <SliderControl label="S · stop (ticks)" value={stop} min={4} max={200} step={2} onChange={(value) => set("stopTicks", value)} />
          </ControlBar>
          <DataTable rows={rounds} pageSize={5} />
        </Section>

        <StudyState isLoading={roundQuery.isLoading} error={roundQuery.error}>
          <StudyNotes notes={roundQuery.data?.notes ?? []} />
          <Section title={`${fmtInt(points.length)} strategies (${body?.strict ? "round 2+ strict test: target-hit rate; each hollow ◇ is that strategy's matched random entry" : "round 1 test: win rate incl. session-end exits; ◇ are random entries per bracket"})`}
            question={`Period ${body?.period ?? controls.period}. Left: rate against profit factor; the vermillion lines are 40% and 1.33, so the target zone is the top-right corner. Right: trades per day against net ticks per day.`}>
            <Finding>
              {inTarget} of {points.length} strategies sit in the target corner (rate ≥ 40% and profit factor ≥ 1.33); {aboveNull} sit above their random-entry rate.
              A rule only adds something where it sits above its bracket's random rate, and the 600 goal is far above the right chart's axis.
            </Finding>
            <Key items={[
              ...TIMEFRAMES.map((timeframe) => ({ label: timeframe, colour: TIMEFRAME_COLOUR[timeframe] as string, glyph: "circle" as const })),
              ...filters.slice(0, 7).map((filter) => ({ label: `filter ${filter}`, colour: "#a3a3a3", glyph: shapeOf(filter) })),
              { label: "matched random entry", colour: BLACK, glyph: "diamond" as const, filled: false },
            ]} />
            <div className="grid gap-3 xl:grid-cols-2">
              <ResponsiveContainer width="100%" height={360}>
                <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis type="number" dataKey="x" domain={[0, 0.65]} {...AXIS} label={{ value: body?.rateColumn ?? "rate", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
                  <YAxis type="number" dataKey="y" domain={[0.4, 2]} {...AXIS} label={{ value: "profit factor (net), clamped 0.4-2", angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 10 }} />
                  <ZAxis range={[20, 20]} />
                  <Tooltip {...TOOLTIP} content={({ payload }) => {
                    const row = payload?.[0]?.payload as (RulePoint & { kind?: string }) | undefined;
                    if (!row) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                        <div className="font-semibold">{row.strategy_id ?? `${String((row as unknown as Row).timeframe)} ${String((row as unknown as Row).stop)}`}</div>
                        <div>rate {fmt(row.rate, 3)} · matched random {fmt(row.random_rate, 3)} · lift {fmt(row.lift_over_random, 3)}</div>
                        <div>profit factor {fmt(row.profit_factor, 3)} · net/day {fmt(row.net_ticks_per_session_day, 1)}</div>
                        <div>trades/day {fmt(row.trades_per_session_day, 2)} · payoff {fmt(row.payoff_ratio, 2)}</div>
                      </div>
                    );
                  }} />
                  <ReferenceLine x={0.4} stroke={OKABE.vermillion} strokeDasharray="4 3" />
                  <ReferenceLine y={1.333} stroke={OKABE.vermillion} strokeDasharray="4 3" />
                  {[...groups.entries()].map(([key, group]) => {
                    const [timeframe = "", filter = ""] = key.split("|");
                    return (
                      <Scatter key={key} data={group.map((point) => ({ ...point, x: point.rate, y: clamp(point.profit_factor, 0.4, 2) }))}
                        shape={glyphShape(shapeOf(filter), TIMEFRAME_COLOUR[timeframe] ?? OKABE.sky)} isAnimationActive={false} />
                    );
                  })}
                  {body?.strict
                    ? <Scatter data={points.map((point) => ({ ...point, x: point.random_rate, y: clamp(point.profit_factor, 0.4, 2) }))} shape={glyphShape("diamond", BLACK, false)} isAnimationActive={false} />
                    : <Scatter data={(body?.baselines ?? []).map((row) => ({ ...row, x: asNumber(row.random_rate), y: clamp(asNumber(row.random_profit_factor), 0.4, 2), rate: asNumber(row.random_rate), profit_factor: asNumber(row.random_profit_factor) }))} shape={glyphShape("diamond", BLACK, false)} isAnimationActive={false} />}
                </ScatterChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={360}>
                <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis type="number" dataKey="x" scale="log" domain={["auto", "auto"]} allowDataOverflow {...AXIS} label={{ value: "trades per session day (log)", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
                  <YAxis type="number" dataKey="y" {...AXIS} label={{ value: "net ticks per session day", angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 10 }} />
                  <ZAxis range={[20, 20]} />
                  <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 2)} />
                  <ReferenceLine y={0} stroke="#737373" />
                  {TIMEFRAMES.map((timeframe) => (
                    <Scatter key={timeframe} name={timeframe} data={points.filter((point) => point.timeframe === timeframe && (point.trades_per_session_day ?? 0) > 0)
                      .map((point) => ({ strategy_id: point.strategy_id, x: point.trades_per_session_day, y: point.net_ticks_per_session_day }))}
                      shape={glyphShape("circle", TIMEFRAME_COLOUR[timeframe] as string)} isAnimationActive={false} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <DataTable rows={body?.top ?? []} caption="The 300 best by net ticks per day for the period (the lake table has all of them)." pageSize={12} />
          </Section>

          <Section title="Does choosing in-sample pick winners out of sample?" question="Each dot a strategy with at least 100 in-sample trades: in-sample net ticks/day (2019-06..2023) against out-of-sample (2024-2025).">
            <InVersusOut rows={body?.inVersusOut ?? []} />
          </Section>

          <StrategySection recipe={recipe} strategy={strategy} kept={kept} controls={controls} set={set} overview={overview} />

          <Section title="Reviews of the rule rounds" question="What to do better, and whether each recommendation survived the skeptic.">
            <DataTable rows={roundsQuery.data?.data.reviews ?? []} columns={REVIEW_COLUMNS} pageSize={8} />
          </Section>

          <Section title="Strategies table: every column" question="The strategies passing the period, timeframe and minimum-trades filters above, profiled on the server.">
            <ProfileGrid profiles={body?.profiles ?? []} title="Strategies" rowCount={body?.strategyCount} bins={controls.bins} onBins={(value) => set("bins", value)} />
            <SubHeading>The two columns the notebook derived for each strategy (its matched random-entry rate and the lift over it)</SubHeading>
            <ColumnGrid rows={points.map((point) => ({ matched_random_entry_rate: point.random_rate, lift_over_matched_random_entry_rate: point.lift_over_random }))} />
          </Section>
        </StudyState>
      </StudyState>
    </div>
  );
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = (xs[index] as number) - mx;
    const dy = (ys[index] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

function InVersusOut({ rows }: { rows: Row[] }) {
  const data = rows.map((row) => ({ strategy_id: row.strategy_id, x: asNumber(row.in_sample_net_ticks_per_session_day), y: asNumber(row.out_of_sample_net_ticks_per_session_day) }))
    .filter((point) => point.x !== null && point.y !== null);
  if (data.length === 0) return <Empty>No strategy has 100 in-sample trades.</Empty>;
  const correlation = pearson(data.map((point) => point.x as number), data.map((point) => point.y as number));
  const bothPositive = data.filter((point) => (point.x as number) > 0 && (point.y as number) > 0).length;
  return (
    <>
      <Finding>
        Pearson correlation of in-sample with out-of-sample net per day: <b>{fmt(correlation, 3)}</b> over {data.length} strategies; {bothPositive} are positive in both.
      </Finding>
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey="x" {...AXIS} label={{ value: "in-sample net ticks/day", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
          <YAxis type="number" dataKey="y" {...AXIS} label={{ value: "out-of-sample net ticks/day", angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 10 }} />
          <ZAxis range={[16, 16]} />
          <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 2)} />
          <ReferenceLine x={0} stroke={BLACK} />
          <ReferenceLine y={0} stroke={BLACK} />
          <Scatter data={data} fill={OKABE.blue} fillOpacity={0.55} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </>
  );
}

function StrategySection({ recipe, strategy, kept, controls, set }: TabProps & { recipe: string; strategy: string; kept: string[] }) {
  const query = useTa<RulesStrategyBody>("rules_strategy", { recipe, strategy, bins: controls.bins }, recipe !== "" && strategy !== "");
  const body = query.data?.data;
  let running = 0;
  const daily = (body?.daily ?? []).map((row) => {
    running += asNumber(row.net_ticks) ?? 0;
    const period = String(row.period ?? "");
    return { session_date: row.session_date, net_ticks: asNumber(row.net_ticks), period, cumulative: running,
      in_sample: period === "out_of_sample" ? null : running, out_of_sample: period === "out_of_sample" ? running : null };
  });
  // join the two segments where the period changes
  for (let index = 1; index < daily.length; index += 1) {
    const previous = daily[index - 1];
    const current = daily[index];
    if (previous && current && previous.period !== current.period && current.period === "out_of_sample") previous.out_of_sample = previous.cumulative;
  }
  const summary = eightNumberSummary(daily.map((row) => row.net_ticks).filter((value): value is number => value !== null));
  const yearly = body?.yearly ?? [];
  const thin = Math.max(1, Math.floor(daily.length / 1500));
  return (
    <Section title={`${strategy || "—"}: equity (dashed = out of sample), exits, and every column`} question="The strategies whose daily results and trades were stored.">
      <ControlBar>
        <SelectControl label="Strategy (trades stored)" value={strategy || "—"} options={(kept.length ? kept : ["—"]).map((value) => ({ value, label: value }))} onChange={(value) => set("keptStrategy", value)} />
      </ControlBar>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={daily.filter((_, index) => index % thin === 0)} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="session_date" {...AXIS} minTickGap={40} />
            <YAxis {...AXIS} width={60} />
            <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 1)} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line dataKey="in_sample" name="cumulative net ticks, in sample" stroke={OKABE.blue} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="out_of_sample" name="cumulative net ticks, out of sample" stroke={OKABE.blue} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="grid gap-3 xl:grid-cols-2">
          <DataTable rows={body?.exits ?? []} caption="Exits: trades and mean net ticks by exit reason." />
          <SummaryTable columns={[{ name: "net ticks per session day", summary, decimals: 2 }]} />
        </div>
        {yearly.length ? (
          <>
            <SubHeading>Lift over matched random entries, year by year (orange ▲ above, blue ▼ below; a pass needs 5 of 7 years above)</SubHeading>
            <GroupedBars bars={yearly.map((row) => ({
              category: String(row.year), group: "lift", value: asNumber(row.net_per_trade_lift_over_matched_null),
              tooltip: `${String(row.year)}: lift ${fmt(asNumber(row.net_per_trade_lift_over_matched_null), 2)} · ${fmtInt(asNumber(row.trade_count))} trades · target-hit ${fmt(asNumber(row.target_hit_rate), 3)} vs ${fmt(asNumber(row.matched_null_target_hit_rate), 3)} · net/trade ${fmt(asNumber(row.net_ticks_per_trade), 1)} · net/day ${fmt(asNumber(row.net_ticks_per_session_day), 1)}`,
            }))} groups={["lift"]} colourOf={() => OKABE.orange} signColoured yLabel="net ticks per trade above matched random" height={200} />
            <DataTable rows={yearly} />
          </>
        ) : <Finding>Year-by-year lift is recorded from rule round 2 on.</Finding>}
        <ProfileGrid profiles={body?.tradeProfiles ?? []} title="Trades of this strategy" rowCount={body?.tradeCount} bins={controls.bins} onBins={(value) => set("bins", value)} />
      </StudyState>
    </Section>
  );
}
