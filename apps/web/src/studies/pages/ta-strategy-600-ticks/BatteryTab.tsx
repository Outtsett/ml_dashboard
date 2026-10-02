/**
 * §2-8 · The model battery (derived_ta_strategy_600_ticks_*): progress round by round, every configuration of
 * a round, one configuration's daily sum stepped day by day, every column drawn, the perfect-hindsight ceiling,
 * what LightGBM leaned on, and the reviews after each round.
 */

import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, Legend } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, Histogram, OKABE, Section, SelectControl, SliderControl, StudyNotes, StudyState,
  SummaryTable, TOOLTIP, eightNumberSummary, fmt, fmtInt, histogram,
} from "@/studies/kit";
import type { BatteryBody, BatteryConfigurationBody, BatteryRoundBody, Row } from "@shared/studies/ta-strategy-600-ticks";
import { BLACK, ChipSelect, DataTable, GroupedBars, HBarChart, Key, ProfileGrid, SubHeading, asNumber, linear, niceTicks, splitList, useTa, useWidth } from "./common";
import type { TabProps } from "./controls";

const SORTS = ["net_ticks_per_session_day_mean", "alpha_ticks_per_session_day", "alpha_newey_west_t", "excess_over_buy_and_hold_ticks_per_session_day",
  "trades_per_session_day", "test_area_under_roc_curve_median"];
const TIMEFRAMES = ["15m", "1h", "4h", "5m", "30m", "1m"];
const ROUND_COLUMNS = ["round", "recipe", "title", "best_configuration_id", "best_net_ticks_per_session_day", "best_interval_95_low", "best_interval_95_high",
  "primary_configuration_id", "primary_alpha_ticks_per_session_day", "primary_alpha_newey_west_t", "primary_passes_pre_registered_criteria",
  "best_alpha_configuration_id", "best_alpha_newey_west_t", "reality_check_p_value_best_alpha", "effective_trial_count", "configurations_positive",
  "configurations_beating_buy_and_hold", "configuration_count"];
const REVIEW_COLUMNS = ["round", "rank", "title", "category", "evidence", "expected_ticks_per_day_low", "expected_ticks_per_day_high", "confidence",
  "verified", "survived_verification", "verifier_reason"];

