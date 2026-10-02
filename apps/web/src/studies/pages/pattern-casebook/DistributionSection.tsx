/**
 * Section 2: every trade of the selected pattern side in dollars beside every
 * bar of the year traded the same way, and the running dollars through the
 * year against random sets of as many bars. An edge climbs out of the grey.
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, GRID, OKABE, Section, SegmentControl, SliderControl, Stat, StudyNotes, StudyState, SummaryTable, TOOLTIP,
  fmt, fmtInt, fmtPercent, useStudyQuery,
} from "@/studies/kit";
import type { DistributionBody } from "@shared/studies/pattern-casebook";
import { splitPatternSide, type Controls, type SetControl } from "./controls";
import { signedDollars } from "./format";

export function DistributionSection({ controls, set, patternSide, cost }: { controls: Controls; set: SetControl; patternSide: string; cost: number | undefined }) {
  const { pattern, side } = splitPatternSide(patternSide);
  const query = useStudyQuery<DistributionBody | null>("pattern-casebook", {
    part: "distribution", timeframe: controls.timeframe, year: controls.year, candle: controls.candle, pattern, side, cost,
    view: controls.view, span: controls.span, lines: controls.lines,
  });
  const body = query.data?.data ?? null;
  const word = controls.view === "gross" ? "gross" : "net";
  const stats = body?.stats ?? null;
  const allLines = body ? [...body.randomLines.flatMap((line) => line.points), ...body.patternLine] : [];
  const times = allLines.map((point) => point.bar_timestamp_milliseconds);
  const escaped = stats && body?.band ? (stats.wholeYear > body.band.high ? "above" : stats.wholeYear < body.band.low ? "below" : "inside") : null;

  return (
    <Section
      title="2 · All of them, in dollars, beside random bars"
      question="Left: every trade's dollars (orange, solid) against every bar of the year traded the same way (grey, dashed). Right: running dollars through the year, one contract per firing, positions allowed to overlap; each thin grey line is as many random bars."
    >
      <ControlBar>
        <SegmentControl label="Dollars" value={controls.view} options={[{ value: "net", label: "after the round trip" }, { value: "gross", label: "before costs" }]} onChange={(value) => set("view", value)} />
        <SliderControl label="Histogram spans the middle % of trades" value={controls.span} min={90} max={100} step={0.5} onChange={(value) => set("span", value)} format={(value) => `${value.toFixed(1)}%`} />
        <SliderControl label="Random-bar lines" value={controls.lines} min={5} max={60} step={5} onChange={(value) => set("lines", value)} />
      </ControlBar>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {body && !body.available && <p className="mt-2 text-xs text-neutral-400">{body.message}</p>}
        {body?.available && stats && (
          <div className="mt-2 space-y-3">
            <div className="grid min-w-0 grid-cols-2 gap-2 xl:grid-cols-5">
              <Stat label="Trades" value={fmtInt(stats.tradeCount)} hint={`on ${fmtInt(stats.tradingDaysWithATrade)} days`} />
              <Stat label={`Made money ${word === "gross" ? "before" : "after"} costs`} value={fmtPercent(stats.shareMadeMoney)} tone={stats.shareMadeMoney > 0.5 ? OKABE.orange : OKABE.blue} />
              <Stat label={`${word} per trade, mean`} value={signedDollars(stats.meanPerTrade)} tone={stats.meanPerTrade > 0 ? OKABE.orange : OKABE.blue} hint={`median ${signedDollars(stats.medianPerTrade)}; every bar the same way ${signedDollars(stats.everyBarPerTrade)}`} />
              <Stat label={`Whole year, ${word}`} value={signedDollars(stats.wholeYear, 0)} tone={stats.wholeYear > 0 ? OKABE.orange : OKABE.blue} hint={`${signedDollars(stats.perSession, 0)} per session; round trips cost ${signedDollars(stats.roundTripsCost, 0)}`} />
              <Stat label="Random bars, same count (5th–95th pct)" value={`${signedDollars(stats.randomLow, 0)} to ${signedDollars(stats.randomHigh, 0)}`} hint={`${fmtPercent(stats.shareOfRandomTotalsAtOrAbovePattern, 0)} of random totals beat the pattern · ${stats.randomBandMethod}`} />
            </div>
            <Finding>
              Median {signedDollars(stats.medianPerTrade)} per trade; every bar traded the same way makes {signedDollars(stats.everyBarPerTrade)}. The year's{" "}
              {signedDollars(stats.wholeYear, 0)} sits <strong>{escaped}</strong> the random bars' 5th–95th percentile, and{" "}
              {fmtPercent(stats.shareOfRandomTotalsAtOrAbovePattern, 0)} of random totals did at least as well. Round trips alone cost {signedDollars(stats.roundTripsCost, 0)}.
            </Finding>
            <div className="grid min-w-0 gap-3 xl:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[11px] text-neutral-400">
                  {word} dollars per trade · <span style={{ color: OKABE.orange }}>━ the pattern's trades</span> · <span style={{ color: OKABE.grey }}>╌ every bar, same way</span>
                </p>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={body.histogram} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis type="number" dataKey="net_dollars" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmt(value, 1)} {...AXIS} />
                    <YAxis {...AXIS} width={44} tickFormatter={(value: number) => fmt(value, 3)} />
                    <Tooltip {...TOOLTIP} labelFormatter={(value) => `${word} dollars ${signedDollars(Number(value))}`} formatter={(value, name) => [fmt(Number(value), 4), name === "pattern_share_of_trades" ? "share of the pattern's trades" : "share of every bar"]} />
                    <ReferenceLine x={0} stroke="#e5e5e5" strokeDasharray="4 3" />
                    <Line type="stepAfter" dataKey="pattern_share_of_trades" stroke={OKABE.orange} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="every_bar_share_of_trades" stroke={OKABE.grey} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-neutral-400">
                  running {word} dollars · <span style={{ color: OKABE.orange }}>━ the pattern</span> · <span style={{ color: OKABE.grey }}>─ {body.randomLines.length} random draws</span> · ▮ random bars' 5th–95th percentile of the year's total
                </p>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis type="number" dataKey="bar_timestamp_milliseconds" domain={[Math.min(...times), Math.max(...times)]} tickFormatter={(value: number) => new Date(value).toISOString().slice(0, 7)} {...AXIS} />
                    <YAxis type="number" dataKey="running_dollars" {...AXIS} width={56} tickFormatter={(value: number) => fmt(value, 0)} />
                    <Tooltip {...TOOLTIP} labelFormatter={(value) => new Date(Number(value)).toISOString().slice(0, 16).replace("T", " ")} formatter={(value) => [signedDollars(Number(value), 0), "running dollars"]} />
                    <ReferenceLine y={0} stroke="#525252" />
                    {body.randomLines.map((line) => (
                      <Line key={line.draw} data={line.points} dataKey="running_dollars" stroke={OKABE.grey} strokeWidth={0.7} strokeOpacity={0.5} dot={false} isAnimationActive={false} activeDot={false} name={`random draw ${line.draw}`} />
                    ))}
                    <Line data={body.patternLine} dataKey="running_dollars" stroke={OKABE.orange} strokeWidth={2.6} dot={false} isAnimationActive={false} name="the pattern" />
                    {body.band && (
                      <ReferenceLine
                        segment={[{ x: body.band.bar_timestamp_milliseconds, y: body.band.low }, { x: body.band.bar_timestamp_milliseconds, y: body.band.high }]}
                        stroke="#e5e5e5"
                        strokeOpacity={0.45}
                        strokeWidth={8}
                        ifOverflow="extendDomain"
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            {body.pattern && body.everyBar && (
              <div className="min-w-0 overflow-x-auto">
                <p className="text-[11px] text-neutral-400">The eight numbers of {word} dollars per trade (numpy / scipy conventions, as the notebook)</p>
                <SummaryTable columns={[{ name: "the pattern's trades", summary: body.pattern, decimals: 2 }, { name: "every bar, same way", summary: body.everyBar, decimals: 2 }]} />
                <table className="mt-1 w-full font-mono text-[11px] tnum">
                  <tbody>
                    <tr className="border-t border-neutral-900">
                      <td className="py-0.5 text-neutral-400">share positive</td>
                      <td className="py-0.5 text-right text-neutral-200">{fmtPercent(body.pattern.shareNetPositive, 2)}</td>
                      <td className="py-0.5 text-right text-neutral-200">{fmtPercent(body.everyBar.shareNetPositive, 2)}</td>
                    </tr>
                    <tr className="border-t border-neutral-900">
                      <td className="py-0.5 text-neutral-400">total</td>
                      <td className="py-0.5 text-right text-neutral-200">{signedDollars(body.pattern.total, 2)}</td>
                      <td className="py-0.5 text-right text-neutral-200">{signedDollars(body.everyBar.total, 2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </StudyState>
    </Section>
  );
}
