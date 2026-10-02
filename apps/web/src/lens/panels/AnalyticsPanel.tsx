/**
 * AnalyticsPanel — four questions asked of the selected model, one tab each:
 * What happened (descriptive), Why (diagnostic), What comes next (predictive)
 * and What to do (prescriptive). Every number is computed by the pure shared
 * layer (packages/shared/src/lens/analytics.ts) from the evaluation, the manifest and,
 * once loaded, every bar of the record; this component only draws it.
 *
 * "Show on the Market chart" hands the lens's trades and evaluation span to the
 * chart link as source `model_lens:<modelId>`, for the model's own symbol and
 * timeframe; "Clear from chart" removes that set again.
 */

import { useState } from "react";
import { buildLensChartOverlaySet, computeLensAnalytics, lensChartSource, lensChartTrades, type LensChartOverlaySet } from "@shared/lens/analytics";
import type { LensBar, LensEvaluation, LensManifest } from "@shared/lens/types";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { LensFrame } from "../Frame";
import { HappenedTab } from "./analytics/HappenedTab";
import { WhyTab } from "./analytics/WhyTab";
import { NextTab } from "./analytics/NextTab";
import { ToDoTab } from "./analytics/ToDoTab";

export interface LensChartActions {
  onShow: (set: LensChartOverlaySet) => void;
  onClear: (source: string) => void;
  busy: boolean;
  /** What happened on the last push or clear, in plain words. */
  message: string | null;
}

export interface AnalyticsPanelProps {
  evaluation: LensEvaluation;
  manifest: LensManifest;
  /** Every bar of the record, or null while loading / when it cannot be loaded. */
  bars: LensBar[] | null;
  barsReason?: string | null;
  /** Wall clock, epoch seconds. */
  nowSeconds: number;
  chart?: LensChartActions;
}

type AnalyticsTab = "happened" | "why" | "next" | "todo";

const TABS: Array<{ value: AnalyticsTab; label: string }> = [
  { value: "happened", label: "What happened" },
  { value: "why", label: "Why" },
  { value: "next", label: "What comes next" },
  { value: "todo", label: "What to do" },
];

export function AnalyticsPanel({ evaluation, manifest, bars, barsReason, nowSeconds, chart }: AnalyticsPanelProps) {
  const [tab, setTab] = useState<AnalyticsTab>("happened");
  const analytics = computeLensAnalytics({ evaluation, manifest, bars, barsReason, nowSeconds });

  const showOnChart = () => {
    if (!chart) return;
    chart.onShow(buildLensChartOverlaySet(manifest.modelId, manifest, lensChartTrades({ evaluation, manifest, bars }), evaluation.range));
  };

  return (
    <LensFrame
      title="Analytics"
      question="What happened, why, what comes next, and what to do about it?"
      basis={`${manifest.symbol} ${manifest.timeframe} · ${evaluation.range.barCount.toLocaleString("en-US")} test bars · ${evaluation.headline.tradeCount.toLocaleString("en-US")} trades at threshold ${evaluation.params.threshold.toFixed(3)} · cost ${evaluation.params.costMultiplier.toFixed(2)}× · ${analytics.recordNote}`}
      testId="lens-analytics"
      actions={
        chart && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={showOnChart} disabled={chart.busy} data-testid="lens-analytics-show-on-chart" title={`Draws this model's trades and evaluation span on the Market chart when it shows ${manifest.symbol} ${manifest.timeframe}.`}>
              Show on the Market chart
            </Button>
            <Button size="sm" variant="ghost" onClick={() => chart.onClear(lensChartSource(manifest.modelId))} disabled={chart.busy} data-testid="lens-analytics-clear-chart">
              Clear from chart
            </Button>
          </div>
        )
      }
    >
      {chart?.message && (
        <p className="mb-2 text-[11px] text-muted-foreground" data-testid="lens-analytics-chart-message">
          {chart.message}
        </p>
      )}
      <Tabs value={tab} onValueChange={(value) => setTab(value as AnalyticsTab)}>
        <TabsList>
          {TABS.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value} data-testid={`lens-analytics-tab-${entry.value}`}>
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="happened">
          <HappenedTab happened={analytics.happened} />
        </TabsContent>
        <TabsContent value="why">
          <WhyTab why={analytics.why} horizonBars={manifest.horizonBars} />
        </TabsContent>
        <TabsContent value="next">
          <NextTab next={analytics.next} />
        </TabsContent>
        <TabsContent value="todo">
          <ToDoTab toDo={analytics.toDo} />
        </TabsContent>
      </Tabs>
    </LensFrame>
  );
}