export function BatteryTab({ controls, set, overview }: TabProps) {
  const batteryQuery = useTa<BatteryBody>("battery");
  const rounds = batteryQuery.data?.data.rounds ?? [];
  const reviews = batteryQuery.data?.data.reviews ?? [];
  const recipe = controls.batteryRound || String(rounds[rounds.length - 1]?.recipe ?? "");
  const roundQuery = useTa<BatteryRoundBody>("battery_round", { recipe, bins: controls.bins }, recipe !== "");
  const timeframes = splitList(controls.batteryTimeframes);
  const configurations = (roundQuery.data?.data.configurations ?? [])
    .filter((row) => timeframes.includes(String(row.timeframe)))
    .sort((a, b) => (asNumber(b[controls.sortBy]) ?? -Infinity) - (asNumber(a[controls.sortBy]) ?? -Infinity));
  const configuration = configurations.some((row) => row.configuration_id === controls.configuration)
    ? controls.configuration : String(configurations[0]?.configuration_id ?? "");
  const goal = overview.goalTicks;
  const models = [...new Set(configurations.map((row) => String(row.model)))];
  const modelColour = (model: string) => (model === "lightgbm" ? OKABE.orange : model === "logistic" ? OKABE.blue : OKABE.sky);

  return (
    <div className="space-y-3">
      <StudyState isLoading={batteryQuery.isLoading} error={batteryQuery.error}>
        <StudyNotes notes={batteryQuery.data?.notes ?? []} />
        <Section title="2 · Progress toward 600, round by round" question="Best configuration's mean net ticks per session day; whiskers = 95% block-bootstrap interval; the orange line is the goal.">
          <GroupedBars
            bars={rounds.map((row) => ({
              category: `round ${String(row.round)}`, group: "best", value: asNumber(row.best_net_ticks_per_session_day),
              low: asNumber(row.best_interval_95_low), high: asNumber(row.best_interval_95_high),
              tooltip: `${String(row.recipe)} · ${String(row.best_configuration_id)}: ${fmt(asNumber(row.best_net_ticks_per_session_day), 1)} [${fmt(asNumber(row.best_interval_95_low), 1)}, ${fmt(asNumber(row.best_interval_95_high), 1)}]`,
            }))}
            groups={["best"]} colourOf={() => OKABE.blue} yLabel="best net ticks per session day"
            references={[{ value: goal, colour: OKABE.orange, label: `goal ${goal}` }]} height={220}
          />
          <DataTable rows={rounds} columns={ROUND_COLUMNS.filter((name) => rounds[0] && name in (rounds[0] as Row))} />
        </Section>

        <Section title="3 · Every configuration of the round"
          question="Bars: mean net ticks per session day, coloured by model; whiskers: 95% block-bootstrap interval; purple tick: buy-and-hold over the same days; vermillion ▶: alpha (rounds 2+), what is left after removing buy-and-hold beta; orange line: the 600 goal.">
          <ControlBar>
            <SelectControl label="Round" value={recipe} options={rounds.map((row) => ({ value: String(row.recipe), label: `round ${String(row.round)} · ${String(row.title)}` }))}
              onChange={(value) => set("batteryRound", value)} />
            <SelectControl label="Sort configurations by (alpha: rounds 2+)" value={controls.sortBy} options={SORTS.map((value) => ({ value, label: value }))} onChange={(value) => set("sortBy", value)} />
            <ChipSelect label="Timeframes" options={TIMEFRAMES} selected={timeframes} onChange={(next) => set("batteryTimeframes", next.join(","))} />
          </ControlBar>
          <StudyState isLoading={roundQuery.isLoading} error={roundQuery.error}>
            <StudyNotes notes={roundQuery.data?.notes ?? []} />
            <Key items={[
              ...models.map((model) => ({ label: `model ${model}`, colour: modelColour(model), glyph: "square" as const })),
              { label: "buy-and-hold", colour: OKABE.purple, glyph: "tick" as const },
              { label: "alpha", colour: OKABE.vermillion, glyph: "triangle-right" as const },
              { label: "600 goal", colour: OKABE.orange, dash: "" },
            ]} />
            <HBarChart
              rows={configurations.map((row) => ({
                label: String(row.configuration_id),
                bars: [{ value: asNumber(row.net_ticks_per_session_day_mean), colour: modelColour(String(row.model)), name: "net ticks per session day (mean)" }],
                low: asNumber(row.net_ticks_per_session_day_mean_interval_95_low), high: asNumber(row.net_ticks_per_session_day_mean_interval_95_high),
                marks: [
                  { value: asNumber(row.buy_and_hold_ticks_per_session_day), glyph: "tick", colour: OKABE.purple, name: "buy-and-hold ticks per session day" },
                  { value: asNumber(row.alpha_ticks_per_session_day), glyph: "triangle-right", colour: OKABE.vermillion, name: "alpha ticks per session day" },
                ],
                tooltip: `${String(row.configuration_id)}\nnet ${fmt(asNumber(row.net_ticks_per_session_day_mean), 1)} [${fmt(asNumber(row.net_ticks_per_session_day_mean_interval_95_low), 1)}, ${fmt(asNumber(row.net_ticks_per_session_day_mean_interval_95_high), 1)}]\nbuy-and-hold ${fmt(asNumber(row.buy_and_hold_ticks_per_session_day), 1)} · alpha ${fmt(asNumber(row.alpha_ticks_per_session_day), 1)} (Newey-West t ${fmt(asNumber(row.alpha_newey_west_t), 2)})\ntrades/day ${fmt(asNumber(row.trades_per_session_day), 2)} · win rate ${fmt(asNumber(row.win_rate), 3)}`,
              }))}
              references={[{ value: goal, colour: OKABE.orange, label: "600" }, { value: 0, colour: "#737373", label: "" }]}
              xLabel="net ticks per session day (mean)" rowHeight={16} labelWidth={180}
            />
            <DataTable rows={configurations} pageSize={10} />
            <SubHeading>Configurations table: every column</SubHeading>
            <ColumnGrid rows={configurations} exclude={["round"]} />
          </StudyState>
        </Section>

        <ConfigurationSection controls={controls} set={set} overview={overview} recipe={recipe} configurations={configurations.map((row) => String(row.configuration_id))} configuration={configuration} />

        <OracleSection body={roundQuery.data?.data} goal={goal} bins={controls.bins} onBins={(value) => set("bins", value)} />

        <Section title="7 · What LightGBM leaned on" question="Gain share, averaged over folds; the top 40 across all fits of the round (round 2 fit logistic models only, so it has none).">
          <ImportanceChart rows={roundQuery.data?.data.importance ?? []} />
        </Section>

        <Section title="8 · Review after each round" question="What to do better, ranked by expected ticks per day, and whether each recommendation survived verification.">
          <DataTable rows={reviews} columns={REVIEW_COLUMNS.filter((name) => reviews[0] && name in (reviews[0] as Row))} pageSize={10} />
        </Section>
      </StudyState>
    </div>
  );
}

