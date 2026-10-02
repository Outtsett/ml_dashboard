/**
 * ScatterPanel — V4: when the model says up, does price actually go up, and
 * by as much as it implies? Predicted-vs-realized scatter with the 45° line
 * and the OLS fit, decile means with CI whiskers, and a reliability diagram.
 */

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { LensScatter } from "@shared/lens/types";
import { LensFrame } from "../Frame";
import { CaptionRow, SectionHeading, StatCell } from "./common";
import {
  formatBp,
  formatEstimate,
  formatInt,
  formatNumber,
  formatPercent,
  LENS_CHART_AXIS,
  LENS_CHART_GRID,
  LENS_CHART_TOOLTIP_STYLE,
  toStatTone,
  trendTone,
} from "./format";
import { DATA_COLORS } from "@/shared/theme/dataColors";

export interface ScatterPanelProps {
  scatter: LensScatter;
}

export function ScatterPanel({ scatter }: ScatterPanelProps) {
  const points = scatter.points.filter((p) => p.predictedReturnBasisPoints !== null);
  const bounds = points.reduce(
    (acc, p) => {
      const x = p.predictedReturnBasisPoints as number;
      const y = p.realizedReturnBasisPoints;
      return {
        min: Math.min(acc.min, x, y),
        max: Math.max(acc.max, x, y),
      };
    },
    { min: 0, max: 0 },
  );
  const diagonal = [
    { x: bounds.min, y: bounds.min },
    { x: bounds.max, y: bounds.max },
  ];
  const fitLine =
    scatter.fit && scatter.fit.slope !== null && scatter.fit.intercept !== null
      ? [
          { x: bounds.min, y: scatter.fit.intercept + scatter.fit.slope * bounds.min },
          { x: bounds.max, y: scatter.fit.intercept + scatter.fit.slope * bounds.max },
        ]
      : null;

  const decileData = scatter.deciles.map((d) => {
    const est = d.meanRealizedBasisPoints;
    const lowDelta = est.value !== null && est.ciLow !== null ? est.value - est.ciLow : 0;
    const highDelta = est.value !== null && est.ciHigh !== null ? est.ciHigh - est.value : 0;
    return {
      decile: d.decile,
      label: `${formatPercent(d.probabilityLow, 0)}–${formatPercent(d.probabilityHigh, 0)}`,
      mean: est.value,
      errorRange: [lowDelta, highDelta] as [number, number],
      n: est.n,
      predicted: d.meanPredictedBasisPoints,
      upRate: d.upRate,
    };
  });

  const reliabilityData = scatter.reliability.map((b) => ({
    binLabel: `${formatPercent(b.binLow, 0)}–${formatPercent(b.binHigh, 0)}`,
    meanProbability: b.meanProbability,
    observedUpRate: b.observedUpRate,
    count: b.count,
  }));

  const bias = scatter.fit ? formatEstimate(scatter.fit.bias, (v) => formatBp(v), 0) : null;

  const basis = `n=${formatInt(scatter.points.length)}${scatter.sampled ? " (sampled for transport)" : ""} · ${
    scatter.fit ? `fit n=${formatInt(scatter.fit.n)}` : "no fit — interval unavailable"
  } · deciles by rank of probability_up`;

  return (
    <LensFrame
      resizeKey="scatter"
      defaultHeight={520}
      title="Prediction vs reality"
      question="When the model says up, does price actually go up — and by as much as it implies?"
      basis={basis}
      testId="lens-scatter"
    >
      <div className="flex flex-col gap-4">
        {scatter.fit ? (
          <div className="flex flex-wrap gap-2">
            <StatCell label="Bias" value={bias!.display} hint={bias!.title} tone={toStatTone(trendTone(scatter.fit.bias.value ?? 0, 0.5))} />
            <StatCell label="Slope" value={scatter.fit.slope === null ? "—" : `${scatter.fit.slope.toFixed(3)}`} sub="1.0 = calibrated magnitude" />
            <StatCell
              label="Residual noise"
              value={scatter.fit.residualStandardDeviationBasisPoints === null ? "—" : formatBp(scatter.fit.residualStandardDeviationBasisPoints)}
              sub="standard deviation of realized − fit"
            />
            <StatCell label="R²" value={scatter.fit.rSquared === null ? "—" : formatNumber(scatter.fit.rSquared, 3)} sub="predicted median explains this share of realized variance" />
          </div>
        ) : (
          <CaptionRow>No conformal interval is available for this model, so predicted-return fit statistics cannot be computed.</CaptionRow>
        )}

        <div>
          <SectionHeading>Predicted (median) vs realized return, basis points</SectionHeading>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 4, right: 12, bottom: 20, left: -8 }}>
              <CartesianGrid {...LENS_CHART_GRID} />
              <XAxis type="number" dataKey="x" name="predicted" tickFormatter={(v: number) => formatBp(v, 0)} {...LENS_CHART_AXIS} label={{ value: "predicted return (median, bp)", position: "insideBottom", offset: -12, fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
              <YAxis type="number" dataKey="y" name="realized" tickFormatter={(v: number) => formatBp(v, 0)} {...LENS_CHART_AXIS} width={54} label={{ value: "realized (bp)", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
              <ZAxis range={[16, 16]} />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                formatter={(value: number, name: string) => [formatBp(value), name === "x" ? "predicted" : "realized"]}
              />
              <Scatter data={points.map((p) => ({ x: p.predictedReturnBasisPoints, y: p.realizedReturnBasisPoints }))} fill={DATA_COLORS.neutral} fillOpacity={0.35} isAnimationActive={false} />
              <Line data={diagonal} dataKey="y" stroke="hsl(var(--data-neutral))" strokeDasharray="4 3" dot={false} activeDot={false} legendType="none" isAnimationActive={false} name="45°" />
              {fitLine && (
                <Line data={fitLine} dataKey="y" stroke={DATA_COLORS.pos} strokeWidth={2} dot={false} activeDot={false} legendType="none" isAnimationActive={false} name="OLS fit" />
              )}
            </ScatterChart>
          </ResponsiveContainer>
          <p className="mt-1 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
            <span>┄ 45° (perfect calibration)</span>
            <span style={{ color: DATA_COLORS.pos }}>▬ OLS fit</span>
            <span>above the 45° line = model under-predicted the move · below it = model over-predicted the move</span>
          </p>
        </div>

        <div>
          <SectionHeading>Mean realized return by probability decile</SectionHeading>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={decileData} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
              <CartesianGrid {...LENS_CHART_GRID} />
              <XAxis dataKey="label" {...LENS_CHART_AXIS} interval={0} angle={-30} textAnchor="end" height={40} />
              <YAxis tickFormatter={(v: number) => formatBp(v, 0)} {...LENS_CHART_AXIS} width={50} />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                formatter={(value: number, name: string) => [name === "mean" ? formatBp(value) : formatBp(value), name === "mean" ? "mean realized" : name]}
                labelFormatter={(label: string, payload) => {
                  const p = payload?.[0]?.payload as { n?: number } | undefined;
                  return `decile ${label}${p?.n !== undefined ? ` (n=${formatInt(p.n)})` : ""}`;
                }}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="mean" fill={DATA_COLORS.pos} isAnimationActive={false}>
                <ErrorBar dataKey="errorRange" direction="y" width={3} stroke="hsl(var(--muted-foreground))" />
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div>
          <SectionHeading>Reliability — observed up rate vs mean probability</SectionHeading>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart margin={{ top: 4, right: 12, bottom: 4, left: -8 }}>
              <CartesianGrid {...LENS_CHART_GRID} />
              <XAxis type="number" dataKey="meanProbability" domain={[0, 1]} tickFormatter={(v: number) => formatPercent(v, 0)} {...LENS_CHART_AXIS} name="mean probability" />
              <YAxis type="number" dataKey="observedUpRate" domain={[0, 1]} tickFormatter={(v: number) => formatPercent(v, 0)} {...LENS_CHART_AXIS} width={44} name="observed up rate" />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                formatter={(value: number, name: string) => [formatPercent(value), name === "meanProbability" ? "mean probability" : "observed up rate"]}
              />
              <Line data={[{ meanProbability: 0, observedUpRate: 0 }, { meanProbability: 1, observedUpRate: 1 }]} dataKey="observedUpRate" stroke="hsl(var(--data-neutral))" strokeDasharray="4 3" dot={false} activeDot={false} legendType="none" isAnimationActive={false} name="perfect" />
              <Scatter data={reliabilityData.filter((d) => d.meanProbability !== null && d.observedUpRate !== null)} fill={DATA_COLORS.neg} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </LensFrame>
  );
}
