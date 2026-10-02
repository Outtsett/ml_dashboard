/**
 * RollingPanel — V3: is the edge stable, or does it come and go, and is it
 * decaying? Rolling hit rate against the coin-flip null band, rolling Brier,
 * trade-level rolling mean net USD + win rate, and Page-Hinkley drift alarms.
 */

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LensRolling } from "@shared/lens/types";
import { LensFrame } from "../Frame";
import { CaptionRow, SectionHeading } from "./common";
import {
  formatInt,
  formatNumber,
  formatPercent,
  formatTimestamp,
  formatTimestampShort,
  formatUsdSigned,
  LENS_CHART_AXIS,
  LENS_CHART_GRID,
  LENS_CHART_TOOLTIP_STYLE,
} from "./format";
import { DATA_COLORS } from "@/shared/theme/dataColors";

export interface RollingPanelProps {
  rolling: LensRolling;
  horizonBars: number;
}

export function RollingPanel({ rolling, horizonBars }: RollingPanelProps) {
  const hitRateData = rolling.points.map((p) => ({
    ts: p.timestampSeconds,
    hitRate: p.hitRate,
    brier: p.brierScore,
    labelledCount: p.labelledCount,
  }));
  const tradeData = rolling.tradePoints.map((p) => ({
    ts: p.timestampSeconds,
    tradeIndex: p.tradeIndex,
    meanNetUsd: p.meanNetUsd,
    winRate: p.winRate,
    sharpe: p.sharpe,
  }));
  const alarmPoints = rolling.drift.alarms.map((a) => ({
    ts: a.timestampSeconds,
    y: 1,
    statistic: a.statistic,
    direction: a.direction,
  }));

  const basis = `window ${formatInt(rolling.windowBars)} bars over a ${formatInt(horizonBars)}-bar horizon (n_eff ${formatNumber(rolling.effectiveSampleSizePerWindow, 1)}) · trade window ${formatInt(
    rolling.windowTrades,
  )} · null band = coin flip at n_eff (${formatPercent(rolling.nullBand.lower)}–${formatPercent(
    rolling.nullBand.upper,
  )}) · Page-Hinkley delta=${formatNumber(rolling.drift.delta, 4)} lambda=${formatNumber(rolling.drift.lambda, 2)}${
    rolling.downsampled ? " · downsampled for transport" : ""
  }`;

  return (
    <LensFrame
      resizeKey="rolling"
      defaultHeight={520}
      title="Rolling stability"
      question="Is the edge stable, or does it come and go — and is it decaying?"
      basis={basis}
      testId="lens-rolling"
    >
      <div className="flex flex-col gap-4">
        <div>
          <SectionHeading>Rolling hit rate vs coin flip</SectionHeading>
          <ResponsiveContainer width="100%" height={170}>
            <ComposedChart data={hitRateData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...LENS_CHART_GRID} />
              <XAxis dataKey="ts" tickFormatter={formatTimestampShort} {...LENS_CHART_AXIS} minTickGap={40} />
              <YAxis domain={[0, 1]} tickFormatter={(v: number) => formatPercent(v, 0)} {...LENS_CHART_AXIS} width={44} />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                labelFormatter={(ts: number) => formatTimestamp(ts)}
                formatter={(value: number, name: string) => [
                  name === "hitRate" ? formatPercent(value) : formatNumber(value, 4),
                  name === "hitRate" ? "Hit rate" : "Brier",
                ]}
              />
              <ReferenceLine y={rolling.nullBand.lower} stroke="hsl(var(--data-neutral))" strokeDasharray="2 3" />
              <ReferenceLine y={rolling.nullBand.upper} stroke="hsl(var(--data-neutral))" strokeDasharray="2 3" />
              <ReferenceLine y={0.5} stroke="hsl(var(--data-neutral))" strokeWidth={1} label={{ value: "0.5", position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
              <Area type="monotone" dataKey="hitRate" stroke={DATA_COLORS.pos} fill={DATA_COLORS.pos} fillOpacity={0.12} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
              {alarmPoints.map((a) => (
                <ReferenceLine
                  key={`alarm-${a.ts}`}
                  x={a.ts}
                  stroke="hsl(var(--data-warn))"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  label={{ value: "▲", position: "top", fill: "hsl(var(--data-warn))", fontSize: 11 }}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          {rolling.drift.alarms.length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {rolling.drift.alarms.length} drift alarm{rolling.drift.alarms.length === 1 ? "" : "s"} (▲ vermillion, Page-Hinkley):{" "}
              {rolling.drift.alarms
                .slice(0, 6)
                .map((a) => `${formatTimestampShort(a.timestampSeconds)} ${a.direction} (stat ${a.statistic.toFixed(2)})`)
                .join(" · ")}
              {rolling.drift.alarms.length > 6 ? " · …" : ""}
            </p>
          )}
        </div>

        <div>
          <SectionHeading>Rolling Brier score (prediction-level, lower is better)</SectionHeading>
          <ResponsiveContainer width="100%" height={110}>
            <ComposedChart data={hitRateData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...LENS_CHART_GRID} />
              <XAxis dataKey="ts" tickFormatter={formatTimestampShort} {...LENS_CHART_AXIS} minTickGap={40} />
              <YAxis tickFormatter={(v: number) => formatNumber(v, 2)} {...LENS_CHART_AXIS} width={44} />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                labelFormatter={(ts: number) => formatTimestamp(ts)}
                formatter={(value: number) => [formatNumber(value, 4), "Brier"]}
              />
              <ReferenceLine y={0.25} stroke="hsl(var(--data-neutral))" strokeDasharray="2 3" label={{ value: "coin flip 0.25", position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
              <Line type="monotone" dataKey="brier" stroke={DATA_COLORS.neg} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div>
          <SectionHeading>Rolling trade PnL + win rate (trade-level)</SectionHeading>
          <ResponsiveContainer width="100%" height={150}>
            <ComposedChart data={tradeData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid {...LENS_CHART_GRID} />
              <XAxis dataKey="ts" tickFormatter={formatTimestampShort} {...LENS_CHART_AXIS} minTickGap={40} />
              <YAxis
                yAxisId="usd"
                tickFormatter={(v: number) => formatUsdSigned(v, 0)}
                {...LENS_CHART_AXIS}
                width={54}
              />
              <YAxis
                yAxisId="rate"
                orientation="right"
                domain={[0, 1]}
                tickFormatter={(v: number) => formatPercent(v, 0)}
                {...LENS_CHART_AXIS}
                width={40}
              />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                labelFormatter={(ts: number) => formatTimestamp(ts)}
                formatter={(value: number, name: string) => [
                  name === "winRate" ? formatPercent(value) : formatUsdSigned(value),
                  name === "winRate" ? "Win rate" : "Mean net / trade",
                ]}
              />
              <ReferenceLine yAxisId="usd" y={0} stroke="hsl(var(--border))" />
              <ReferenceLine yAxisId="rate" y={0.5} stroke="hsl(var(--data-neutral))" strokeDasharray="2 3" />
              <Line yAxisId="usd" type="monotone" dataKey="meanNetUsd" stroke={DATA_COLORS.pos} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} name="meanNetUsd" />
              <Line yAxisId="rate" type="monotone" dataKey="winRate" stroke={DATA_COLORS.neg} strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} connectNulls={false} name="winRate" />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[11px] text-muted-foreground">
            <span className="mr-3" style={{ color: DATA_COLORS.pos }}>
              ▬ mean net USD / trade
            </span>
            <span style={{ color: DATA_COLORS.neg }}>┄ win rate</span>
          </p>
        </div>

        {tradeData.length === 0 && rolling.tradePoints.length === 0 && (
          <CaptionRow>No trades yet inside a full trade window — the trade-level charts fill in once enough trades accumulate.</CaptionRow>
        )}
      </div>
    </LensFrame>
  );
}
