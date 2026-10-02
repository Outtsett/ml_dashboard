/**
 * §12 · Time of day, ETH vs RTH, time events and calendar days (derived_..._season_*), the expected move the
 * strategies size stops and targets with, and round 5's time-conditioned strategies.
 */

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, StudyNotes, StudyState, TOOLTIP,
  eightNumberSummary, fmt, fmtPercent,
} from "@/studies/kit";
import { expectedMove, type Row, type SeasonBody } from "@shared/studies/ta-strategy-600-ticks";
import { BLACK, ChipSelect, DataTable, GridHeatmap, HBarChart, Key, ProfileGrid, SeriesLines, SubHeading, asNumber, colourAt, dashAt, numbersOf, splitList, useTa } from "./common";
import type { TabProps } from "./controls";

const MEASURES = [
  { value: "relative_volatility_to_session_average", label: "relative volatility (× the session's average minute)" },
  { value: "average_five_minute_range_ticks", label: "5-minute range, ticks" },
  { value: "efficiency_relative_to_random_walk", label: "30-minute efficiency ratio ÷ random walk (above 1 trends, below 1 ranges)" },
  { value: "variance_ratio_five_minutes", label: "variance ratio VR(5) (above 1 trends, below 1 mean-reverts)" },
  { value: "autocorrelation_lags_two_to_four_minutes", label: "autocorrelation, lags 2-4 minutes" },
  { value: "breakout_follow_through_probability", label: "breakout follow-through probability" },
  { value: "mean_volume_contracts", label: "volume, contracts" },
];
const WEEKDAYS = ["all", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PART_COLOUR: Record<string, string> = { overnight: OKABE.orange, regular_hours: OKABE.blue, whole_session: BLACK };
const RTH_START = 930;   // 06:30 Pacific, minutes after the 15:00 open
const RTH_END = 1315;    // 12:55
const PRICE = 23_000;    // the notebook's P_t

export function SeasonTab({ controls, set }: TabProps) {
  const query = useTa<SeasonBody>("season", { symbol: controls.seasonMarket, year: controls.seasonYear, weekday: controls.weekday, measure: controls.measure, bins: controls.bins });
  const body = query.data?.data;
  const measureLabel = MEASURES.find((measure) => measure.value === controls.measure)?.label ?? controls.measure;
  const buckets = body?.buckets ?? [];
  const profile = buckets.map((row) => ({
    offset: asNumber(row.session_offset_minutes), bucket: String(row.bucket_start_pacific), part: String(row.session_part), sessions: asNumber(row.session_count),
    overnight: row.session_part === "overnight" ? asNumber(row[controls.measure]) : null,
    regular_hours: row.session_part === "regular_hours" ? asNumber(row[controls.measure]) : null,
  }));
  const bucketLabel = new Map(profile.map((row) => [row.offset, row.bucket]));

  return (
    <div className="space-y-3">
      <Section title="12 · Time of day, ETH vs RTH, time events"
        question="How volatility and ranging change through the CME session (15:00 to 14:00 Pacific), overnight (ETH) against regular hours (RTH, 06:30-13:00), by weekday, around time events and on calendar days. The strategies read the same shape causally: each session's profile comes only from sessions before it (seasonality.py).">
        <ControlBar>
          <SegmentControl label="Market" value={controls.seasonMarket} options={["MNQ", "NQ"].map((value) => ({ value, label: value }))} onChange={(value) => set("seasonMarket", value)} />
          <SelectControl label="Year" value={controls.seasonYear} options={(body?.years.length ? body.years : ["all"]).map((value) => ({ value, label: value }))} onChange={(value) => set("seasonYear", value)} />
          <SelectControl label="Weekday" value={controls.weekday} options={WEEKDAYS.map((value) => ({ value, label: value }))} onChange={(value) => set("weekday", value)} />
          <SelectControl label="Measure" value={controls.measure} options={MEASURES} onChange={(value) => set("measure", value)} />
        </ControlBar>
      </Section>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!body || body.recipe === "" ? <Empty>The timing study has not landed.</Empty> : (
          <>
            <Section title={`${measureLabel} through the session (${controls.seasonMarket}, ${controls.seasonYear}, ${controls.weekday})`} question={`Orange ▲ = overnight, blue ● = regular hours; the shaded span is 06:30-12:55. Recipe ${body.recipe}.`}>
              {profile.length === 0 ? <Empty>No buckets for this year and weekday ({controls.seasonMarket} covers {body.years.filter((year) => year !== "all").join(", ")}).</Empty> : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={profile} margin={{ top: 8, right: 12, left: 4, bottom: 14 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="offset" type="number" domain={[0, 1380]} ticks={Array.from({ length: 12 }, (_, index) => index * 120)} tickFormatter={(value: number) => bucketLabel.get(value) ?? ""} {...AXIS}
                      label={{ value: "5-minute bucket (Pacific)", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
                    <YAxis {...AXIS} width={56} />
                    <Tooltip {...TOOLTIP} labelFormatter={(value) => `${bucketLabel.get(Number(value)) ?? value} Pacific`} formatter={(value) => fmt(Number(value), 3)} />
                    <ReferenceArea x1={RTH_START} x2={RTH_END} fill={OKABE.blue} fillOpacity={0.08} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line dataKey="overnight" name="overnight ▲" stroke={OKABE.orange} dot={{ r: 1.5 }} connectNulls={false} isAnimationActive={false} />
                    <Line dataKey="regular_hours" name="regular hours ●" stroke={OKABE.blue} dot={{ r: 1.5 }} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <SubHeading>The same measure by weekday (all years)</SubHeading>
              <WeekdayHeat rows={body.heat} measure={controls.measure} label={measureLabel} />
            </Section>
            <OvernightVersusRegular body={body} bins={controls.bins} market={controls.seasonMarket} />
            <Events body={body} controls={controls} set={set} />
            <CalendarAndStability body={body} />
            <ExpectedMove body={body} controls={controls} set={set} />
            <RoundFive body={body} />
            <Section title={`Session table (${controls.seasonMarket}): every column, and its eight numbers`}>
              <ProfileGrid profiles={body.sessionProfiles} title="Sessions" rowCount={body.sessions.length} bins={controls.bins} onBins={(value) => set("bins", value)} />
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}

function WeekdayHeat({ rows, measure, label }: { rows: Row[]; measure: string; label: string }) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const buckets = [...new Map(rows.map((row) => [asNumber(row.session_offset_minutes) ?? 0, String(row.bucket_start_pacific)])).entries()].sort((a, b) => a[0] - b[0]).map(([, label]) => label);
  const lookup = new Map(rows.map((row) => [`${String(row.weekday)}|${String(row.bucket_start_pacific)}`, asNumber(row[measure])]));
  return <GridHeatmap rows={days} columns={buckets} value={(row, column) => lookup.get(`${row}|${column}`) ?? null} label={label} height={160} />;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return (sorted[low] as number) + ((sorted[high] as number) - (sorted[low] as number)) * (position - low);
}

function OvernightVersusRegular({ body, bins, market }: { body: SeasonBody; bins: number; market: string }) {
  const measures = ["realized_volatility_basis_points", "range_ticks", "efficiency_ratio", "volume_contracts"];
  const ratio = eightNumberSummary(numbersOf(body.sessions, "overnight_to_regular_hours_volatility_ratio"));
  const share = eightNumberSummary(numbersOf(body.sessions, "overnight_share_of_session_variance"));
  return (
    <Section title={`Overnight vs regular hours, one value per session (${market})`} question="Orange = overnight, blue = regular hours; each part clipped to its own 0.5-99.5 percentile, both binned on one common range.">
      <Finding>
        Overnight volatility is <b>{fmt(ratio.median, 2)}×</b> regular hours in the median session (25th-75th {fmt(ratio.percentile25, 2)}-{fmt(ratio.percentile75, 2)});
        overnight carries <b>{fmtPercent(share.median, 0)}</b> of the session's variance in the median session over ~72% of its minutes.
      </Finding>
      <Key items={[{ label: "overnight", colour: OKABE.orange, glyph: "square" }, { label: "regular hours", colour: OKABE.blue, glyph: "square" }]} />
      <div className="grid gap-2 xl:grid-cols-2">
        {measures.map((measure) => {
          const parts = ["overnight", "regular_hours"].map((part) => {
            const values = numbersOf(body.sessions, `${part}_${measure}`).sort((a, b) => a - b);
            const low = percentile(values, 0.005);
            const high = percentile(values, 0.995);
            return { part, values: values.map((value) => Math.min(Math.max(value, low), high)), low, high };
          });
          const low = Math.min(...parts.map((part) => part.low));
          const high = Math.max(...parts.map((part) => part.high));
          const width = (high - low) / bins || 1;
          const data = Array.from({ length: bins }, (_, index) => ({ middle: low + (index + 0.5) * width, overnight: 0, regular_hours: 0 }));
          for (const part of parts) {
            for (const value of part.values) {
              const index = Math.min(bins - 1, Math.max(0, Math.floor((value - low) / width)));
              const entry = data[index];
              if (entry) entry[part.part as "overnight" | "regular_hours"] += 1;
            }
          }
          return (
            <div key={measure} className="min-w-0 rounded border border-neutral-800 p-1">
              <div className="text-[10px] text-neutral-300">{measure}</div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={data} margin={{ top: 4, right: 6, left: 0, bottom: 0 }} barCategoryGap={0} barGap={0}>
                  <XAxis dataKey="middle" {...AXIS} tickFormatter={(value: number) => fmt(value, 1)} minTickGap={30} />
                  <YAxis {...AXIS} width={36} />
                  <Tooltip {...TOOLTIP} labelFormatter={(value) => `${measure} ≈ ${fmt(Number(value), 2)}`} />
                  <Bar dataKey="overnight" fill={OKABE.orange} opacity={0.7} isAnimationActive={false} />
                  <Bar dataKey="regular_hours" fill={OKABE.blue} opacity={0.7} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>
      <DataTable rows={body.parts} caption="The eight numbers of each measure by session part (season_parts, all years)." />
    </Section>
  );
}

function Events({ body, controls, set }: { body: SeasonBody } & Pick<TabProps, "controls" | "set">) {
  const names = [...new Set(body.events.map((row) => String(row.event)))].sort();
  const chosen = splitList(controls.events).filter((name) => names.includes(name));
  const scale = controls.eventScale;
  const minutes = [...new Set(body.events.map((row) => asNumber(row.minutes_from_event) ?? 0))].sort((a, b) => a - b);
  const byMinute = new Map<number, Row>(minutes.map((minute) => [minute, { minute }]));
  for (const row of body.events) {
    if (!chosen.includes(String(row.event))) continue;
    const entry = byMinute.get(asNumber(row.minutes_from_event) ?? 0);
    if (entry) entry[String(row.event)] = asNumber(row[scale]);
  }
  return (
    <Section title="Volatility around each time event (all years)" question="How much, and for how long, volatility rises around each scheduled event.">
      <ControlBar>
        <ChipSelect label="Events" options={names} selected={chosen} onChange={(next) => set("events", next.join(","))} />
        <SegmentControl label="Scale" value={scale} options={[{ value: "relative_to_pre_event_hour", label: "relative to the hour before (-60..-31)" }, { value: "mean_absolute_one_minute_return_basis_points", label: "basis points per minute" }]}
          onChange={(value) => set("eventScale", value)} />
      </ControlBar>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={[...byMinute.values()]} margin={{ top: 8, right: 12, left: 4, bottom: 14 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="minute" type="number" {...AXIS} label={{ value: "minutes from the event", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
          <YAxis {...AXIS} width={52} />
          <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 2)} labelFormatter={(value) => `${value} minutes from the event`} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <ReferenceLine x={0} stroke={BLACK} strokeDasharray="3 3" />
          {chosen.map((name) => {
            const index = names.indexOf(name);
            return <Line key={name} dataKey={name} stroke={colourAt(index)} strokeDasharray={dashAt(index) || (index % 2 ? "6 3" : undefined)} dot={false} isAnimationActive={false} />;
          })}
        </LineChart>
      </ResponsiveContainer>
    </Section>
  );
}

function CalendarAndStability({ body }: { body: SeasonBody }) {
  type CalendarRow = Row & { difference: number | null; standardError: number | null; low: number | null; high: number | null };
  const rows: CalendarRow[] = body.calendar.map((row) => {
    const difference = asNumber(row.log_ratio_difference);
    const t = asNumber(row.log_ratio_newey_west_t);
    const standardError = difference !== null && t ? Math.abs(difference / t) : null;
    return { ...row, difference, standardError, low: difference !== null && standardError !== null ? difference - 2 * standardError : null, high: difference !== null && standardError !== null ? difference + 2 * standardError : null };
  }).sort((a, b) => (b.difference ?? 0) - (a.difference ?? 0));
  const parts = [...new Set(body.stability.map((row) => String(row.session_part)))];
  const years = [...new Set(body.stability.map((row) => String(row.year)))].sort();
  const stability = years.map((year) => {
    const out: Row = { year };
    for (const row of body.stability) if (String(row.year) === year) out[String(row.session_part)] = asNumber(row.out_of_sample_r_squared_of_log_volatility);
    return out;
  });
  return (
    <Section title="Calendar days: which sessions run hotter or colder than usual (causal baseline)"
      question="Log volatility against the trailing 20-session median, minus the same for other sessions; whiskers ±2 standard errors, with SE = |difference ÷ Newey-West t|. ▲ overnight, ● regular hours.">
      <HBarChart
        rows={rows.map((row) => ({
          label: `${String(row.calendar_condition)} · ${String(row.session_part)}`, low: row.low, high: row.high,
          marks: [{ value: row.difference, glyph: row.session_part === "overnight" ? "triangle-up" : "circle", colour: PART_COLOUR[String(row.session_part)] ?? OKABE.sky, name: "log-ratio difference" }],
          tooltip: `${String(row.calendar_condition)} (${String(row.session_part)}): ${fmt(row.difference, 3)} ± ${fmt(row.standardError === null ? null : 2 * row.standardError, 3)} · ${String(row.session_count)} sessions · ratio to trailing median ${fmt(asNumber(row.volatility_ratio_to_trailing_median), 2)} · t ${fmt(asNumber(row.log_ratio_newey_west_t), 2)}`,
        }))}
        references={[{ value: 0, colour: BLACK, label: "0" }]} xLabel="log volatility vs trailing 20-session median, minus other sessions (±2 SE)" rowHeight={15} labelWidth={260}
      />
      <SubHeading>Is the time-of-day shape predictable? Out-of-sample fit of the causal profile, by year</SubHeading>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={stability} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="year" {...AXIS} />
          <YAxis {...AXIS} width={48} label={{ value: "share of bucket-to-bucket volatility explained", angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 9 }} />
          <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 3)} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {parts.map((part, index) => <Line key={part} dataKey={part} stroke={PART_COLOUR[part] ?? colourAt(index)} strokeDasharray={index === 2 ? "5 3" : undefined} dot={{ r: 3 }} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </Section>
  );
}

function ExpectedMove({ body, controls, set }: { body: SeasonBody } & Pick<TabProps, "controls" | "set">) {
  const shape: number[] = [];
  for (const row of body.shape) {
    const value = asNumber(row.relative_volatility_to_session_average) ?? Number.NaN;
    for (let repeat = 0; repeat < 5; repeat += 1) shape.push(value);
  }
  const basisPoints = numbersOf(body.shape, "mean_absolute_one_minute_return_basis_points");
  const meanBasisPoints = basisPoints.length ? basisPoints.reduce((a, b) => a + b, 0) / basisPoints.length : 0;
  const start = controls.moveStart;
  const horizon = controls.moveHorizon;
  const level = controls.moveLevel;
  const move = expectedMove(shape, start, horizon, level, meanBasisPoints, PRICE);
  const thin = 2;
  const area = shape.map((value, minute) => ({ minute, inside: minute > start && minute <= start + horizon ? value * value : null, outside: minute > start && minute <= start + horizon ? null : value * value }))
    .filter((_, minute) => minute % thin === 0);
  return (
    <Section title="The expected move the strategies size stops and targets with"
      question={`Slide the start across 06:30: the orange window picks up the open's spike and the range jumps, which is why a trailing ATR measured overnight is too tight at the open and too wide at lunch. Shape from ${controls.seasonMarket} ${body.shapeYear}.`}>
      <ControlBar>
        <SliderControl label="Start (minutes after 15:00 Pacific)" value={start} min={0} max={1375} step={5} onChange={(value) => set("moveStart", value)} format={(value) => `${value} (${expectedMove(shape, value, 1, 1, 0, 1).clock})`} />
        <SliderControl label="Horizon h (minutes)" value={horizon} min={5} max={240} step={5} onChange={(value) => set("moveHorizon", value)} />
        <SliderControl label="Level L (× a typical day)" value={level} min={0.5} max={3} step={0.1} onChange={(value) => set("moveLevel", value)} format={(value) => value.toFixed(1)} />
      </ControlBar>
      <FormulaCard
        tex={"\\text{expected range}_{t,h} = \\sqrt{\\tfrac{8}{\\pi}}\\cdot\\sqrt{\\tfrac{\\pi}{2}}\\; L_t \\sqrt{\\sum_{u=t+1}^{t+h} s_u^{2}}\\;\\cdot P_t"}
        caption={`Expected ${horizon}-minute range from ${move.clock}: ${fmt(move.movePoints, 1)} points = ${fmt(move.movePoints / 0.25, 0)} ticks (a flat day with no time-of-day shape would say ${fmt(move.flatMovePoints, 1)} points).`}
        symbols={[
          { tex: "\\sum_{u=t+1}^{t+h}", name: "sum over each minute u from the next one to h minutes ahead (stops at the 14:00 session end)", value: `${move.windowMinutes} minutes from ${move.clock}` },
          { tex: "s_u", name: "seasonal shape of minute u: expected |1-minute return| of its 5-minute bucket ÷ the session's average minute", value: `peak ${fmt(move.peakShape, 2)} in window` },
          { tex: "\\sum s_u^2", name: "expected variance over the window, in units of an average minute", value: fmt(move.sumOfSquares, 2) },
          { tex: "L_t", name: "volatility level: de-seasonalised average-minute |return| now (the strategies use an EWMA, half-life 60 minutes)", value: `${level.toFixed(1)} × typical = ${fmt(move.levelFraction * 1e4, 2)} bp` },
          { tex: "\\sqrt{\\pi/2}", name: "abs-to-sigma: a mean absolute return to a standard deviation (normal returns)", value: "1.253" },
          { tex: "\\sqrt{8/\\pi}", name: "range factor: expected high-low range of a random walk ÷ its standard deviation", value: "1.596" },
          { tex: "P_t", name: "price, index points (the notebook's constant)", value: PRICE.toLocaleString("en-US") },
        ]}
      />
      <Key items={[{ label: "s_u² inside the window", colour: OKABE.orange, glyph: "square" }, { label: "s_u² elsewhere", colour: OKABE.sky, glyph: "square" }]} />
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={area} margin={{ top: 8, right: 12, left: 4, bottom: 14 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="minute" type="number" domain={[0, 1380]} {...AXIS} label={{ value: "minutes after 15:00 Pacific", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
          <YAxis {...AXIS} width={40} />
          <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 3)} labelFormatter={(value) => `minute ${value}`} />
          <Area dataKey="outside" type="stepAfter" stroke={OKABE.sky} fill={OKABE.sky} fillOpacity={0.4} isAnimationActive={false} connectNulls={false} />
          <Area dataKey="inside" type="stepAfter" stroke={OKABE.orange} fill={OKABE.orange} fillOpacity={0.7} isAnimationActive={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Section>
  );
}

function RoundFive({ body }: { body: SeasonBody }) {
  const round = body.roundFive;
  if (!round.recipe) return <Section title="Round 5 (time-conditioned strategies)"><Empty>Not landed yet.</Empty></Section>;
  const templates = [...round.templates].sort((a, b) => (asNumber(b.net_ticks_per_session_day) ?? 0) - (asNumber(a.net_ticks_per_session_day) ?? 0));
  const kindOf = (name: string) => (name.startsWith("atr_breakout_control") ? "ATR control" : name.startsWith("seasonal") ? "seasonal" : "time event");
  return (
    <Section title="Round 5: time-conditioned strategies, tuned on prior years, tested 2022-2025"
      question="Bar = stitched out-of-sample net ticks per session day (orange ▲ positive, blue ▼ negative); black ◆ = excess over matched random entries.">
      <HBarChart
        rows={templates.map((row) => {
          const net = asNumber(row.net_ticks_per_session_day);
          const name = String(row.template);
          return {
            label: `${name} (${kindOf(name)}, ${name.includes("_eth") ? "overnight" : "regular hours"})`,
            bars: [{ value: net, colour: (net ?? 0) >= 0 ? OKABE.orange : OKABE.blue, name: "net ticks per session day" }],
            marks: [{ value: asNumber(row.excess_ticks_per_session_day), glyph: "diamond", colour: BLACK, name: "excess over matched random" }],
            tooltip: `${name}: net ${fmt(net, 1)} · excess ${fmt(asNumber(row.excess_ticks_per_session_day), 1)} (Newey-West t ${fmt(asNumber(row.excess_newey_west_t), 2)}) · ${fmt(asNumber(row.trades_per_session_day), 2)} trades/day · win rate ${fmt(asNumber(row.win_rate), 3)} · profit factor ${fmt(asNumber(row.profit_factor), 2)}`,
          };
        })}
        references={[{ value: 0, colour: "#737373", label: "" }]} xLabel="stitched out-of-sample net ticks per session day (2022-2025)" rowHeight={18} labelWidth={300}
      />
      <SeriesLines set={round.cumulative} yLabel="cumulative excess over matched random (ticks)" height={280} />
      <DataTable rows={templates} />
      <DataTable rows={round.rounds} />
    </Section>
  );
}