function ConfigurationSection({ controls, set, overview, recipe, configurations, configuration }: TabProps & { recipe: string; configurations: string[]; configuration: string }) {
  const query = useTa<BatteryConfigurationBody>("battery_configuration", { recipe, configuration, bins: controls.bins }, recipe !== "" && configuration !== "");
  const tick = overview.tickValueUsd;
  let cumulativeNet = 0;
  let cumulativeHold = 0;
  type DailyRow = Row & { net_ticks: number; buy_and_hold_ticks: number; cumulative_net_ticks: number; cumulative_buy_and_hold_ticks: number; day_number: number; running_mean_net_ticks: number };
  const daily: DailyRow[] = (query.data?.data.daily ?? []).map((row, index) => {
    const net = (asNumber(row.net_usd) ?? 0) / tick;
    const hold = (asNumber(row.buy_and_hold_usd) ?? 0) / tick;
    cumulativeNet += net;
    cumulativeHold += hold;
    return { ...row, net_ticks: net, buy_and_hold_ticks: hold, cumulative_net_ticks: cumulativeNet, cumulative_buy_and_hold_ticks: cumulativeHold,
      day_number: index + 1, running_mean_net_ticks: cumulativeNet / (index + 1) };
  });
  const days = daily.length;
  const step = Math.min(Math.max(1, controls.dayStep), Math.max(1, days));
  const current = daily[step - 1];
  const netValues = daily.map((row) => row.net_ticks);
  const summary = eightNumberSummary(netValues);
  const folds = query.data?.data.folds ?? [];
  const thin = Math.max(1, Math.floor(days / 1500));
  return (
    <>
      <Section title={`4 · ${configuration || "—"}: the daily sum, stepped`} question="Pick a configuration and step the day: the running mean of the daily sum against the goal.">
        <ControlBar>
          <SelectControl label="Configuration" value={configuration || "—"} options={(configurations.length ? configurations : ["—"]).map((value) => ({ value, label: value }))}
            onChange={(value) => set("configuration", value)} />
          <SliderControl label="Step the sum: day d" value={step} min={1} max={Math.max(1, Math.min(400, days))} onChange={(value) => set("dayStep", value)} />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={query.data?.notes ?? []} />
          {days === 0 ? <Empty>No daily rows for this configuration.</Empty> : (
            <>
              <FormulaCard
                tex={"\\bar{x} = \\frac{1}{D}\\sum_{d=1}^{D} x_d"}
                caption={`Running total after day ${step}: ${fmt(current?.cumulative_net_ticks, 0)} ticks; running mean ${fmt(current?.running_mean_net_ticks, 1)} against the goal ${overview.goalTicks}.`}
                symbols={[
                  { tex: "\\sum_{d=1}^{D}", name: "sum over every test session day d", value: `${days} days` },
                  { tex: "x_d", name: `net ticks on session day d (net USD ÷ ${fmt(tick, 2)} USD a tick)`, value: `${fmt(current?.net_ticks, 1)} on ${String(current?.session_date ?? "—")}` },
                  { tex: "d", name: "the day being stepped", value: String(step) },
                  { tex: "D", name: "test session days of this configuration", value: String(days) },
                  { tex: "\\bar{x}", name: "mean net ticks per session day (running mean at day d)", value: fmt(current?.running_mean_net_ticks, 2) },
                  { tex: "\\text{trades}_d", name: "trades on day d", value: fmtInt(asNumber(current?.trade_count)) },
                ]}
              />
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-neutral-400">Net ticks on the day, 60 bins (orange ▲ above zero, blue ▼ below); orange dashed = the goal.</p>
                  <Histogram bins={histogram(netValues, 60)} unit="ticks" markers={[{ x: overview.goalTicks, label: "600", color: OKABE.orange }]} />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] text-neutral-400">Running mean of the sum ÷ d, up to the stepped day (◆).</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <ComposedChart data={daily.slice(0, step)} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="day_number" type="number" domain={[1, Math.max(2, step)]} {...AXIS} />
                      <YAxis {...AXIS} width={52} />
                      <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 1)} labelFormatter={(value) => `day ${value}`} />
                      <ReferenceLine y={0} stroke="#737373" />
                      <Line dataKey="running_mean_net_ticks" name="running mean" stroke={OKABE.blue} dot={false} isAnimationActive={false} />
                      <Scatter data={current ? [current] : []} dataKey="running_mean_net_ticks" fill={OKABE.orange} shape="diamond" isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <p className="text-[11px] text-neutral-400">Cumulative net ticks (purple, solid) against buy-and-hold over the same days (blue, dashed).</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={daily.filter((_, index) => index % thin === 0)} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="session_date" {...AXIS} minTickGap={40} />
                  <YAxis {...AXIS} width={60} tickFormatter={(value: number) => fmtInt(value)} />
                  <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 0)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line dataKey="cumulative_net_ticks" name="cumulative net ticks" stroke={OKABE.purple} dot={false} isAnimationActive={false} />
                  <Line dataKey="cumulative_buy_and_hold_ticks" name="cumulative buy-and-hold ticks" stroke={OKABE.blue} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <SummaryTable columns={[{ name: "net ticks per session day", summary, decimals: 2 }]} />
            </>
          )}
        </StudyState>
      </Section>
      <Section title="5 · Every column, drawn" question="The daily table (with net ticks derived), the trades and the folds of this configuration.">
        <SubHeading>Daily table (this configuration)</SubHeading>
        <ColumnGrid rows={daily} exclude={["round", "fold_index"]} />
        <SubHeading>Trades (this configuration)</SubHeading>
        <ProfileGrid profiles={query.data?.data.tradeProfiles ?? []} title="Trades" rowCount={query.data?.data.tradeCount} bins={controls.bins} onBins={(value) => set("bins", value)} />
        <SubHeading>Folds (this configuration)</SubHeading>
        <ColumnGrid rows={folds} exclude={["round", "fold_index"]} />
        <DataTable rows={folds} />
      </Section>
    </>
  );
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return (sorted[low] as number) + ((sorted[high] as number) - (sorted[low] as number)) * (position - low);
}

