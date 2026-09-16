/**
 * DistributionPanel — V9: is the model overconfident, underestimating moves,
 * or blind to the tails? Overlaid predicted vs realized return histograms,
 * the eight-number summaries side by side, tail coverage, and interval width
 * by probability decile.
 */

import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LensDistribution, LensEightNumberSummary } from "@shared/lens/types";
import { LensFrame } from "../Frame";
import { CaptionRow, SectionHeading } from "./common";
import { formatBp, formatInt, formatPercent, LENS_CHART_AXIS, LENS_CHART_GRID, LENS_CHART_TOOLTIP_STYLE } from "./format";
import { DATA_COLORS } from "@/shared/theme/dataColors";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

export interface DistributionPanelProps {
  distribution: LensDistribution;
}

const SUMMARY_ROWS: Array<{ key: keyof LensEightNumberSummary; label: string; decimals: number }> = [
  { key: "count", label: "Count", decimals: 0 },
  { key: "mean", label: "Mean", decimals: 2 },
  { key: "median", label: "Median", decimals: 2 },
  { key: "standardDeviation", label: "Standard deviation", decimals: 2 },
  { key: "skewness", label: "Skewness", decimals: 3 },
  { key: "kurtosis", label: "Excess kurtosis", decimals: 3 },
  { key: "percentile25", label: "25th percentile", decimals: 2 },
  { key: "percentile75", label: "75th percentile", decimals: 2 },
  { key: "minimum", label: "Minimum", decimals: 2 },
  { key: "maximum", label: "Maximum", decimals: 2 },
];

function summaryCell(summary: LensEightNumberSummary | null, key: keyof LensEightNumberSummary, decimals: number): string {
  if (summary === null) return "—";
  const value = summary[key];
  if (value === null) return "—";
  return decimals === 0 ? formatInt(value) : formatBp(value, decimals);
}

export function DistributionPanel({ distribution }: DistributionPanelProps) {
  const histogramData = distribution.histogram.edgesBasisPoints.slice(0, -1).map((edge, i) => ({
    binStart: edge,
    binLabel: formatBp((edge + distribution.histogram.edgesBasisPoints[i + 1]!) / 2, 0),
    realized: distribution.histogram.realizedCounts[i] ?? 0,
    predicted: distribution.histogram.predictedCounts ? distribution.histogram.predictedCounts[i] ?? 0 : null,
  }));

  const widthData = distribution.intervalWidthByDecile.map((d) => ({
    decile: d.decile,
    width: d.meanWidthBasisPoints,
    count: d.count,
  }));

  const tail = distribution.tailCoverage;

  const basis = `realized n=${formatInt(distribution.realized.count)}${
    distribution.predicted ? ` · predicted (conformal median) n=${formatInt(distribution.predicted.count)}` : " · no predicted interval"
  }${tail ? ` · tail coverage n=${formatInt(tail.n)}` : ""}`;

  return (
    <LensFrame
      resizeKey="distribution"
      defaultHeight={520}
      title="Return distribution"
      question="Is the model overconfident, underestimating moves, or blind to the tails?"
      basis={basis}
      testId="lens-distribution"
    >
      <div className="flex flex-col gap-4">
        <div>
          <SectionHeading>Predicted (outline) vs realized (filled) forward return, basis points</SectionHeading>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={histogramData} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
              <CartesianGrid {...LENS_CHART_GRID} />
              <XAxis dataKey="binLabel" {...LENS_CHART_AXIS} interval={Math.max(0, Math.floor(histogramData.length / 10))} />
              <YAxis tickFormatter={(v: number) => formatInt(v)} {...LENS_CHART_AXIS} width={44} />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                formatter={(value: number, name: string) => [formatInt(value), name === "realized" ? "realized count" : "predicted count"]}
              />
              <Bar dataKey="realized" fill={DATA_COLORS.neg} fillOpacity={0.55} isAnimationActive={false} />
              {distribution.predicted && (
                <Line type="stepAfter" dataKey="predicted" stroke={DATA_COLORS.pos} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-1 flex gap-4 text-[11px] text-muted-foreground">
            <span style={{ color: DATA_COLORS.neg }}>■ realized</span>
            {distribution.predicted && <span style={{ color: DATA_COLORS.pos }}>┄ predicted (median)</span>}
          </p>
        </div>

        <div>
          <SectionHeading>Eight-number summary</SectionHeading>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Statistic</TableHead>
                <TableHead className="text-right">Realized</TableHead>
                <TableHead className="text-right">Predicted (median)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SUMMARY_ROWS.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="text-xs text-muted-foreground">{row.label}</TableCell>
                  <TableCell className="text-right font-mono tnum tabular-nums">{summaryCell(distribution.realized, row.key, row.decimals)}</TableCell>
                  <TableCell className="text-right font-mono tnum tabular-nums">{summaryCell(distribution.predicted, row.key, row.decimals)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <SectionHeading>Tail coverage</SectionHeading>
          {tail ? (
            <div className="flex flex-wrap gap-4 text-xs">
              <span>
                nominal {formatPercent(tail.nominalOutsideShare)} outside the {formatPercent(tail.coverage)} interval
              </span>
              <span>
                observed {formatPercent(tail.observedOutsideShare)} outside (below {formatPercent(tail.belowLowerShare)} · above {formatPercent(tail.aboveUpperShare)})
              </span>
              <span className="text-muted-foreground">n={formatInt(tail.n)}</span>
            </div>
          ) : (
            <CaptionRow>No conformal interval is available, so tail coverage cannot be checked.</CaptionRow>
          )}
        </div>

        <div>
          <SectionHeading>Interval width by probability decile</SectionHeading>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={widthData} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
              <CartesianGrid {...LENS_CHART_GRID} />
              <XAxis dataKey="decile" {...LENS_CHART_AXIS} />
              <YAxis tickFormatter={(v: number) => formatBp(v, 0)} {...LENS_CHART_AXIS} width={50} />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                formatter={(value: number, _name, entry) => {
                  const p = entry?.payload as { count?: number } | undefined;
                  return [`${formatBp(value)} (n=${p?.count !== undefined ? formatInt(p.count) : "?"})`, "mean interval width"];
                }}
              />
              <Bar dataKey="width" fill={DATA_COLORS.neutral} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Flat width across deciles means the model does not narrow its interval when it claims higher conviction — confidence in the probability is not confidence in
            the magnitude.
          </p>
        </div>
      </div>
    </LensFrame>
  );
}
