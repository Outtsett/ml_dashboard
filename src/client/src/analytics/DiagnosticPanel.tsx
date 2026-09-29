/**
 * Diagnostic — why is it happening: the large moves and what stood next to
 * each (a reopen after a gap, news whose tone matched the move, the session
 * open, a volume surge), how often each cause explains a move, which hours and
 * weekdays carry more than their share, whether bars move more after news,
 * and where the latest model run made and lost its money.
 */

import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { CAUSE_LABEL, type AnalyticsResponse, type CauseName, type LiftRow } from "@shared/analytics/types";
import { AXIS, Empty, GRID, OKABE, Section, Stat, TOOLTIP, fmt, fmtInt, fmtPercent, fmtTime, fmtUsd, toneOf } from "./common";

const CAUSE_COLOR: Record<CauseName, string> = {
  session_gap: OKABE.purple,
  news: OKABE.yellow,
  session_open: OKABE.sky,
  volume_surge: OKABE.green,
  no_recorded_cause: OKABE.grey,
};

function LiftChart({ rows, label }: { rows: LiftRow[]; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="key" {...AXIS} tickFormatter={(value: string) => (value.length > 3 ? value.slice(0, 3) : value)} />
        <YAxis {...AXIS} width={36} tickFormatter={(value: number) => `${fmt(value, 1)}x`} />
        <ReferenceLine y={1} stroke={OKABE.grey} strokeDasharray="4 3" />
        <Tooltip
          {...TOOLTIP}
          labelFormatter={(value: string) => `${label} ${value}`}
          formatter={(value: number, _name, item) => {
            const row = item.payload as LiftRow;
            return [`${fmt(value, 2)}x as likely (${row.largeMoveCount} of ${row.barCount} bars; mean |return| ${fmt(row.meanAbsoluteReturnPercent, 4)}%)`, "large move"];
          }}
        />
        <Bar dataKey="lift" isAnimationActive={false}>
          {rows.map((row) => (
            <Cell key={row.key} fill={(row.lift ?? 0) >= 1 ? OKABE.orange : OKABE.blue} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DiagnosticPanel({ data }: { data: AnalyticsResponse }) {
  const d = data.diagnostic;
  const events = d.largestMoves;
  const model = d.model;
  const effect = d.newsEffect;
  const segments = model?.segments ?? [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="large moves" value={fmtInt(d.eventCount)} hint={`bars whose return was at least ${d.zThreshold} trailing standard deviations`} />
        <Stat label="explained by a recorded cause" value={fmtPercent(1 - (d.causes.find((c) => c.cause === "no_recorded_cause")?.share ?? 0))} />
        <Stat
          label="bars move more after news"
          value={effect.ratio === null ? "—" : `${fmt(effect.ratio, 2)}x`}
          hint={effect.note ?? `${effect.afterNews.barCount} bars within 60 minutes after an article vs ${effect.withoutNews.barCount} bars without, inside the span the news record covers`}
          tone={effect.ratio !== null && effect.ratio > 1 ? OKABE.orange : undefined}
        />
        <Stat label="bars covered by news" value={fmtInt(effect.coveredBarCount)} hint="Bars between the first and last article the news record holds for this window" />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Section title="What caused the large moves" question={`Share of the ${d.eventCount} moves of ${d.zThreshold}+ standard deviations, by first recorded cause`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d.causes.map((row) => ({ ...row, label: CAUSE_LABEL[row.cause] }))} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" {...AXIS} tickFormatter={(value: number) => fmtPercent(value, 0)} />
              <YAxis type="category" dataKey="label" {...AXIS} width={110} />
              <Tooltip {...TOOLTIP} formatter={(value: number, _n, item) => [`${fmtPercent(value)} (${(item.payload as { eventCount: number }).eventCount} moves)`, "share"]} />
              <Bar dataKey="share" isAnimationActive={false}>
                {d.causes.map((row) => (
                  <Cell key={row.cause} fill={CAUSE_COLOR[row.cause]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[10px] text-neutral-500">
            Order of precedence: reopen after a gap, news whose FinBERT tone matches the move, the session open, volume 3x the median of the previous 100 bars.
          </p>
        </Section>
        <Section title="Which hours carry large moves" question={`How much likelier a 2-sigma move is in each hour than on any bar (${data.clock}); dashed line = no different`}>
          <LiftChart rows={d.hourLift} label="hour" />
        </Section>
        <Section title="Which weekdays carry large moves" question="The same, by weekday">
          <LiftChart rows={d.weekdayLift} label="" />
        </Section>
      </div>

      <Section title="The largest moves and what stood next to them" question="Sorted by size in trailing standard deviations; the cause is the first that matched">
        {events.length === 0 ? (
          <Empty>No move reached {d.zThreshold} standard deviations.</Empty>
        ) : (
          <div className="grid gap-3 xl:grid-cols-[1fr_1.4fr]">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={events} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmtTime(value).slice(5, 10)} {...AXIS} />
                <YAxis dataKey="zScore" {...AXIS} width={36} />
                <ReferenceLine y={0} stroke={OKABE.grey} />
                <Tooltip {...TOOLTIP} labelFormatter={(value: number) => fmtTime(value)} formatter={(value: number) => [fmt(value, 1), "z-score"]} />
                <Scatter dataKey="zScore" isAnimationActive={false}>
                  {events.map((event) => (
                    <Cell key={event.timestamp} fill={CAUSE_COLOR[event.cause]} />
                  ))}
                </Scatter>
              </ComposedChart>
            </ResponsiveContainer>
            <div className="max-h-[260px] overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-neutral-950">
                  <tr className="text-neutral-500">
                    <th className="text-left font-normal">time</th>
                    <th className="text-right font-normal">return</th>
                    <th className="text-right font-normal">z</th>
                    <th className="text-left font-normal pl-2">cause</th>
                    <th className="text-left font-normal">evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.timestamp} className="border-t border-neutral-900 align-top">
                      <td className="font-mono text-neutral-400 whitespace-nowrap">{fmtTime(event.timestamp)}</td>
                      <td className="text-right font-mono tnum" style={{ color: toneOf(event.returnPercent) }}>
                        {fmt(event.returnPercent, 3)}%
                      </td>
                      <td className="text-right font-mono tnum">{fmt(event.zScore, 1)}</td>
                      <td className="pl-2 whitespace-nowrap" style={{ color: CAUSE_COLOR[event.cause] }}>
                        {CAUSE_LABEL[event.cause]}
                      </td>
                      <td className="text-neutral-400">
                        {event.evidence.join("; ") || "—"}
                        {event.headline && <div className="text-neutral-500 italic truncate max-w-[420px]" title={event.headline}>“{event.headline}”</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section
          title="Where the latest model run made and lost money"
          question={model ? `${model.run.modelLabel} · ${model.run.modelId}` : "No finished Model Cycle run on this symbol"}
        >
          {segments.length === 0 ? (
            <Empty>No trade segments recorded.</Empty>
          ) : (
            <table className="w-full text-[11px] font-mono tnum">
              <thead>
                <tr className="text-neutral-500">
                  <th className="text-left font-normal">segment</th>
                  <th className="text-left font-normal">value</th>
                  <th className="text-right font-normal">trades</th>
                  <th className="text-right font-normal">win rate</th>
                  <th className="text-right font-normal">expectancy</th>
                  <th className="text-right font-normal">net profit</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((row) => (
                  <tr key={`${row.segmentKind}-${row.segmentValue}`} className="border-t border-neutral-900">
                    <td className="text-neutral-400">{row.segmentKind.replace("_", " ")}</td>
                    <td className="text-neutral-200">{row.segmentValue}</td>
                    <td className="text-right">{fmtInt(row.tradeCount)}</td>
                    <td className="text-right">{fmtPercent(row.winRate)}</td>
                    <td className="text-right" style={{ color: toneOf(row.expectancyUsd) }}>
                      {fmtUsd(row.expectancyUsd)}
                    </td>
                    <td className="text-right" style={{ color: toneOf(row.netProfitUsd) }}>
                      {fmtUsd(row.netProfitUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title="The model's result by hour" question={`Net profit summed per hour of the bar (${data.clock})`}>
          {!model || model.hours.length === 0 ? (
            <Empty>No predictions recorded.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={model.hours} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="hour" {...AXIS} />
                <YAxis {...AXIS} width={52} tickFormatter={(value: number) => fmtUsd(value)} />
                <ReferenceLine y={0} stroke={OKABE.grey} />
                <Tooltip {...TOOLTIP} formatter={(value: number, _n, item) => [`${fmtUsd(value)} over ${(item.payload as { exposedBarCount: number }).exposedBarCount} bars in a position`, "net"]} />
                <Bar dataKey="netProfitUsd" isAnimationActive={false}>
                  {model.hours.map((row) => (
                    <Cell key={row.hour} fill={toneOf(row.netProfitUsd)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>
    </div>
  );
}
