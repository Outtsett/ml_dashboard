/**
 * Section 10: every TA-Lib pattern side and every learned shape code, on 1m to
 * 4h candles, and the next six candles after it: against every bar (A) and
 * against bars like it (B, a matched gradient-boosted baseline), screened on
 * 2021-2023, frozen, tested once on 2024 and only then on 2025.
 */

import {
  Bar, BarChart, CartesianGrid, ErrorBar, Legend as ChartLegend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat, StudyNotes,
  StudyState, TOOLTIP, fmt, fmtInt, useStudyQuery,
} from "@/studies/kit";
import { NEXT_FAMILIES, NEXT_TIMEFRAMES, type NextPatternBody, type NextSummaryBody, type NextTradesBody, type Row } from "@shared/studies/candle-vectors";
import { CandleChart, CandleKey, DataTable, IntervalPlot, Legend, MatrixHeatmap, ScatterCanvas, diverging, type CandleMark, type GlyphName, type IntervalItem, type SeriesStyle } from "./charts";
import type { TabProps } from "./controls";

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const words = (text: unknown) => String(text ?? "").replace(/_/g, " ");
const QUESTION_STYLE: Record<string, SeriesStyle> = {
  unconditional: { color: OKABE.blue, glyph: "circle", label: "A · against every bar" },
  matched: { color: OKABE.vermillion, glyph: "diamond", label: "B · against bars like it" },
  jump: { color: OKABE.grey, glyph: "square", label: "close → next open (not tradeable)" },
};
const SPLIT_STYLE: Record<string, SeriesStyle> = {
  discovery: { color: OKABE.grey, glyph: "circle", label: "2021–2023 (discovery)" },
  validation: { color: OKABE.blue, glyph: "square", label: "2024 (validation)" },
  holdout: { color: OKABE.orange, glyph: "diamond", label: "2025 (holdout)" },
};
const SPLIT_LABEL: Record<string, string> = { discovery: "2021–2023 (screen)", validation: "2024 (validation)", holdout: "2025 (holdout)" };
const TIMEFRAME_GLYPH: Record<string, GlyphName> = { "1m": "circle", "5m": "square", "15m": "diamond", "1h": "triangle-up", "4h": "triangle-down" };

function Headline({ summary }: { summary: NextSummaryBody }) {
  const tiles = (["unconditional", "matched"] as const).map((question) => {
    const screened = summary.screen.filter((row) => row.question === question);
    const real = screened.filter((row) => row.survives_screen === true).length;
    const chance = summary.placebo.filter((row) => row.question === question).map((row) => Number(row.survivors)).sort((a, b) => a - b);
    // polars' Series.quantile(0.95) as the notebook calls it: the nearest rank, not an interpolation
    const p95 = chance.length ? (chance[Math.round(0.95 * (chance.length - 1))] as number) : null;
    const frozen = summary.rules.filter((row) => row.question === question);
    return {
      question, real, p95, screened: screened.length, frozen: frozen.length,
      passed: frozen.filter((row) => row.passes_validation === true).length,
      replicated: frozen.filter((row) => Boolean(row.holdout_replicates_information)).length,
      tradeable: frozen.filter((row) => row.tradeable_edge_in_holdout === true).length,
    };
  });
  const totalTradeable = summary.rules.filter((row) => row.tradeable_edge_in_holdout === true).length;
  const run = summary.runInformation;
  return (
    <>
      <Finding>
        <b>Did any pattern or shape carry a tradeable edge into 2025?</b> {totalTradeable ? `Yes: ${totalTradeable} rule(s), listed in 10.5.` : "No."} Testable pattern sides
        and codes per timeframe: {summary.testableCounts.map((row) => `${row.timeframe} ${row.cells}`).join(", ")}. Cost: {fmt(num(run?.round_trip_cost_ticks), 1)} ticks round
        trip ({fmt(num(run?.stress_cost_ticks), 1)} under stress).
      </Finding>
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        {tiles.flatMap((tile) => [
          <Stat key={`${tile.question}s`} label={`${QUESTION_STYLE[tile.question]?.label}: 2021–2023 survivors · placebo 95th pct`} value={`${tile.real} · ${fmt(tile.p95, 0)}`} hint={`${tile.screened} pattern sides screened`} />,
          <Stat key={`${tile.question}r`} label={`${QUESTION_STYLE[tile.question]?.label}: pass 2024 · repeat in 2025 · tradeable in 2025`} value={`${tile.passed} of ${tile.frozen} · ${tile.replicated} · ${tile.tradeable}`} hint="frozen direction and k; tradeable = net of costs" />,
        ])}
      </div>
    </>
  );
}

