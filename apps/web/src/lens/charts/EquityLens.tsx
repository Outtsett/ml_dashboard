/**
 * EquityLens — V8 cumulative net PnL vs buy-and-hold, with drawdown.
 *
 * One price pane (model net USD vs buy-and-hold, solid orange vs dashed sky)
 * over a drawdown pane (blue area). Answers: would simply holding the
 * contract have done better than trading the model's signals?
 */

import { useEffect, useRef } from "react";
import { createChart, AreaSeries, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import type { LensEquityPoint, LensHeadline, LensManifest } from "@shared/lens/types";
import { createChartOptions } from "@/market/components/chartConfig";
import { DATA_COLORS } from "@/shared/theme/dataColors";
import { LensFrame } from "../Frame";

export interface EquityLensProps {
  equity: LensEquityPoint[];
  headline: LensHeadline;
  manifest: LensManifest;
  cursorTimestampSeconds: number | null;
  /** Fixed pixel height. Omit to fill the parent, which is what a resizable frame gives it. */
  height?: number;
}

const SKY = "#56B4E9";

function formatUsd(value: number | null): string {
  if (value == null) return "n/a";
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function EquityLens({ equity, headline, manifest, cursorTimestampSeconds, height }: EquityLensProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const modelSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const buyHoldSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const drawdownSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, createChartOptions());
    chartRef.current = chart;

    const modelSeries = chart.addSeries(
      LineSeries,
      { color: DATA_COLORS.pos, lineWidth: 2, lineStyle: LineStyle.Solid, priceLineVisible: false, title: "model net" },
      0,
    );
    modelSeriesRef.current = modelSeries;

    const buyHoldSeries = chart.addSeries(
      LineSeries,
      { color: SKY, lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, title: "buy & hold" },
      0,
    );
    buyHoldSeriesRef.current = buyHoldSeries;

    const drawdownSeries = chart.addSeries(
      AreaSeries,
      {
        lineColor: DATA_COLORS.neg,
        topColor: "rgba(0, 114, 178, 0.35)",
        bottomColor: "rgba(0, 114, 178, 0.02)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "drawdown",
      },
      1,
    );
    drawdownSeriesRef.current = drawdownSeries;

    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    panes[1]?.setStretchFactor(1);

    const resizeObserver = new ResizeObserver(() => {
      if (el) chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    modelSeriesRef.current?.setData(equity.map((p) => ({ time: p.timestampSeconds as Time, value: p.modelCumulativeUsd })));
    buyHoldSeriesRef.current?.setData(
      equity.filter((p) => p.buyHoldCumulativeUsd != null).map((p) => ({ time: p.timestampSeconds as Time, value: p.buyHoldCumulativeUsd! })),
    );
    drawdownSeriesRef.current?.setData(equity.map((p) => ({ time: p.timestampSeconds as Time, value: -Math.abs(p.modelDrawdownUsd) })));
  }, [equity]);

  useEffect(() => {
    const chart = chartRef.current;
    const modelSeries = modelSeriesRef.current;
    if (!chart || !modelSeries) return;
    if (cursorTimestampSeconds == null) {
      chart.clearCrosshairPosition();
      return;
    }
    const point = equity.find((p) => p.timestampSeconds === cursorTimestampSeconds);
    if (point) chart.setCrosshairPosition(point.modelCumulativeUsd, cursorTimestampSeconds as Time, modelSeries);
  }, [cursorTimestampSeconds, equity]);

  const finalModel = equity.length > 0 ? equity[equity.length - 1]!.modelCumulativeUsd : null;
  const finalBuyHold = headline.buyHoldNetUsd;
  const edgeVsHold = finalModel != null && finalBuyHold != null ? finalModel - finalBuyHold : null;

  const exposurePercent = Math.round(headline.exposureShare * 1000) / 10;

  // Buy-and-hold on an unadjusted front-month series collects the carry priced
  // in at every contract roll. Saying so beside the number is the difference
  // between a benchmark and a flattering one.
  const discontinuities = manifest.priceDiscontinuities ?? [];
  const rolls = discontinuities.filter((d) => d.kind === "date_boundary");
  const rollPoints = rolls.reduce((total, d) => total + d.gapPoints, 0);
  const rollUsd = rollPoints * manifest.cost.pointValueUsd;

  return (
    <LensFrame
      resizeKey="equity"
      defaultHeight={320}
      fillBody
      title="Cumulative PnL vs buy-and-hold"
      question="Would simply holding the contract have done better than trading the model's signals?"
      testId="equity-lens"
      basis={
        `${headline.tradeCount.toLocaleString()} trades · exposure ${exposurePercent}% of bars · max drawdown ${formatUsd(-Math.abs(headline.maxDrawdownUsd))} · net of round-trip cost` +
        (rolls.length
          ? ` · buy & hold includes ${formatUsd(rollUsd)} of carry priced in at ${rolls.length} contract rolls (${rollPoints >= 0 ? "+" : ""}${rollPoints.toFixed(2)} index points), which no strategy traded`
          : "")
      }
      actions={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3.5" style={{ backgroundColor: DATA_COLORS.pos }} aria-hidden />
            model net {formatUsd(finalModel)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3.5 border-t-2 border-dashed" style={{ borderColor: SKY }} aria-hidden />
            buy &amp; hold {formatUsd(finalBuyHold)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: DATA_COLORS.neg }} aria-hidden />
            drawdown
          </span>
          {edgeVsHold != null && (
            <span className={edgeVsHold >= 0 ? "font-mono tnum" : "font-mono tnum"} style={{ color: edgeVsHold >= 0 ? DATA_COLORS.pos : DATA_COLORS.neg }}>
              {edgeVsHold >= 0 ? "▲" : "▼"} {formatUsd(edgeVsHold)} vs holding
            </span>
          )}
        </div>
      }
    >
      <div ref={containerRef} className="min-h-0 flex-1" style={height ? { height, width: "100%" } : { width: "100%" }} data-testid="equity-lens-chart" />
    </LensFrame>
  );
}
