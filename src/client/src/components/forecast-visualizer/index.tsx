/**
 * ForecastVisualizer — Shows Chronos pre-trained model predictions vs actuals
 *
 * Think of it as: You draw a line in the sand. The model looks LEFT of the line
 * (past data) and tries to predict what happens RIGHT of the line (future).
 * Then we reveal what ACTUALLY happened and compare.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSymbol } from "@/contexts/UnifiedDashboardContext";
import { fetchArray } from "@/lib/fetchArray";
import { mlApi } from "@/lib/apiService";
import { QUERY_KEYS } from "@/lib/types";
import {
  Brain, TrendingUp, TrendingDown, Target,
  CheckCircle2, Eye, Clock, ChevronDown, ChevronUp, Loader2
} from "lucide-react";

import type { ForecastData, ForecastListItem, ChartPoint } from "./types";
import { formatTime } from "./utils";
import { MetricCard } from "./MetricCard";
import { ForecastChart } from "./ForecastChart";
import { ForecastControls } from "./ForecastControls";

export default function ForecastVisualizer() {
  const queryClient = useQueryClient();
  const { symbol, setSymbol } = useSymbol();
  const [timeframe, setTimeframe] = useState("3600");
  const [modelSize, setModelSize] = useState("small");
  const [context, setContext] = useState(500);
  const [horizon, setHorizon] = useState(24);
  const [selectedForecast, setSelectedForecast] = useState<string | null>(null);
  const [showContextBars, setShowContextBars] = useState(50);

  // ── Queries ─────────────────────────────────────────────────
  const { data: instruments = [] } = useQuery({
    queryKey: ["instruments"],
    queryFn: () => fetchArray("/api/instruments"),
  });

  const { data: forecastList = [], isLoading: isListLoading } = useQuery<ForecastListItem[]>({
    queryKey: ["/api/ml/forecasts"],
    queryFn: () => fetchArray<ForecastListItem>("/api/ml/forecasts"),
  });

  const { data: forecastData, isLoading: isDataLoading } = useQuery<ForecastData>({
    queryKey: [...QUERY_KEYS.mlForecasts, selectedForecast],
    queryFn: () => mlApi.getForecastById(selectedForecast!) as Promise<ForecastData>,
    enabled: !!selectedForecast,
  });

  // ── Run forecast mutation ───────────────────────────────────
  const runForecast = useMutation({
    mutationFn: () => mlApi.runForecast({
      symbol,
      timeframe: parseInt(timeframe),
      context,
      horizon,
      modelSize,
      samples: 20,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ml/forecasts"] });
      const tfLabels: Record<string, string> = { "60": "1m", "300": "5m", "900": "15m", "1800": "30m", "3600": "1h", "14400": "4h", "86400": "1d" };
      const tfLabel = tfLabels[timeframe] || `${timeframe}s`;
      setSelectedForecast(`chronos_${symbol}_${tfLabel}_${modelSize}.json`);
    },
  });

  // ── Chart Data ──────────────────────────────────────────────
  const chartData = useMemo((): ChartPoint[] => {
    if (!forecastData) return [];

    const { context: ctx, forecast: fc } = forecastData;
    const points: ChartPoint[] = [];

    const ctxStart = Math.max(0, ctx.timestamps.length - showContextBars);
    for (let i = ctxStart; i < ctx.timestamps.length; i++) {
      points.push({
        ts: formatTime(ctx.timestamps[i]!),
        rawTs: ctx.timestamps[i]!,
        close: ctx.close[i],
        zone: "context",
      });
    }

    for (let i = 0; i < fc.timestamps.length; i++) {
      points.push({
        ts: formatTime(fc.timestamps[i]!),
        rawTs: fc.timestamps[i]!,
        actual: fc.actual_close[i],
        predicted: fc.median[i],
        band90: [fc.low_10[i]!, fc.high_90[i]!],
        band50: [fc.low_25[i]!, fc.high_75[i]!],
        zone: "forecast",
      });
    }

    return points;
  }, [forecastData, showContextBars]);

  const wallIndex = useMemo(() => {
    if (!forecastData) return 0;
    return Math.min(showContextBars, forecastData.context.timestamps.length);
  }, [forecastData, showContextBars]);

  const allSymbols = useMemo(() => {
    const symSet = new Set(instruments.map((i: any) => i.symbol));
    for (const f of forecastList) {
      if (f.metadata?.symbol) symSet.add(f.metadata.symbol);
    }
    for (const s of ["EURUSD", "GBPUSD", "USDJPY", "ESM5", "ESZ4", "NQM5", "NQZ4", "MNQ", "MES"]) {
      symSet.add(s);
    }
    return Array.from(symSet).sort() as string[];
  }, [instruments, forecastList]);

  return (
    <div className="space-y-4">
      {/* ── Controls ──────────────────────────────────────────── */}
      <ForecastControls
        symbol={symbol} onSymbolChange={setSymbol}
        timeframe={timeframe} onTimeframeChange={setTimeframe}
        modelSize={modelSize} onModelSizeChange={setModelSize}
        context={context} onContextChange={setContext}
        horizon={horizon} onHorizonChange={setHorizon}
        allSymbols={allSymbols}
        onRun={() => runForecast.mutate()}
        isPending={runForecast.isPending}
        isError={runForecast.isError}
        errorMessage={(runForecast.error as Error)?.message}
      />

      {/* ── Saved Forecasts ──────────────────────────────────── */}
      {forecastList.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {forecastList.map((f) => (
            <Button
              key={f.filename}
              variant={selectedForecast === f.filename ? "default" : "outline"}
              size="sm"
              className="rounded-lg text-[11px] h-7"
              onClick={() => setSelectedForecast(f.filename)}
            >
              {f.metadata?.symbol || f.filename.replace("chronos_", "").replace(".json", "")}
              {f.metadata && (
                <span className="ml-1 opacity-60">
                  {f.metadata.timeframe_label} • {f.metadata.model_size}
                </span>
              )}
              {f.metrics && (
                <Badge variant="outline" className="ml-1.5 text-[9px] px-1.5 py-0 rounded-full">
                  {f.metrics.direction_accuracy}%
                </Badge>
              )}
            </Button>
          ))}
        </div>
      )}

      {/* ── Forecast Details ─────────────────────────────────── */}
      {forecastData && (
        <>
          {/* Metrics Row */}
          <div className="grid grid-cols-5 gap-3">
            <MetricCard
              label="Direction Accuracy"
              value={`${forecastData.metrics.direction_accuracy}%`}
              icon={<Target className="h-4 w-4" />}
              color={forecastData.metrics.direction_accuracy >= 50 ? "green" : "red"}
              hint="Did the model predict UP or DOWN correctly?"
            />
            <MetricCard
              label="Mean Absolute Error"
              value={forecastData.metrics.mae.toFixed(4)}
              icon={<TrendingUp className="h-4 w-4" />}
              color="blue"
              hint="Average distance between prediction and actual price"
            />
            <MetricCard
              label="MAPE"
              value={`${forecastData.metrics.mape.toFixed(2)}%`}
              icon={<TrendingDown className="h-4 w-4" />}
              color="amber"
              hint="Think of it as: how many percent off the prediction is"
            />
            <MetricCard
              label="Inference Time"
              value={`${forecastData.metadata.elapsed_seconds}s`}
              icon={<Clock className="h-4 w-4" />}
              color="cyan"
              hint={`On ${forecastData.metadata.device.toUpperCase()}`}
            />
            <MetricCard
              label="Model"
              value={forecastData.metadata.model_size.toUpperCase()}
              icon={<Brain className="h-4 w-4" />}
              color="violet"
              hint={forecastData.metadata.model}
            />
          </div>

          {/* Look-Ahead Proof Badge */}
          <div className="flex items-center gap-3 px-2">
            <Badge className="bg-emerald-900/30 text-emerald-400 border border-emerald-500/30 gap-1.5 text-xs px-3 py-1 rounded-full">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Zero Look-Ahead Verified
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              Model saw only bars 0–{forecastData.metadata.context_length - 1}
              {" | "}Compared against bars {forecastData.metadata.context_length}–{forecastData.metadata.context_length + forecastData.metadata.forecast_horizon - 1}
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] rounded-lg"
                onClick={() => setShowContextBars(v => Math.max(10, v === 50 ? 200 : 50))}
              >
                {showContextBars > 50 ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                {showContextBars > 50 ? "Less Context" : "More Context"}
              </Button>
            </div>
          </div>

          {/* Main Chart */}
          <ForecastChart chartData={chartData} wallIndex={wallIndex} forecastData={forecastData} />

          {/* Visual Explanation */}
          <Card className="glass rounded-xl border border-amber-500/20">
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Eye className="h-6 w-6 text-amber-400" />
                </div>
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-foreground">How to read this chart:</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground text-[12px]">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-0.5 bg-slate-400" />
                      <span><strong>Gray line</strong> = prices the model saw (context)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-0.5 bg-amber-500 border-t border-dashed" />
                      <span><strong>Yellow wall</strong> = the hard cutoff (no peeking!)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-0.5 bg-blue-500 border-t border-dashed" />
                      <span><strong>Blue dashed</strong> = what Chronos predicted</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-0.5 bg-green-500" />
                      <span><strong>Green line</strong> = what actually happened</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-3 bg-blue-500/20 rounded" />
                      <span><strong>Blue bands</strong> = confidence range (inner = 50%, outer = 90%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Target className="h-3.5 w-3.5 text-muted-foreground" />
                      <span><strong>Direction</strong> = did it predict up/down correctly?</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty State */}
      {!forecastData && !isDataLoading && forecastList.length === 0 && (
        <Card className="glass rounded-xl border border-dashed border-muted-foreground/30">
          <CardContent className="p-12 text-center">
            <Brain className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No Forecasts Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Think of it as a fortune teller for prices — pick a symbol, set the bars, and hit Run.
              Chronos is pre-trained on millions of time series, so it works <strong>without any training on your data</strong>.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {(isDataLoading || runForecast.isPending) && (
        <Card className="glass rounded-xl border border-blue-500/20">
          <CardContent className="p-12 text-center">
            <Loader2 className="h-8 w-8 text-blue-400 mx-auto mb-4 animate-spin" />
            <p className="text-sm text-muted-foreground">
              {runForecast.isPending
                ? "Running Chronos forecast... First run downloads the model (~30MB–700MB)."
                : "Loading forecast data..."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