function AverageCandles({ body, candle }: { body: NextPatternBody; candle: number }) {
  const rows = body.averageCandles;
  const firings = rows.filter((row) => row.population === "firings");
  const every = rows.filter((row) => row.population === "every bar");
  const toCandle = (row: Row, x: number, hollow: boolean): CandleMark => {
    const c = { open: num(row.mean_open_from_pattern_close_in_average_ranges) ?? Number.NaN, high: num(row.mean_high_from_pattern_close_in_average_ranges) ?? Number.NaN,
      low: num(row.mean_low_from_pattern_close_in_average_ranges) ?? Number.NaN, close: num(row.mean_close_from_pattern_close_in_average_ranges) ?? Number.NaN };
    return { x, ...c, hollow, fill: hollow ? OKABE.grey : undefined, stroke: hollow ? OKABE.grey : undefined, widthFraction: hollow ? 0.25 : 0.4,
      tip: [`${String(row.population)} · candle ${String(row.candle_offset)} · ${fmtInt(num(row.count))}`, `open ${fmt(c.open, 3)} · high ${fmt(c.high, 3)} · low ${fmt(c.low, 3)} · close ${fmt(c.close, 3)}`] };
  };
  const candles = [
    ...every.map((row) => toCandle(row, Number(row.candle_offset) + 0.3, true)),
    ...firings.map((row) => toCandle(row, Number(row.candle_offset) - (Number(row.candle_offset) > 0 ? 0.15 : 0), false)),
  ];
  const markers = firings.filter((row) => Number(row.candle_offset) > 0 && num(row.matched_baseline_close_from_pattern_close_in_average_ranges) !== null).map((row) => ({
    x: Number(row.candle_offset) - 0.15, y: num(row.matched_baseline_close_from_pattern_close_in_average_ranges) as number, glyph: "diamond" as const, color: OKABE.vermillion,
    tip: [`matched expectation, candle ${String(row.candle_offset)}`, fmt(num(row.matched_baseline_close_from_pattern_close_in_average_ranges), 3)],
  }));
  const minimum = Math.min(0, ...rows.map((row) => Number(row.candle_offset)));
  const cost = num(body.bars?.round_trip_cost_in_median_average_ranges) ?? 0;
  const effects = body.effects.map((row) => {
    const jump = String(row.measure).startsWith("jump");
    const question = jump ? "jump" : String(row.question);
    const value = num(row.difference_average_ranges) ?? 0;
    return {
      question, x: jump ? 0 : Number(row.candle) + (row.question === "matched" ? 0.12 : -0.12), value,
      whisker: [value - (num(row.difference_day_block_lower_95) ?? value), (num(row.difference_day_block_upper_95) ?? value) - value],
      firings: num(row.firings), days: num(row.trading_days), ticks: num(row.difference_ticks_at_median_average_range), detectable: num(row.minimum_detectable_difference_ticks),
    };
  });
  return (
    <>
      <CandleChart candles={candles} markers={markers} height={300} xDomain={[minimum - 0.6, 6.7]} format={(v) => fmt(v, 2)}
        vLines={[{ x: candle, color: "#e5e5e5", dash: "4 3" }]} hLines={[{ y: 0, color: "#737373", dash: "2 2" }]}
        xLabel="candles after the pattern (0 = the pattern's last candle)" yLabel="from the pattern close, average ranges"
        title={`${body.pattern ? words(body.pattern) : ""} · ${body.side}`} />
      <CandleKey extra={<> · hollow grey = what follows any bar · <span style={{ color: OKABE.vermillion }}>◆ = matched expectation (bars like these)</span> · dashed = candle k</>} />
      <div className="text-[11px] text-neutral-300">The tested effect Δk (the move from the next open) with its 95% trading-day interval; grey band = the round-trip cost at the median candle size</div>
      <Legend items={Object.entries(QUESTION_STYLE).map(([key, style]) => ({ key, ...style }))} />
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 6, right: 8, left: 4, bottom: 16 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey="x" domain={[-0.5, 6.5]} ticks={[0, 1, 2, 3, 4, 5, 6]} {...AXIS} label={{ value: "candle k (0 = the jump to the next open)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
          <YAxis type="number" dataKey="value" {...AXIS} tickFormatter={(v: number) => fmt(v, 3)} label={{ value: "effect Δk, average ranges", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
          <ZAxis range={[50, 50]} />
          <ReferenceArea y1={-cost} y2={cost} fill={OKABE.grey} fillOpacity={0.18} />
          <ReferenceLine y={0} stroke="#e5e5e5" />
          <Tooltip {...TOOLTIP} content={({ payload }) => {
            const p = payload?.[0]?.payload as (typeof effects)[number] | undefined;
            if (!p) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="px-2 py-1 text-[11px]">
                <div>{QUESTION_STYLE[p.question]?.label}</div>
                <div>Δ {fmt(p.value, 4)} [{fmt(p.value - (p.whisker[0] ?? 0), 4)}, {fmt(p.value + (p.whisker[1] ?? 0), 4)}]</div>
                <div>firings {fmtInt(p.firings)} over {fmtInt(p.days)} days · {fmt(p.ticks, 1)} ticks at the median range</div>
                <div>smallest detectable {fmt(p.detectable, 1)} ticks</div>
              </div>
            );
          }} />
          {(["unconditional", "matched", "jump"] as const).map((question) => (
            <Scatter key={question} data={effects.filter((row) => row.question === question)} fill={QUESTION_STYLE[question]?.color}
              shape={question === "matched" ? "diamond" : question === "jump" ? "square" : "circle"} isAnimationActive={false}>
              <ErrorBar dataKey="whisker" direction="y" width={4} stroke={QUESTION_STYLE[question]?.color} />
            </Scatter>
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </>
  );
}

function Shares({ body }: { body: NextPatternBody }) {
  const colour: Record<string, string> = { up: OKABE.orange, down: OKABE.blue, flat: OKABE.grey };
  return (
    <div className="grid min-w-0 gap-2 xl:grid-cols-3">
      {["up", "down", "flat"].map((direction) => {
        const data = body.shares.filter((row) => row.direction === direction).map((row) => {
          const share = num(row.share) ?? 0;
          return { population: String(row.population), x: Number(row.candle) + (row.population === "firings" ? -0.15 : 0.15), share,
            whisker: [share - (num(row.wilson_lower_95) ?? share), (num(row.wilson_upper_95) ?? share) - share], count: num(row.count) };
        });
        return (
          <div key={direction} className="min-w-0">
            <div className="text-[11px] font-medium" style={{ color: colour[direction] }}>{direction === "up" ? "▲ up" : direction === "down" ? "▼ down" : "■ flat"}</div>
            <ResponsiveContainer width="100%" height={180}>
              <ScatterChart margin={{ top: 4, right: 6, left: 0, bottom: 4 }}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" dataKey="x" domain={[0.5, 6.5]} ticks={[1, 2, 3, 4, 5, 6]} {...AXIS} />
                <YAxis type="number" dataKey="share" domain={["auto", "auto"]} {...AXIS} tickFormatter={(v: number) => fmt(v, 2)} />
                <ZAxis range={[40, 40]} />
                <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 3), String(name)]} />
                <Scatter name="firings (filled ◆)" data={data.filter((row) => row.population === "firings")} fill={colour[direction]} shape="diamond" isAnimationActive={false}>
                  <ErrorBar dataKey="whisker" direction="y" width={3} stroke={colour[direction]} />
                </Scatter>
                <Scatter name="every bar (hollow ●)" data={data.filter((row) => row.population === "every bar")} fill="#0a0a0a" stroke={colour[direction]} shape="circle" isAnimationActive={false}>
                  <ErrorBar dataKey="whisker" direction="y" width={3} stroke={colour[direction]} />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

function Trades({ controls, set, patternSide }: TabProps & { patternSide: string }) {
  const query = useStudyQuery<NextTradesBody>("candle-vectors", {
    section: "nextTrades", nextTimeframe: controls.nextTimeframe, family: controls.family, split: controls.split, candle: controls.candle,
    patternSide, tail: controls.tail,
  }, { enabled: patternSide !== "" });
  const body = query.data?.data;
  if (!patternSide) return null;
  const firings = body?.histogram.filter((row) => row.population === "firings") ?? [];
  const every = body?.histogram.filter((row) => row.population === "every bar") ?? [];
  const merged = firings.map((row, index) => ({ net_ticks: row.net_ticks, firings: row.share_of_trades, every: every[index]?.share_of_trades ?? 0 }));
  return (
    <Section title="10.3 · Every trade, not just the average" question="Each firing traded in its pattern's claimed direction (long where it claims none): enter at the next candle's open, exit at candle k's close, net of the round-trip cost. Every bar traded the same way is the grey reference.">
      <ControlBar>
        <SliderControl label="Histogram spans the middle % of trades" value={controls.tail} min={90} max={100} step={0.5} onChange={(v) => set("tail", v)} format={(v) => `${v}%`} />
      </ControlBar>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!body?.landed ? <Empty>The next-candle rows are not in the lake.</Empty> : !body.enoughTrades ? <Empty>Fewer than 30 trades in these years ({fmtInt(body.firingTrades)}).</Empty> : (
          <>
            <div className="text-[11px] text-neutral-300">{fmtInt(body.firingTrades)} firings traded {body.direction > 0 ? "long" : "short"} · net ticks, candle {controls.candle}, after {fmt(body.costTicks, 1)} ticks cost</div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={merged} margin={{ top: 6, right: 8, left: 4, bottom: 16 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="net_ticks" type="number" domain={["dataMin", "dataMax"]} {...AXIS} tickFormatter={(v: number) => fmt(v, 0)} label={{ value: "net ticks per trade", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis {...AXIS} tickFormatter={(v: number) => fmt(v, 3)} label={{ value: "share of trades", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                <ReferenceLine x={0} stroke="#e5e5e5" strokeDasharray="4 3" />
                <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 4), String(name)]} labelFormatter={(v) => `${fmt(Number(v), 1)} ticks`} />
                <ChartLegend wrapperStyle={{ fontSize: 11 }} />
                <Line type="stepAfter" dataKey="firings" name="firings (solid)" stroke={OKABE.orange} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="stepAfter" dataKey="every" name="every bar (dashed)" stroke={OKABE.grey} strokeDasharray="5 3" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <DataTable rows={body.summary as unknown as Row[]} />
          </>
        )}
      </StudyState>
    </Section>
  );
}

function ScreenAndPlacebo({ summary }: { summary: NextSummaryBody }) {
  const screened = summary.screen.filter((row) => row.enters_screen === true);
  const styles: Record<string, SeriesStyle> = {};
  for (const question of ["unconditional", "matched"]) {
    for (const timeframe of NEXT_TIMEFRAMES) {
      for (const survives of [true, false]) {
        styles[`${question}|${timeframe}|${survives}`] = { color: QUESTION_STYLE[question]!.color, glyph: TIMEFRAME_GLYPH[timeframe] ?? "circle", label: "", hollow: !survives };
      }
    }
  }
  const xs = screened.map((row) => num(row.difference_at_largest_t_average_ranges) ?? 0);
  const ys = screened.map((row) => num(row.largest_absolute_t) ?? 0);
  return (
    <Section title="10.4 · Every pattern side at once, and what chance alone produces" question="Each point is one pattern side or shape code on one timeframe, screened on 2021-2023: its largest |t| over the six candles against the effect at that candle. Filled = survives the Benjamini-Yekutieli screen. The histograms show how many survivors the same screen produced on firings moved by whole trading days; the white rule is the real count.">
      {screened.length === 0 ? <Empty>No pattern side met the firing minimums.</Empty> : (
        <div className="grid min-w-0 gap-3 xl:grid-cols-[2fr_1fr]">
          <div className="min-w-0">
            <Legend items={[{ key: "a", ...QUESTION_STYLE.unconditional! }, { key: "b", ...QUESTION_STYLE.matched! },
              ...NEXT_TIMEFRAMES.map((tf) => ({ key: tf, color: "#d4d4d4", glyph: TIMEFRAME_GLYPH[tf] ?? "circle", label: tf }))]} />
            <ScatterCanvas opacity={1} size={4} height={360} styles={styles}
              xDomain={[Math.min(...xs) - Math.abs(Math.min(...xs)) * 0.05, Math.max(...xs) + Math.abs(Math.max(...xs)) * 0.05]} yDomain={[0, Math.max(...ys) * 1.05]}
              xLabel="effect at that candle, average ranges" yLabel="largest |t| over k = 1..6"
              points={screened.map((row) => ({
                x: num(row.difference_at_largest_t_average_ranges) ?? 0, y: num(row.largest_absolute_t) ?? 0,
                group: `${String(row.question)}|${String(row.timeframe)}|${row.survives_screen === true}`,
                tip: () => [`${String(row.timeframe)} · ${String(row.family)} · ${words(row.pattern)} — ${String(row.side)}`, QUESTION_STYLE[String(row.question)]?.label ?? "",
                  `discovery firings ${fmtInt(num(row.discovery_firings))}`, `candle at largest t ${String(row.candle_at_largest_t)} · t ${fmt(num(row.t_statistic), 2)}`,
                  `effect ${fmt(num(row.difference_at_largest_t_average_ranges), 4)}`, `p over six candles ${num(row.p_value_over_six_candles)?.toExponential(2) ?? "—"}`,
                  `Benjamini-Yekutieli q ${fmt(num(row.benjamini_yekutieli_q_value), 3)} · ${row.survives_screen === true ? "survives" : "does not survive"}`],
              }))} />
          </div>
          <div className="min-w-0 space-y-2">
            {(["unconditional", "matched"] as const).map((question) => {
              const sets = summary.placebo.filter((row) => row.question === question);
              const real = num(sets[0]?.real_survivors) ?? 0;
              const maximum = Math.max(real, ...sets.map((row) => Number(row.survivors)));
              const counts = Array.from({ length: maximum + 1 }, (_, survivors) => ({ survivors, sets: sets.filter((row) => Number(row.survivors) === survivors).length }));
              return (
                <div key={question} className="min-w-0">
                  <div className="text-[11px] text-neutral-300">{QUESTION_STYLE[question]?.label}: real {real}</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={counts} margin={{ top: 4, right: 6, left: 0, bottom: 14 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis dataKey="survivors" {...AXIS} label={{ value: "survivors on placebo firings", position: "insideBottom", offset: -6, fill: "#a3a3a3", fontSize: 10 }} />
                      <YAxis allowDecimals={false} {...AXIS} />
                      <Tooltip {...TOOLTIP} />
                      <ReferenceLine x={real} stroke="#f5f5f5" strokeWidth={2} />
                      <Bar dataKey="sets" name="placebo sets" fill="#9a9a9a" isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}

function FrozenRules({ summary }: { summary: NextSummaryBody }) {
  const trades = summary.ruleTrades;
  const label = (row: Row) => `${String(row.timeframe)} ${words(row.pattern)} — ${String(row.side)} · ${String(row.question)} · ${String(row.direction)} k=${String(row.candle)}`;
  const rows = [...new Set([...trades].sort((a, b) => Number(a.rule) - Number(b.rule)).map(label))];
  const values = trades.flatMap((row) => [num(row.net_mean_ticks_day_block_lower_95), num(row.net_mean_ticks_day_block_upper_95)]).filter((v): v is number => v !== null);
  const limit = Math.max(1, ...values.map(Math.abs));
  return (
    <Section title="10.5 · The rules frozen on 2021-2023, and what they did afterwards" question="Every screen survivor becomes a rule with its direction and k fixed from 2021-2023: net ticks per trade, one position at a time, with 95% trading-day intervals. A tradeable edge in 2025 needs a net mean above 1 tick with its lower bound above 0, at least 200 trades over 100 days, and a clear margin over fading the last candle and over trading any candle of the same size.">
      {summary.rules.length === 0 ? <Finding><b>No pattern side or shape code survived the 2021-2023 screen, so no rule was frozen.</b></Finding> : (
        <>
          <Legend items={Object.entries(SPLIT_STYLE).map(([key, style]) => ({ key, ...style }))} />
          <IntervalPlot rows={rows} series={["discovery", "validation", "holdout"]} domain={[-limit, limit]} labelWidth={260} rowHeight={40}
            xLabel="net ticks per trade, one position at a time" reference={{ value: 0, color: "#e5e5e5", dash: "0" }}
            items={trades.map((row): IntervalItem => ({
              row: label(row), series: String(row.split), value: num(row.net_mean_ticks), low: num(row.net_mean_ticks_day_block_lower_95),
              high: num(row.net_mean_ticks_day_block_upper_95), style: SPLIT_STYLE[String(row.split)] ?? SPLIT_STYLE.discovery!,
              tip: [label(row), SPLIT_STYLE[String(row.split)]?.label ?? "", `trades ${fmtInt(num(row.trade_count))} over ${fmtInt(num(row.trading_days))} days`,
                `gross ${fmt(num(row.gross_mean_ticks), 2)} · net ${fmt(num(row.net_mean_ticks), 2)} ticks`, `net at stress cost ${fmt(num(row.net_mean_ticks_at_stress_cost), 2)}`,
                `maximum drawdown ${fmt(num(row.maximum_drawdown_ticks), 0)} ticks`],
            }))} />
          <DataTable rows={summary.rules} pageSize={15} />
          <DataTable rows={trades} />
        </>
      )}
    </Section>
  );
}

function Grid({ controls, set, body }: TabProps & { body: NextPatternBody }) {
  const measure = controls.gridMeasure;
  const labelOf = (row: Row) => `${words(row.pattern)} — ${String(row.side)} (${String(row.direction)})`;
  const best = new Map<string, number>();
  for (const row of body.grid) {
    const value = num(row[measure]) ?? -Infinity;
    best.set(labelOf(row), Math.max(best.get(labelOf(row)) ?? -Infinity, value));
  }
  const order = [...best.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  const limit = Math.max(1e-6, ...body.grid.map((row) => Math.abs(num(row[measure]) ?? 0)));
  const cell = (label: string, candle: string) => body.grid.find((row) => labelOf(row) === label && String(row.candle) === candle);
  return (
    <Section title="10.6 · Every pattern side, every k, in ticks" question="Ticks per trade for every testable pattern side in the chosen timeframe and years, traded in its claimed direction (long where it claims none). Net is after the round-trip cost; beyond every bar is the pattern's gross move minus trading every bar the same way over the same k. Orange above zero, blue below. Descriptions, not tests: 10.4 and 10.5 are the tests.">
      <ControlBar>
        <SegmentControl label="Colour by" value={measure} options={[{ value: "net_mean_ticks", label: "net of costs" }, { value: "gross_minus_every_bar_ticks", label: "beyond every bar (gross)" }]} onChange={(v) => set("gridMeasure", v)} />
      </ControlBar>
      {order.length === 0 ? <Empty>No testable pattern side in this timeframe and family.</Empty> : (
        <MatrixHeatmap rows={order} columns={["1", "2", "3", "4", "5", "6"]} labelWidth={240} height={Math.max(200, 16 * order.length + 30)} xLabel="candle k"
          value={(label, candle) => num(cell(label, candle)?.[measure])} color={(v) => diverging(v, limit)} format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`}
          tip={(label, candle) => {
            const row = cell(label, candle);
            return row ? [label, `candle ${candle} · trades ${fmtInt(num(row.trades))} over ${fmtInt(num(row.trading_days))} days`,
              `gross ${fmt(num(row.gross_mean_ticks), 2)} · net ${fmt(num(row.net_mean_ticks), 2)} [${fmt(num(row.net_mean_ticks_lower_95), 2)}, ${fmt(num(row.net_mean_ticks_upper_95), 2)}]`,
              `every bar gross ${fmt(num(row.every_bar_gross_mean_ticks), 2)} · beyond it ${fmt(num(row.gross_minus_every_bar_ticks), 2)}`, `net hit rate ${fmt(num(row.hit_rate_net), 3)}`] : [label];
          }} />
      )}
    </Section>
  );
}

function Sizes({ summary, body, candle }: { summary: NextSummaryBody; body: NextPatternBody; candle: number }) {
  const labelOf = (row: Row) => `${words(row.pattern)} — ${String(row.side)}`;
  const range = [...body.rangeEffects].sort((a, b) => (num(b.difference_average_ranges) ?? 0) - (num(a.difference_average_ranges) ?? 0));
  const values = range.flatMap((row) => [num(row.difference_day_block_lower_95), num(row.difference_day_block_upper_95)]).filter((v): v is number => v !== null);
  const limit = Math.max(0.05, ...values.map(Math.abs));
  return (
    <Section title="10.7 · What the patterns do know: how big the next candles will be" question="The matched comparison applied to the range of candle k instead of its direction. Candle size clusters: a big candle tends to be followed by big candles, whichever way they go. Helps size stops and positions; it is not a direction.">
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {NEXT_TIMEFRAMES.map((timeframe) => {
          const rows = summary.baselineFit.filter((row) => row.timeframe === timeframe);
          const data = [1, 2, 3, 4, 5, 6].map((k) => ({
            candle: k,
            range: num(rows.find((row) => row.measure === "range" && Number(row.candle) === k)?.out_of_sample_r_squared),
            move: num(rows.find((row) => row.measure === "move" && Number(row.candle) === k)?.out_of_sample_r_squared),
          }));
          return (
            <div key={timeframe} className="min-w-0">
              <div className="text-[11px] text-neutral-300">{timeframe}</div>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="candle" {...AXIS} />
                  <YAxis {...AXIS} tickFormatter={(v: number) => fmt(v, 2)} />
                  <Tooltip {...TOOLTIP} formatter={(value, name) => [fmt(Number(value), 4), String(name)]} />
                  <Line dataKey="range" name="R squared, range (solid)" stroke={OKABE.orange} strokeWidth={2} isAnimationActive={false} />
                  <Line dataKey="move" name="R squared, move (dashed)" stroke={OKABE.blue} strokeDasharray="5 3" strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-400"><span style={{ color: OKABE.orange }}>— range of candle k</span> · <span style={{ color: OKABE.blue }}>- - move from the next open (direction)</span> · out-of-sample R squared (share of variance explained), 2024–2025</p>
      {range.length === 0 ? <Empty>No testable pattern side here.</Empty> : (
        <IntervalPlot rows={range.map(labelOf)} series={["range"]} domain={[-limit, limit]} labelWidth={200} rowHeight={16}
          xLabel={`candle ${candle} range minus bars like it, average ranges`} reference={{ value: 0, color: "#e5e5e5", dash: "0" }}
          items={range.map((row): IntervalItem => ({
            row: labelOf(row), series: "range", value: num(row.difference_average_ranges), low: num(row.difference_day_block_lower_95), high: num(row.difference_day_block_upper_95),
            style: { color: OKABE.vermillion, glyph: "diamond", label: "range" },
            tip: [labelOf(row), `firings ${fmtInt(num(row.firings))}`, `difference ${fmt(num(row.difference_average_ranges), 4)} [${fmt(num(row.difference_day_block_lower_95), 4)}, ${fmt(num(row.difference_day_block_upper_95), 4)}]`],
          }))} />
      )}
    </Section>
  );
}

function Detectable({ summary, split }: { summary: NextSummaryBody; split: string }) {
  const cost = num(summary.runInformation?.round_trip_cost_ticks) ?? 0;
  // One log axis for every timeframe (the notebook's facets share it), reaching a power of ten below the smallest median:
  // 1m medians are 0.4 to 1.2 ticks, so an axis that starts at 1 would hide them.
  const positive = summary.detectable.map((row) => num(row.median_ticks)).filter((v): v is number => v !== null && v > 0);
  const axisFloor = positive.length ? 10 ** Math.floor(Math.log10(Math.min(...positive, cost > 0 ? cost : Infinity))) : 1;
  return (
    <Section title="10.8 · What each test could have seen" question="A null result only means something if the test could detect an effect large enough to pay for a trade: the median smallest effect a pattern side's test could detect (80% power, after the family adjustment), in ticks, beside the round-trip cost. Bars above the dashed cost line mean an edge that pays could still hide in that cell.">
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {NEXT_TIMEFRAMES.map((timeframe) => {
          const data = summary.detectable.filter((row) => row.timeframe === timeframe).map((row) => ({
            candle: Number(row.candle), median: num(row.median_ticks), lower: num(row.lower_quartile), upper: num(row.upper_quartile), sides: num(row.pattern_sides),
          }));
          return (
            <div key={timeframe} className="min-w-0">
              <div className="text-[11px] text-neutral-300">{timeframe}</div>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="candle" {...AXIS} />
                  <YAxis scale="log" domain={[axisFloor, "auto"]} allowDataOverflow {...AXIS} tickFormatter={(v: number) => fmt(v, v < 1 ? 1 : 0)} />
                  <Tooltip {...TOOLTIP} content={({ payload }) => {
                    const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                    return p ? <div style={TOOLTIP.contentStyle} className="px-2 py-1 text-[11px]">candle {p.candle}: median {fmt(p.median, 1)} ticks [{fmt(p.lower, 1)}, {fmt(p.upper, 1)}] over {fmtInt(p.sides)} sides</div> : null;
                  }} />
                  <ReferenceLine y={cost} stroke="#e5e5e5" strokeDasharray="4 3" />
                  <Bar dataKey="median" fill={OKABE.blue} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-neutral-400"><span style={{ color: OKABE.blue }}>■ median smallest detectable effect</span> · dashed = round-trip cost {fmt(cost, 1)} ticks · years {SPLIT_LABEL[split] ?? split}</p>
    </Section>
  );
}

export function NextTab(props: TabProps) {
  const { controls, set } = props;
  const summaryQuery = useStudyQuery<NextSummaryBody>("candle-vectors", { section: "nextSummary", split: controls.split });
  const patternQuery = useStudyQuery<NextPatternBody>("candle-vectors", {
    section: "nextPattern", nextTimeframe: controls.nextTimeframe, family: controls.family, split: controls.split, candle: controls.candle,
    patternSide: controls.patternSide || undefined,
  });
  const summary = summaryQuery.data?.data;
  const body = patternQuery.data?.data;
  const chosen = body?.pattern ? `${body.pattern}|${body.side}` : "";
  const options = (body?.options ?? []).map((option) => ({
    value: `${option.pattern}|${option.side}`,
    label: `${words(option.pattern)} — ${option.side} (${fmtInt(option.firings)}${option.testable ? "" : ", too few to test"})`,
  }));
  const firingCount = num(body?.effects.find((row) => row.question === "unconditional" && Number(row.candle) === controls.candle && !String(row.measure).startsWith("jump"))?.firings);
  const direction = body?.side.includes("bearish") ? -1 : 1;
  return (
    <>
      <Section title="10 · Every pattern and every shape: what the next 1 to 6 candles do" question="Every candle is measured from the pattern's close in units of the pattern bar's average range. A horizon stops where the next candle opens more than two candles' length after the one before (the 17:00-18:00 Eastern halt at 1-15 minutes, weekends and holidays everywhere) and at a contract change.">
        <FormulaCard
          tex={"\\Delta_k=\\frac{1}{N}\\sum_{i=1}^{N}\\left(y_{i,k}-b_{i,k}\\right),\\qquad \\text{net}_i=d\\,\\frac{C_{t_i+k}-O_{t_i+1}}{0.25}-c"}
          caption="A · against every bar: does what follows the pattern differ from what follows any bar? B · against bars like it: from bars with the same last two candles, gap, volatility, time of day and weekday (a gradient-boosted model fitted on 2021-2023, frozen before 2024 and 2025 are opened). Passing A and failing B is a candle-size or candle-colour effect, not the pattern."
          symbols={[
            { tex: "i", name: "one firing of the pattern", value: "1 … N" },
            { tex: "N", name: "firings in the chosen years whose pattern candles sit in one session stretch", value: fmtInt(firingCount) },
            { tex: "k", name: "how many candles after the pattern", value: String(controls.candle) },
            { tex: "y_{i,k}", name: "close of candle k minus the next candle's open: what a trade entered at that open earns", value: "average ranges" },
            { tex: "b_{i,k}", name: "the baseline: every bar's mean (A) or the matched model's expectation for this bar (B)", value: "average ranges" },
            { tex: "\\Delta_k", name: "the effect: how far the pattern's next candles sit from the baseline", value: "average ranges (10.1)" },
            { tex: "d", name: "trade direction: +1 long, −1 short", value: direction > 0 ? "+1 (long)" : "−1 (short)" },
            { tex: "O_{t_i+1},\\ C_{t_i+k}", name: "the next candle's open (entry) and candle k's close (exit)", value: "index points" },
            { tex: "0.25", name: "one MNQ tick", value: "points" },
            { tex: "c", name: "round-trip cost from the repo's cost model", value: `${fmt(num(summary?.runInformation?.round_trip_cost_ticks), 2)} ticks` },
          ]}
        />
        <Finding>
          The test is fixed before the answer is seen. 2021-2023 screens every pattern side that fires often enough; for each side the single statistic is the largest
          day-clustered |t| over k = 1…6, adjusted with Benjamini-Yekutieli. Each survivor's direction and k are frozen and tested once on 2024 (Holm); only rules that pass 2024 run
          on 2025. Shape-code vocabularies must first show, inside 2021-2023, that their code means from 2021-2022 predict 2023. The same screen also runs on firings moved by whole
          trading days, which shows how many survivors chance alone produces. Everything is tested on the move a trade can earn, from the next candle's open: the jump from the close
          to that open is shown but never tested (at 1 minute it is mostly the bid-ask bounce).
        </Finding>
        <StudyState isLoading={summaryQuery.isLoading} error={summaryQuery.error}>
          <StudyNotes notes={summaryQuery.data?.notes ?? []} />
          {summary?.landed ? <Headline summary={summary} /> : <Empty>The next-candle results are not in the lake.</Empty>}
        </StudyState>
      </Section>

      <ControlBar>
        <SegmentControl label="Timeframe" value={controls.nextTimeframe} options={NEXT_TIMEFRAMES.map((v) => ({ value: v, label: v }))} onChange={(v) => { set("nextTimeframe", v); set("patternSide", ""); }} />
        <SelectControl label="Family" value={controls.family} options={NEXT_FAMILIES.map((v) => ({ value: v, label: v }))} onChange={(v) => { set("family", v); set("patternSide", ""); }} />
        <SegmentControl label="Years" value={controls.split} options={Object.entries(SPLIT_LABEL).map(([value, label]) => ({ value, label }))} onChange={(v) => set("split", v)} />
        <SliderControl label="Candle k" value={controls.candle} min={1} max={6} onChange={(v) => set("candle", v)} />
        {options.length > 0 && chosen && (
          <SelectControl label="Pattern side" value={chosen} options={options} onChange={(v) => set("patternSide", v)} />
        )}
      </ControlBar>

      <StudyState isLoading={patternQuery.isLoading} error={patternQuery.error}>
        <StudyNotes notes={patternQuery.data?.notes ?? []} />
        {!body?.landed ? <Empty>The next-candle results are not in the lake.</Empty> : (
          <>
            <Section title="10.1 · The pattern and its next six candles, beside every bar" question="Solid candles left of 0 are the pattern's own candles on average; solid to the right are the six that followed. Below: the tested effect Δk.">
              {body.averageCandles.length === 0 ? <Empty>Fewer than 30 analysable firings in these years.</Empty> : <AverageCandles body={body} candle={controls.candle} />}
            </Section>
            <Section title="10.2 · Up, down or flat: each next candle, beside every bar" question="The share of each next candle that closed above its open, below it, or level with it; whiskers are 95% Wilson intervals. At 1 minute many candles close level with their open.">
              {body.shares.length === 0 ? <Empty>Fewer than 30 analysable firings in these years.</Empty> : <Shares body={body} />}
            </Section>
          </>
        )}
      </StudyState>
      <Trades {...props} patternSide={chosen} />
      {summary?.landed && <ScreenAndPlacebo summary={summary} />}
      {summary?.landed && <FrozenRules summary={summary} />}
      {body?.landed && <Grid {...props} body={body} />}
      {summary?.landed && body?.landed && <Sizes summary={summary} body={body} candle={controls.candle} />}
      {summary?.landed && <Detectable summary={summary} split={controls.split} />}
      {summary?.landed && <ColumnGrid rows={summary.screen} title="Every column of the 2021-2023 screen" />}
    </>
  );
}
