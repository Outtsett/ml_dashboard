import { AnalyticStudies } from "./AnalyticStudies";
/**
 * Descriptive — what is happening: the window's price path, how bars move,
 * when in the day they move, each session day, the news flow and the model
 * runs recorded on this symbol.
 */

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsResponse } from "@shared/analytics/types";
import { AXIS, Empty, GRID, Histogram, OKABE, Section, Stat, SummaryTable, TOOLTIP, fmt, fmtInt, fmtPercent, fmtTime, fmtUsd, toneOf } from "./common";

export function DescriptivePanel({ data }: { data: AnalyticsResponse }) {
  const d = data.descriptive;
  const days = d.sessionDays;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="last close" value={fmt(d.lastClose, 2)} hint={`as of ${fmtTime(d.lastBar)} (${data.clock})`} />
        <Stat label="window change" value={`${fmt(d.windowChangePoints, 2)} pts`} tone={toneOf(d.windowChangePoints)} hint={`${fmtTime(d.firstBar)} to ${fmtTime(d.lastBar)}`} />
        <Stat label="window change %" value={`${fmt(d.windowChangePercent, 2)}%`} tone={toneOf(d.windowChangePercent)} />
        <Stat label="last session day" value={`${fmt(d.lastDayChangePercent, 2)}%`} tone={toneOf(d.lastDayChangePercent)} />
        <Stat label="bars" value={fmtInt(d.barCount)} hint={`${fmtTime(d.firstBar)} to ${fmtTime(d.lastBar)}`} />
        <Stat label="news articles" value={fmtInt(d.news.articleCount)} hint={`${d.news.daysWithNews} days with news; mean FinBERT ${fmt(d.news.meanSentiment, 2)}`} />
      </div>

      <Section title="Price path" question={`Close, ${fmtTime(d.firstBar)} to ${fmtTime(d.lastBar)} (${data.clock})`}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={d.closeSeries} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmtTime(value).slice(0, 10)} {...AXIS} />
            <YAxis domain={["auto", "auto"]} {...AXIS} width={60} tickFormatter={(value: number) => fmt(value, 0)} />
            <Tooltip {...TOOLTIP} labelFormatter={(value: number) => fmtTime(value)} formatter={(value: number) => [fmt(value, 2), "close"]} />
            <Line type="monotone" dataKey="close" stroke={OKABE.sky} dot={false} strokeWidth={1.4} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Section>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="How a bar moves" question="Bar-to-bar return in percent (session gaps excluded): blue = down bars, orange = up bars">
          <Histogram bins={d.returnHistogram} unit="%" />
        </Section>
        <Section title="Eight numbers per column" question="Return percent, bar range in points, volume">
          <SummaryTable
            columns={[
              { name: "return percent", summary: d.returnPercent, decimals: 4 },
              { name: "range points", summary: d.rangePoints, decimals: 2 },
              { name: "volume", summary: d.volume, decimals: 0 },
            ]}
          />
        </Section>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="When in the day it moves" question={`Mean absolute return percent by hour (${data.clock})`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d.hourProfile} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="hour" {...AXIS} />
              <YAxis {...AXIS} width={48} tickFormatter={(value: number) => fmt(value, 3)} />
              <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [fmt(value, 4), name]} />
              <Bar dataKey="meanAbsoluteReturnPercent" name="mean absolute return percent" fill={OKABE.sky} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
        <Section title="Volume by hour" question={`Mean volume per bar by hour (${data.clock})`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d.hourProfile} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="hour" {...AXIS} />
              <YAxis {...AXIS} width={48} tickFormatter={(value: number) => fmtInt(value)} />
              <Tooltip {...TOOLTIP} formatter={(value: number) => [fmtInt(value), "mean volume"]} />
              <Bar dataKey="meanVolume" name="mean volume" fill={OKABE.purple} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="Session days" question={`Return percent per session day, last ${days.length} days`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={days} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="day" {...AXIS} tickFormatter={(value: string) => value.slice(5)} minTickGap={16} />
              <YAxis {...AXIS} width={44} tickFormatter={(value: number) => `${fmt(value, 1)}%`} />
              <Tooltip {...TOOLTIP} formatter={(value: number) => [`${fmt(value, 2)}%`, "return"]} />
              <Bar dataKey="returnPercent" isAnimationActive={false}>
                {days.map((row) => (
                  <Cell key={row.day} fill={toneOf(row.returnPercent)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
        <Section title="News flow" question="Articles per session day (bars) and mean FinBERT score (hover)">
          {d.news.articleCount === 0 ? (
            <Empty>No FinBERT-scored news for this symbol in the window.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={days.filter((row) => row.articleCount > 0)} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="day" {...AXIS} tickFormatter={(value: string) => value.slice(5)} />
                <YAxis {...AXIS} width={40} />
                <Tooltip
                  {...TOOLTIP}
                  formatter={(value: number, _name, item) => [`${fmtInt(value)} articles, mean FinBERT ${fmt((item.payload as { meanSentiment: number | null }).meanSentiment, 2)}`, ""]}
                />
                <Bar dataKey="articleCount" isAnimationActive={false}>
                  {days
                    .filter((row) => row.articleCount > 0)
                    .map((row) => (
                      <Cell key={row.day} fill={toneOf(row.meanSentiment)} />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="Latest headlines" question="Newest articles in the window with their FinBERT score (orange positive, blue negative)">
          {d.news.latest.length === 0 ? (
            <Empty>No headlines.</Empty>
          ) : (
            <ul className="space-y-1 text-[11px]">
              {d.news.latest.map((item) => (
                <li key={item.articleId} className="flex gap-2">
                  <span className="shrink-0 font-mono text-neutral-500">{fmtTime(item.seenAt)}</span>
                  <span className="shrink-0 w-12 text-right font-mono tnum" style={{ color: toneOf(item.score) }}>
                    {fmt(item.score, 2)}
                  </span>
                  <span className="text-neutral-300 truncate" title={item.title}>
                    {item.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Model Cycle runs on this symbol" question="Newest first, from the runs recorded in the lake">
          {d.runs.length === 0 ? (
            <Empty>No Model Cycle run on this symbol yet.</Empty>
          ) : (
            <table className="w-full text-[11px] font-mono tnum">
              <thead>
                <tr className="text-neutral-500">
                  <th className="text-left font-normal">model</th>
                  <th className="text-left font-normal">timeframe</th>
                  <th className="text-left font-normal">started</th>
                  <th className="text-right font-normal">net profit</th>
                  <th className="text-right font-normal">win rate</th>
                  <th className="text-right font-normal">accuracy</th>
                  <th className="text-right font-normal">trades</th>
                </tr>
              </thead>
              <tbody>
                {d.runs.slice(0, 15).map((run) => (
                  <tr key={run.modelId} className="border-t border-neutral-900" title={run.modelId}>
                    <td className="text-neutral-200">{run.modelLabel}</td>
                    <td className="text-neutral-400">{run.timeframe}</td>
                    <td className="text-neutral-400">{run.startedAt ? new Date(run.startedAt).toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
                    <td className="text-right" style={{ color: toneOf(run.netProfitUsd) }}>
                      {fmtUsd(run.netProfitUsd)}
                    </td>
                    <td className="text-right">{fmtPercent(run.winRate)}</td>
                    <td className="text-right">{fmtPercent(run.accuracy)}</td>
                    <td className="text-right">{fmtInt(run.tradeCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
      <AnalyticStudies category="Descriptive" />
    </div>

  );
}
