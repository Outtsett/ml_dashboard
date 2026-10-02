/**
 * The brushed span against the rest of history: the eight distribution numbers
 * for one column (the notebook showed log return), and the two distributions
 * drawn over each other as shares of each group so a thin span and a long
 * history are comparable. A mean and a standard deviation describe a Gaussian;
 * skewness, kurtosis and the extremes show the tail a flattering mean hides.
 */

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, OKABE, SegmentControl, SelectControl, SliderControl, SummaryTable, TOOLTIP, fmtInt, fmtPercent } from "@/studies/kit";
import { SERIES_COLUMNS, columnSpec, type ColumnStatistics, type HistogramComparison, type StatisticsConvention } from "@shared/studies/market-series-explorer";
import { compact } from "./layout";

export interface StatisticsSectionProps {
  statistics: readonly ColumnStatistics[];
  histogram: HistogramComparison | null;
  column: string;
  convention: StatisticsConvention;
  bins: number;
  onColumn: (column: string) => void;
  onConvention: (convention: StatisticsConvention) => void;
  onBins: (bins: number) => void;
}

export function StatisticsSection({ statistics, histogram, column, convention, bins, onColumn, onConvention, onBins }: StatisticsSectionProps) {
  const chosen = statistics.find((row) => row.column === column) ?? statistics[0];
  const available = SERIES_COLUMNS.filter((spec) => statistics.some((row) => row.column === spec.name));
  const spec = columnSpec(chosen?.column ?? column);

  const data = histogram
    ? histogram.brushedShare.map((share, index) => ({
        middle: ((histogram.edges[index] as number) + (histogram.edges[index + 1] as number)) / 2,
        lower: histogram.edges[index] as number,
        upper: histogram.edges[index + 1] as number,
        brushed: share,
        rest: histogram.restShare[index] as number,
      }))
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2">
        <SelectControl label="Column" value={chosen?.column ?? column} options={available.map((item) => ({ value: item.name, label: item.name }))} onChange={onColumn} hint="Any numeric feature column" />
        <SegmentControl
          label="Conventions"
          value={convention}
          options={[{ value: "notebook", label: "notebook" }, { value: "sample", label: "sample-adjusted" }]}
          onChange={onConvention}
          hint="notebook: polars defaults (skewness and kurtosis without small-sample correction, nearest-rank quartiles). sample-adjusted: the dashboard's lens convention."
        />
        <SliderControl label="Bins" value={bins} min={5} max={80} onChange={onBins} />
      </div>
      {spec && (
        <p className="text-[11px] text-neutral-400">
          <span className="font-mono text-neutral-200">{spec.name}</span>: {spec.definition}
        </p>
      )}
      {chosen ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0 overflow-x-auto">
            <SummaryTable
              columns={[
                { name: `brushed span (n ${fmtInt(chosen.brushed.count)})`, summary: chosen.brushed, decimals: 6 },
                { name: `rest of history (n ${fmtInt(chosen.rest.count)})`, summary: chosen.rest, decimals: 6 },
              ]}
            />
          </div>
          <div className="min-w-0">
            {histogram ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="middle" {...AXIS} tickFormatter={(value: number) => compact(value)} interval="preserveStartEnd" height={24} />
                    <YAxis {...AXIS} width={44} tickFormatter={(value: number) => fmtPercent(value, 0)} />
                    <Tooltip
                      {...TOOLTIP}
                      formatter={(value, name) => [fmtPercent(Number(value), 2), String(name)]}
                      labelFormatter={(_label, payload) => {
                        const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                        return bin ? `${compact(bin.lower)} to ${compact(bin.upper)}` : "";
                      }}
                    />
                    <Bar dataKey="rest" name="rest of history (bars)" fill={OKABE.sky} fillOpacity={0.55} isAnimationActive={false} />
                    <Line dataKey="brushed" name="brushed span (line)" stroke={OKABE.orange} strokeWidth={2} dot={{ r: 2.5, fill: OKABE.orange }} isAnimationActive={false} />
                    <ReferenceLine x={0} stroke="#6b6b6b" strokeDasharray="3 3" />
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-neutral-500">
                  Each series is the share of its own values per bin, so {fmtInt(histogram.brushedCount)} brushed values and {fmtInt(histogram.restCount)} others compare directly. Edges run from the pooled 0.5th to 99.5th percentile; values beyond them fall in the end bins.
                </p>
              </>
            ) : (
              <p className="py-6 text-center text-xs text-neutral-500">No known values of this column.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="py-6 text-center text-xs text-neutral-500">No statistics: the series is empty.</p>
      )}
    </div>
  );
}
