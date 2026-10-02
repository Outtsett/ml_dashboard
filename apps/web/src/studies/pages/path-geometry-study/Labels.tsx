/**
 * Section 5: direction labels lined up with the actual data. A label is a
 * statement about the future stamped onto a bar in the past; this section
 * checks it is stamped on the right bar, by eye (rows, price and arrows,
 * candles) and exhaustively (every labelled bar, plus a negative control that
 * must fail). The counts come from SQL over all bars in view; the slice shown
 * in the tables and charts is fetched from the same bars and labelled here with
 * the same rule (forwardLabels), so what is drawn is what the counts describe.
 */

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { wilson } from "@shared/analytics/compute";
import {
  AXIS, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, Stat, SwitchControl, TOOLTIP,
  fmt, fmtInt, fmtPercent, fmtTime,
} from "@/studies/kit";
import {
  DELTA_BINS, DELTA_LIMIT, candleAgreement, forwardLabels, mergeBins,
  type PathGeometryBody,
} from "@shared/studies/path-geometry-study";
import type { Controls, Setter } from "./controls";
import { CandleArrowsChart, PriceArrowsChart } from "./charts";

function CheckRow({ passed, title, detail }: { passed: boolean; title: string; detail: string }) {
  return (
    <div className="flex gap-2 rounded border border-neutral-800 bg-neutral-900/40 px-2 py-1.5 text-[11px]">
      <span className="w-14 shrink-0 font-mono font-semibold" style={{ color: passed ? OKABE.orange : OKABE.blue }}>{passed ? "✓ PASS" : "✗ FAIL"}</span>
      <span className="min-w-0 text-neutral-300"><span className="text-neutral-100">{title}</span> {detail}</span>
    </div>
  );
}

function labelText(label: 0 | 1 | null): string {
  return label === null ? "none" : label === 1 ? "1 ▲ up" : "0 ▼ down";
}