function OracleSection({ body, goal, bins, onBins }: { body: BatteryRoundBody | undefined; goal: number; bins: number; onBins: (value: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const rows = body?.oracle ?? [];
  const measures = rows[0] ? Object.keys(rows[0]).filter((name) => name.endsWith("swing_net_ticks")) : [];
  const boxes = measures.map((measure) => {
    const shares = rows.map((row) => asNumber(row[measure])).filter((value): value is number => value !== null && value !== 0).map((value) => goal / value).sort((a, b) => a - b);
    const p25 = quantile(shares, 0.25);
    const p75 = quantile(shares, 0.75);
    const spread = p75 - p25;
    const inside = shares.filter((value) => value >= p25 - 1.5 * spread && value <= p75 + 1.5 * spread);
    return { measure: measure.replace("_net_ticks", "_goal_share"), p25, median: quantile(shares, 0.5), p75, low: inside[0] ?? p25, high: inside[inside.length - 1] ?? p75,
      outliers: shares.filter((value) => value < p25 - 1.5 * spread || value > p75 + 1.5 * spread), count: shares.length };
  });
  const ceilings = measures.map((measure) => quantile(rows.map((row) => asNumber(row[measure])).filter((value): value is number => value !== null).sort((a, b) => a - b), 0.5));
  const bestNet = Math.max(...(body?.configurations ?? []).map((row) => asNumber(row.net_ticks_per_session_day_mean) ?? Number.NEGATIVE_INFINITY));
  const smallestCeiling = Math.min(...ceilings);
  const largestCeiling = Math.max(...ceilings);
  const left = 250;
  const height = 24 + boxes.length * 34;
  const x = linear([0, 0.6], [left, width - 12]);
  const clamp = (value: number) => Math.min(Math.max(value, 0), 0.6);
  return (
    <Section title="6 · What the market offered each session" question="Perfect-hindsight zigzag at five swing sizes, each leg charged a round trip: 600 ÷ the day's ceiling is the share of the day's swings you must capture (clamped to 0-0.6).">
      {boxes.length === 0 ? <Empty>No complete sessions in this round.</Empty> : (
        <div ref={ref} className="w-full min-w-0">
          <svg width={width} height={height} className="block">
            {niceTicks(0, 0.6, 6).map((tick) => (
              <g key={tick}>
                <line x1={x(tick)} x2={x(tick)} y1={4} y2={height - 20} stroke="#262626" />
                <text x={x(tick)} y={height - 6} textAnchor="middle" fontSize={9} fill="#8a8a8a">{tick.toFixed(1)}</text>
              </g>
            ))}
            {boxes.map((box, index) => {
              const y = 8 + index * 34;
              return (
                <g key={box.measure}>
                  <title>{`${box.measure}: median ${fmt(box.median, 3)}, 25th-75th ${fmt(box.p25, 3)}-${fmt(box.p75, 3)}, ${box.count} sessions, ${box.outliers.length} outliers`}</title>
                  <text x={left - 6} y={y + 14} textAnchor="end" fontSize={10} fill="#d4d4d4">{box.measure}</text>
                  <line x1={x(clamp(box.low))} x2={x(clamp(box.high))} y1={y + 11} y2={y + 11} stroke={BLACK} />
                  <rect x={x(clamp(box.p25))} width={Math.max(1, x(clamp(box.p75)) - x(clamp(box.p25)))} y={y + 2} height={18} fill={OKABE.blue} opacity={0.7} />
                  <line x1={x(clamp(box.median))} x2={x(clamp(box.median))} y1={y + 2} y2={y + 20} stroke={BLACK} strokeWidth={2} />
                  {box.outliers.slice(0, 300).map((value, outlier) => <circle key={outlier} cx={x(clamp(value))} cy={y + 11} r={1.5} fill={OKABE.sky} opacity={0.6} />)}
                </g>
              );
            })}
          </svg>
          <Finding>
            The median session needs {boxes.map((box) => `${fmt(box.median * 100, 1)}% (${box.measure.replace("session_oracle_", "").replace("_goal_share", "")})`).join(", ")} of its hindsight swings to reach 600;
            The median session's hindsight ceiling runs from {fmt(smallestCeiling, 0)} to {fmt(largestCeiling, 0)} net ticks across these swing sizes; the best
            configuration of the round nets {fmt(bestNet, 1)} ticks a day, {fmt((bestNet / largestCeiling) * 100, 1)}% to {fmt((bestNet / smallestCeiling) * 100, 1)}% of those ceilings.
          </Finding>
        </div>
      )}
      <ProfileGrid profiles={body?.oracleProfiles ?? []} title="Oracle-by-session: every ticks and count column" bins={bins} onBins={onBins} rowCount={rows.length} />
    </Section>
  );
}

function ImportanceChart({ rows }: { rows: Row[] }) {
  const top = rows.slice(0, 40).map((row) => ({ ...row, label: `${String(row.feature)} · ${String(row.timeframe)} h${String(row.horizon_bars)}` }));
  if (top.length === 0) return <Empty>This round fitted no LightGBM model.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(240, top.length * 15)}>
      <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" {...AXIS} />
        <YAxis type="category" dataKey="label" width={230} {...AXIS} interval={0} />
        <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 4)}
          labelFormatter={(_, payload) => {
            const row = payload?.[0]?.payload as Row | undefined;
            return row ? `${String(row.feature)} · ${String(row.timeframe)} · horizon ${String(row.horizon_bars)} bars · ${String(row.folds_present)} folds` : "";
          }} />
        <Bar dataKey="gain_share_mean" name="gain share" fill={OKABE.sky} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
