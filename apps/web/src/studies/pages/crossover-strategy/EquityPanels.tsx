/**
 * Panels 2 and 3 of the notebook (compounded net equity, drawdown) on Recharts,
 * plus the months and the deepest stretches below a high that the notebook's
 * prose talked about ("this level WILL recur") without showing.
 *
 * Orange is up / positive, blue is down / negative, always with a label or
 * shape as well. Times are the lake's stamps (Pacific wall clock stored as UTC).
 */

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, GRID, OKABE, TOOLTIP, fmt, fmtInt, fmtPercent, fmtTime } from "@/studies/kit";
import type { DrawdownEpisode, MonthlyReturn, SummaryBlock, ThinnedSeries } from "@shared/studies/crossover-strategy";

function dateLabel(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function monthTick(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 7);
}

export function EquityChart({
  series, splitSeconds, showGross, showBuyAndHold, height = 340,
}: { series: ThinnedSeries; splitSeconds: number; showGross: boolean; showBuyAndHold: boolean; height?: number }) {
  const data = series.timestampSeconds.map((seconds, i) => ({
    at: seconds * 1000,
    equity: series.equity[i] as number,
    gross: series.grossEquity[i] as number,
    hold: series.buyAndHoldEquity[i] as number,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="at" type="number" domain={["dataMin", "dataMax"]} tickFormatter={monthTick} tick={AXIS} minTickGap={48} />
        <YAxis tick={AXIS} domain={["auto", "auto"]} tickFormatter={(value: number) => fmt(value, 2)} width={52} label={{ value: "equity, start 1.00", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10, offset: 8 }} />
        <Tooltip
          {...TOOLTIP}
          labelFormatter={(label) => `${fmtTime(Number(label))} wall clock`}
          formatter={(value, name) => [fmt(Number(value), 4), String(name)]}
        />
        <ReferenceLine y={1} stroke="#a3a3a3" strokeDasharray="4 3" label={{ value: "1.00 = break-even", fill: "#a3a3a3", fontSize: 10, position: "insideBottomRight" }} />
        <ReferenceLine x={splitSeconds * 1000} stroke={OKABE.sky} strokeDasharray="2 3" label={{ value: "out-of-sample starts →", fill: OKABE.sky, fontSize: 10, position: "insideTopLeft" }} />
        <Area type="monotone" dataKey="equity" name="net of cost" stroke={OKABE.orange} strokeWidth={1.75} fill={OKABE.orange} fillOpacity={0.12} baseValue={1} isAnimationActive={false} dot={false} />
        {showGross && <Line type="monotone" dataKey="gross" name="before cost" stroke={OKABE.sky} strokeWidth={1.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} />}
        {showBuyAndHold && <Line type="monotone" dataKey="hold" name="buy and hold" stroke={OKABE.purple} strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function DrawdownChart({ series, worstSeconds, worstDepth, height = 280 }: { series: ThinnedSeries; worstSeconds: number | null; worstDepth: number; height?: number }) {
  const data = series.timestampSeconds.map((seconds, i) => ({ at: seconds * 1000, percent: (series.drawdown[i] as number) * 100 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="at" type="number" domain={["dataMin", "dataMax"]} tickFormatter={monthTick} tick={AXIS} minTickGap={48} />
        <YAxis tick={AXIS} domain={["auto", 0]} tickFormatter={(value: number) => `${fmt(value, 0)}%`} width={52} label={{ value: "below the running high", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10, offset: 8 }} />
        <Tooltip {...TOOLTIP} labelFormatter={(label) => `${fmtTime(Number(label))} wall clock`} formatter={(value) => [`${fmt(Number(value), 2)}%`, "drawdown"]} />
        <ReferenceLine y={0} stroke="#a3a3a3" />
        <Area type="monotone" dataKey="percent" name="drawdown" stroke={OKABE.blue} strokeWidth={1.25} fill={OKABE.blue} fillOpacity={0.25} isAnimationActive={false} dot={false} />
        {worstSeconds !== null && (
          <ReferenceDot
            x={worstSeconds * 1000}
            y={worstDepth * 100}
            r={5}
            fill={OKABE.yellow}
            stroke="#0a0a0a"
            label={{ value: `worst ${fmt(worstDepth * 100, 1)}% on ${dateLabel(worstSeconds * 1000)}`, fill: OKABE.yellow, fontSize: 10, position: "insideTopRight" }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MonthsChart({ months, height = 260 }: { months: MonthlyReturn[]; height?: number }) {
  const data = months.map((month) => ({ month: month.month, strategy: month.strategy * 100, hold: month.buyAndHold * 100, bars: month.barCount }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="month" tick={AXIS} minTickGap={24} />
        <YAxis tick={AXIS} tickFormatter={(value: number) => `${fmt(value, 0)}%`} width={48} />
        <Tooltip {...TOOLTIP} formatter={(value, name) => [`${Number(value) >= 0 ? "▲ +" : "▼ "}${fmt(Number(value), 2)}%`, String(name)]} />
        <ReferenceLine y={0} stroke="#a3a3a3" />
        <Bar dataKey="strategy" name="strategy, net of cost" isAnimationActive={false}>
          {data.map((row) => (
            <Cell key={row.month} fill={row.strategy >= 0 ? OKABE.orange : OKABE.blue} />
          ))}
        </Bar>
        <Bar dataKey="hold" name="buy and hold" fill={OKABE.purple} fillOpacity={0.55} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function EpisodesTable({ episodes, summary }: { episodes: DrawdownEpisode[]; summary: SummaryBlock }) {
  const bar = summary.annualisationBarsPerYear > 0 ? 365.25 / summary.annualisationBarsPerYear : 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[11px] font-mono tnum">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-0.5 font-normal">#</th>
            <th className="font-normal">depth</th>
            <th className="font-normal">high before</th>
            <th className="font-normal">trough</th>
            <th className="font-normal">back at the high</th>
            <th className="text-right font-normal">bars down</th>
            <th className="text-right font-normal">days to recover</th>
          </tr>
        </thead>
        <tbody>
          {episodes.map((episode, i) => (
            <tr key={episode.peakSeconds} className="border-t border-neutral-900">
              <td className="py-0.5 text-neutral-500">{i + 1}</td>
              <td style={{ color: OKABE.blue }}>▼ {fmtPercent(episode.depth, 2)}</td>
              <td className="text-neutral-300">{fmtTime(episode.peakSeconds * 1000)}</td>
              <td className="text-neutral-300">{fmtTime(episode.troughSeconds * 1000)}</td>
              <td className="text-neutral-300">{episode.recoverySeconds === null ? "not by the window's end" : fmtTime(episode.recoverySeconds * 1000)}</td>
              <td className="text-right text-neutral-200">{fmtInt(episode.barsPeakToTrough)}</td>
              <td className="text-right text-neutral-200">
                {episode.barsToRecovery === null ? "—" : fmt(episode.barsToRecovery * bar, 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