export function Labels({ body, controls, set }: { body: PathGeometryBody; controls: Controls; set: Setter }) {
  const [probe, setProbe] = useState(0);
  const [arrowEvery, setArrowEvery] = useState(60);
  const [candleStart, setCandleStart] = useState(0);
  const [deltaMerge, setDeltaMerge] = useState(1);
  const [logCounts, setLogCounts] = useState(false);
  const { slice, labels: summary, hourRates, deltaCounts, lakeLabelCheck } = body;
  const horizon = controls.horizon;

  if (!slice || !summary || slice.rows.length < 2) {
    return (
      <Section title="5 · Direction labels, lined up with the actual data">
        <Empty>No bars to label. The bar view mnq_ohlcv_1m is not served.</Empty>
      </Section>
    );
  }

  const times = slice.rows.map((row) => row[0]);
  const opens = slice.rows.map((row) => row[1]);
  const highs = slice.rows.map((row) => row[2]);
  const lows = slice.rows.map((row) => row[3]);
  const closes = slice.rows.map((row) => row[4]);
  const long = forwardLabels(closes, horizon, controls.flatThreshold);
  const short = forwardLabels(closes, controls.showHorizon, controls.flatThreshold);
  const segmentCount = Math.min(controls.segmentBars, closes.length);

  const probeIndex = Math.min(probe, Math.max(0, segmentCount - 1));
  const probeLabel = long.labels[probeIndex] ?? null;
  const probeAhead = closes[probeIndex + horizon];
  const tableRows = Array.from({ length: 12 }, (_, offset) => probeIndex + offset).filter((index) => index < closes.length);
  const tableAgrees = tableRows.every((index) => {
    const ahead = closes[index + horizon];
    const label = long.labels[index];
    return ahead === undefined || label === null || label === undefined || (ahead > (closes[index] as number)) === (label === 1);
  });

  const candleMax = Math.max(0, closes.length - controls.showBars);
  const windowStart = Math.min(candleStart, candleMax);
  const windowRange = { from: windowStart, to: windowStart + controls.showBars };
  const windowOpens = opens.slice(windowRange.from, windowRange.to);
  const windowCloses = closes.slice(windowRange.from, windowRange.to);
  const windowLabels = short.labels.slice(windowRange.from, windowRange.to);
  const onScreen = candleAgreement(windowOpens, windowCloses, windowLabels);
  const tableCandles = Array.from({ length: 15 }, (_, offset) => windowRange.from + offset).filter((index) => index < closes.length && short.labels[index] !== null && short.labels[index] !== undefined);

  const labelledCount = summary.upCount + summary.downCount;
  const upRate = wilson(summary.upCount, labelledCount);
  const hourData = hourRates
    .filter((row) => row.count > 0)
    .map((row) => {
      const interval = wilson(row.upCount, row.count);
      const rate = interval.value ?? 0.5;
      return {
        hour: row.hour,
        rate,
        range: [Math.min(0.5, rate), Math.max(0.5, rate)] as [number, number],
        whisker: [rate - (interval.low ?? rate), (interval.high ?? rate) - rate] as [number, number],
        count: row.count,
        above: rate >= 0.5,
      };
    });
  const deltaWidth = ((2 * DELTA_LIMIT) / DELTA_BINS) * deltaMerge;
  const deltaData = mergeBins(deltaCounts, deltaMerge).map((count, index) => ({
    middle: -DELTA_LIMIT + (index + 0.5) * deltaWidth,
    lower: -DELTA_LIMIT + index * deltaWidth,
    upper: -DELTA_LIMIT + (index + 1) * deltaWidth,
    count,
    shown: logCounts ? Math.log10(count + 1) : count,
  }));

  const aligned = summary.alignmentMismatches === 0 && summary.alignmentChecked > 0;
  const tailClean = summary.tailLabelledCount === 0;
  const controlFires = summary.offByOneMismatches > 0;
  const landedClean = lakeLabelCheck ? lakeLabelCheck.signDisagreements === 0 && lakeLabelCheck.directionalChecked > 0 : null;
  const allPass = aligned && tailClean && controlFires && landedClean !== false;

  return (
    <>
      <Section
        title="5 · Direction labels, lined up with the actual data"
        question="Everything above forecasts geometry. This asks whether the label every supervised run rests on is attached to the right bar: get it off by one and nothing crashes and the model is quietly asked a different question."
      >
        <ControlBar>
          <SliderControl label="Horizon H (bars)" value={controls.horizon} min={1} max={240} onChange={(value) => set("horizon", value)} hint="How many bars ahead the label looks; the notebook uses 60" />
          <SliderControl label="Flat threshold (points)" value={controls.flatThreshold} min={0} max={20} step={0.25} onChange={(value) => set("flatThreshold", value)} format={(value) => value.toFixed(2)} hint="Drop labels whose move is smaller than this; 0 uses every bar" />
          <SliderControl label="Where in the bars" value={controls.position} min={0} max={0.95} step={0.05} onChange={(value) => set("position", value)} format={(value) => `${Math.round(value * 100)}%`} hint="The slice inspected below starts this far into the bars in view" />
        </ControlBar>
        <div className="mt-2">
          <FormulaCard
            tex={"y_t=\\mathbb{1}\\!\\left[\\,\\mathrm{close}_{t+H}>\\mathrm{close}_{t}\\,\\right]"}
            caption={`Bar ${slice.startIndex + probeIndex} of the bars in view: the label is 1 exactly when the right-hand close is higher than the left-hand one. Move the row scrubber in 5.1 to read another bar.`}
            symbols={[
              { tex: "y_t", name: "the direction label stamped on bar t", value: labelText(probeLabel) },
              { tex: "t", name: "index of the bar within the bars in view", value: fmtInt(slice.startIndex + probeIndex) },
              { tex: "H", name: "bars ahead the label looks", value: String(horizon) },
              { tex: "\\mathrm{close}_{t}", name: "close of bar t", value: fmt(closes[probeIndex], 2) },
              { tex: "\\mathrm{close}_{t+H}", name: "close H bars later", value: fmt(probeAhead, 2) },
              { tex: "\\mathbb{1}[\\cdot]", name: "indicator: 1 when the statement inside is true, else 0", value: probeAhead === undefined ? "—" : probeAhead > (closes[probeIndex] as number) ? "true" : "false" },
            ]}
          />
        </div>
        <div className="mt-2 grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label="Bars" value={fmtInt(summary.barCount)} />
          <Stat label={`Labelled (last ${horizon} are NaN)`} value={fmtInt(summary.finiteCount)} hint={`${fmtInt(summary.barCount - summary.finiteCount)} bars have no future to look at`} />
          <Stat label="Up-rate" value={fmt(upRate.value, 4)} hint={`Wilson 95% [${fmt(upRate.low, 4)}, ${fmt(upRate.high, 4)}] on ${fmtInt(labelledCount)} labels`} tone={OKABE.orange} />
          <Stat label="Left out as flat" value={fmtInt(summary.flatCount)} hint={`|move| below ${controls.flatThreshold} points`} />
        </div>
      </Section>

      <Section title="5.1 · Read the rows yourself" question="close[t], close[t+H], the difference and the label on one line: check any row by hand.">
        <label className="flex w-72 flex-col gap-1">
          <span className="flex justify-between text-[10px] uppercase tracking-wider text-neutral-500"><span>First row</span><span className="font-mono normal-case text-neutral-200">bar {slice.startIndex + probeIndex}</span></span>
          <input type="range" min={0} max={Math.max(0, segmentCount - 1)} value={probeIndex} onChange={(event) => setProbe(Number(event.target.value))} className="h-4 w-full accent-[#56B4E9]" />
        </label>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[11px] font-mono tnum">
            <thead>
              <tr className="text-neutral-500">
                {["t", "timestamp[t]", "close[t]", "timestamp[t+H]", "close[t+H]", "delta (pts)", "label", "close[t+H] > close[t]"].map((heading) => (
                  <th key={heading} className="py-0.5 pr-3 text-right font-normal first:text-left">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((index) => {
                const ahead = closes[index + horizon];
                const label = long.labels[index] ?? null;
                return (
                  <tr key={index} className={`border-t border-neutral-900 ${index === probeIndex ? "bg-neutral-800/50" : ""}`}>
                    <td className="py-0.5 pr-3 text-left text-neutral-200">{slice.startIndex + index}</td>
                    <td className="py-0.5 pr-3 text-right">{fmtTime(times[index])}</td>
                    <td className="py-0.5 pr-3 text-right">{fmt(closes[index], 2)}</td>
                    <td className="py-0.5 pr-3 text-right">{times[index + horizon] === undefined ? "—" : fmtTime(times[index + horizon])}</td>
                    <td className="py-0.5 pr-3 text-right">{ahead === undefined ? "—" : fmt(ahead, 2)}</td>
                    <td className="py-0.5 pr-3 text-right">{fmt(long.delta[index] ?? null, 2)}</td>
                    <td className="py-0.5 pr-3 text-right text-neutral-100">{labelText(label)}</td>
                    <td className="py-0.5 pr-3 text-right">{ahead === undefined ? "—" : ahead > (closes[index] as number) ? "true" : "false"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Finding>Label matches the raw close comparison on every row shown: {tableAgrees ? "yes" : "no"}.</Finding>
      </Section>

      <Section title="5.2 · The same thing, on the chart" question="Each labelled bar t is marked with the direction its label claims (▲ orange up, ▼ blue down). Arrows run from close[t] to close[t+H], the reach the label describes; the strip underneath is the label itself.">
        <ControlBar>
          <SliderControl label="Bars in the chart" value={controls.segmentBars} min={100} max={1000} step={50} onChange={(value) => set("segmentBars", value)} />
          <SliderControl label="Arrow every (bars)" value={arrowEvery} min={10} max={120} step={10} onChange={setArrowEvery} />
        </ControlBar>
        <div className="mt-2">
          <PriceArrowsChart times={times} closes={closes} labels={long.labels} deltas={long.delta} count={segmentCount} horizon={horizon} arrowEvery={arrowEvery} />
        </div>
        <Finding>
          {segmentCount} bars from bar {fmtInt(slice.startIndex)}. Hover a bar to see its label beside the bar H = {horizon} later (purple guide): the marker on the left must match the direction of travel on the right.
          {horizon >= segmentCount && " The horizon is longer than the chart, so no arrow can be drawn."}
        </Finding>
      </Section>

      <Section title="5.2b · Candlesticks, one arrow per candle" question="The candle colour describes what this bar did (close vs open, already happened); the arrow above it is what the label claims about bar t+H (has not happened yet). They disagree constantly, and they are supposed to.">
        <ControlBar>
          <SliderControl label="Arrow horizon (bars)" value={controls.showHorizon} min={1} max={60} onChange={(value) => set("showHorizon", value)} hint="Kept small so the bar each arrow refers to is on screen" />
          <SliderControl label="Candles" value={controls.showBars} min={20} max={120} onChange={(value) => set("showBars", value)} />
          <SliderControl label="Start" value={windowStart} min={0} max={candleMax} onChange={setCandleStart} format={(value) => `bar ${slice.startIndex + value}`} />
        </ControlBar>
        <p className="mt-1 text-[11px] text-neutral-400">
          <span style={{ color: OKABE.orange }}>■ candle up (close ≥ open), ▲ label 1: close[t+{controls.showHorizon}] higher</span> ·{" "}
          <span style={{ color: OKABE.blue }}>□ candle down, ▼ label 0: close[t+{controls.showHorizon}] lower</span>. Hover a candle: the bar it refers to is shaded purple.
        </p>
        <div className="mt-1">
          <CandleArrowsChart
            times={times.slice(windowRange.from, windowRange.to)}
            opens={windowOpens}
            highs={highs.slice(windowRange.from, windowRange.to)}
            lows={lows.slice(windowRange.from, windowRange.to)}
            closes={windowCloses}
            labels={windowLabels}
            horizon={controls.showHorizon}
          />
        </div>
        <p className="mb-1 mt-3 text-[11px] font-medium text-neutral-300">Verify one arrow by eye, then all of them</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono tnum">
            <thead>
              <tr className="text-neutral-500">
                {["bar", "time", "open", "close", "candle", `close[t+${controls.showHorizon}]`, "arrow (label)", "agrees with candle"].map((heading) => (
                  <th key={heading} className="py-0.5 pr-3 text-right font-normal first:text-left">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableCandles.map((index) => {
                const candleUp = (closes[index] as number) >= (opens[index] as number);
                const arrowUp = short.labels[index] === 1;
                return (
                  <tr key={index} className="border-t border-neutral-900">
                    <td className="py-0.5 pr-3 text-left text-neutral-200">{index - windowRange.from}</td>
                    <td className="py-0.5 pr-3 text-right">{fmtTime(times[index]).slice(11)}</td>
                    <td className="py-0.5 pr-3 text-right">{fmt(opens[index], 2)}</td>
                    <td className="py-0.5 pr-3 text-right">{fmt(closes[index], 2)}</td>
                    <td className="py-0.5 pr-3 text-right">{candleUp ? "up ■" : "down □"}</td>
                    <td className="py-0.5 pr-3 text-right">{fmt(closes[index + controls.showHorizon], 2)}</td>
                    <td className="py-0.5 pr-3 text-right text-neutral-100">{arrowUp ? "up ▲" : "down ▼"}</td>
                    <td className="py-0.5 pr-3 text-right">{candleUp === arrowUp ? "yes" : "no"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Finding>
          On screen the arrow agrees with the candle colour on {fmtPercent(onScreen.checked > 0 ? onScreen.agreeing / onScreen.checked : null)} of {onScreen.checked} candles; over the whole sample ({fmtInt(summary.agreementChecked)} labelled bars at H = {summary.showHorizon}) agreement is {fmtPercent(summary.agreementChecked > 0 ? summary.agreementCount / summary.agreementChecked : null)}. If they were the same thing agreement would be 100%: the candle is the present, the arrow is the future.
        </Finding>
      </Section>

      <Section title="5.3 · Alignment checked on every labelled bar, not a sample" question="The chart is persuasive; it is not proof. Every label is re-derived a second way and counted, and the same assertion applied to a label wrong by one bar must fire, or its passing proves nothing.">
        <div className="space-y-1.5">
          <CheckRow
            passed={aligned}
            title="Every labelled bar, re-derived by joining on position (bar t to bar t+H):"
            detail={`${fmtInt(summary.alignmentChecked)} bars checked, ${fmtInt(summary.alignmentMismatches)} mismatches.`}
          />
          <CheckRow
            passed={tailClean}
            title={`The last ${horizon} bars are unlabelled (the shift did not wrap the end of the series onto its beginning):`}
            detail={`${fmtInt(summary.tailLabelledCount)} of them carry a label.`}
          />
          <CheckRow
            passed={controlFires}
            title="Negative control, the same check against a label shifted one bar further:"
            detail={`${fmtInt(summary.offByOneMismatches)} mismatches in ${fmtInt(summary.offByOneChecked)} bars (${fmtPercent(summary.offByOneChecked > 0 ? summary.offByOneMismatches / summary.offByOneChecked : null, 2)}), so the check can fail.`}
          />
          {lakeLabelCheck && (
            <CheckRow
              passed={landedClean === true}
              title={`The landed label set ${lakeLabelCheck.recipe} (${lakeLabelCheck.horizon} bars ahead, from /labels):`}
              detail={`${fmtInt(lakeLabelCheck.directionalChecked)} directional labels, ${fmtInt(lakeLabelCheck.signDisagreements)} disagree in sign with close[t+${lakeLabelCheck.horizon}] − close[t] recomputed from these bars.`}
            />
          )}
        </div>
        <Finding>
          {allPass
            ? "PASS: labels align exactly, and the check is proven able to fail. Zero mismatches only means something because the identical assertion does fire on a label that is wrong by one bar."
            : "FAIL: at least one check above did not hold; do not train on this label until it does."}
        </Finding>
      </Section>

      <Section title="5.4 · What the labels look like in aggregate" question="Up-rate by hour of day, and the distribution of the forward move the label is built from.">
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-medium text-neutral-300">P(close[t+{horizon}] &gt; close[t]) by hour (wall-clock hour as stamped; bars run from 0.5 to the hour's rate; dashed white is 0.5, vermillion is the sample rate)</p>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={hourData} margin={{ top: 6, right: 10, left: 0, bottom: 14 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="hour" {...AXIS} label={{ value: "hour of day (as stamped)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis domain={[0.44, 0.6]} allowDataOverflow {...AXIS} width={44} tickFormatter={(value: number) => fmt(value, 2)} />
                <Tooltip
                  {...TOOLTIP}
                  content={({ payload }) => {
                    const row = payload?.[0]?.payload as (typeof hourData)[number] | undefined;
                    if (!row) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                        <div className="font-semibold">hour {row.hour}</div>
                        <div>up-rate {fmt(row.rate, 4)} {row.above ? "▲ above" : "▼ below"} a coin flip</div>
                        <div>{fmtInt(row.count)} labelled bars, Wilson 95% [{fmt(row.rate - row.whisker[0], 4)}, {fmt(row.rate + row.whisker[1], 4)}]</div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={0.5} stroke="#d4d4d4" strokeDasharray="6 3" />
                <ReferenceLine y={upRate.value ?? 0.5} stroke={OKABE.vermillion} />
                <Bar dataKey="range" isAnimationActive={false}>
                  {hourData.map((row) => (
                    <Cell key={row.hour} fill={row.above ? OKABE.orange : OKABE.blue} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-medium text-neutral-300">close[t+{horizon}] − close[t] in points, clipped to ±{DELTA_LIMIT}</p>
            <ControlBar>
              <SegmentControl label="Bins" value={deltaMerge} options={[1, 2, 4, 5, 10].map((value) => ({ value, label: String(DELTA_BINS / value) }))} onChange={setDeltaMerge} />
              <SwitchControl label="Log counts" checked={logCounts} onChange={setLogCounts} />
            </ControlBar>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={deltaData} margin={{ top: 6, right: 10, left: 0, bottom: 14 }} barCategoryGap={0}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis type="number" dataKey="middle" domain={[-DELTA_LIMIT, DELTA_LIMIT]} {...AXIS} label={{ value: `close[t+${horizon}] − close[t] (points)`, position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis {...AXIS} width={44} />
                <Tooltip
                  {...TOOLTIP}
                  formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "bars"]}
                  labelFormatter={(_label, payload) => {
                    const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                    return bin ? `${fmt(bin.lower, 1)} to ${fmt(bin.upper, 1)} pts` : "";
                  }}
                />
                <ReferenceLine x={0} stroke="#d4d4d4" strokeDasharray="6 3" />
                <Bar dataKey="shown" isAnimationActive={false}>
                  {deltaData.map((row) => (
                    <Cell key={row.middle} fill={row.middle < 0 ? OKABE.blue : OKABE.orange} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <Finding>Median |move| over {horizon} bars: {fmt(summary.medianAbsoluteMove, 2)} points. Orange to the right of zero is label 1, blue to the left is label 0.</Finding>
          </div>
        </div>
        <Finding>
          Takeaway: build a supervised target once, with the project&apos;s labeller, and run this alignment block (including the negative control) on it, rather than writing a fresh shift(−H) each time. The comparison is one vectorised pass and the only thing between a correct target and a silently shifted one.
        </Finding>
      </Section>
    </>
  );
}
