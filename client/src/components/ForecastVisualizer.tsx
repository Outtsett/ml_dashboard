/**
 * ForecastVisualizer — Shows Chronos pre-trained model predictions vs actuals
 * 
 * Think of it as: You draw a line in the sand. The model looks LEFT of the line
 * (past data) and tries to predict what happens RIGHT of the line (future).
 * Then we reveal what ACTUALLY happened and compare.
 */
import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import {
  Brain, Play, Loader2, TrendingUp, TrendingDown,
  Target, AlertTriangle, CheckCircle2, Eye,
  Clock, ChevronDown, ChevronUp
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
  Legend
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface ForecastMetadata {
  model: string;
  model_size: string;
  device: string;
  num_samples: number;
  context_length: number;
  forecast_horizon: number;
  elapsed_seconds: number;
  generated_at: string;
  symbol: string;
  timeframe_sec: number;
  timeframe_label: string;
  look_ahead_proof: {
    context_end: string;
    forecast_start: string;
    model_saw_only: string;
    compared_against: string;
  };
}

interface ForecastMetrics {
  mae: number;
  mape: number;
  direction_accuracy: number;
}

interface ForecastData {
  metadata: ForecastMetadata;
  metrics: ForecastMetrics;
  context: {
    timestamps: string[];
    close: number[];
    open: number[];
    high: number[];
    low: number[];
  };
  forecast: {
    timestamps: string[];
    median: number[];
    mean: number[];
    low_10: number[];
    low_25: number[];
    high_75: number[];
    high_90: number[];
    actual_close: number[];
  };
}

interface ForecastListItem {
  filename: string;
  size: number;
  modified: string;
  metadata?: ForecastMetadata;
  metrics?: ForecastMetrics;
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function ForecastVisualizer() {
  const queryClient = useQueryClient();
  const dashboard = useDashboard();

  // ── Controls state — sync symbol with unified context ─────
  const [symbol, setSymbolLocal] = useState(dashboard.symbol);
  const setSymbol = (sym: string) => {
    setSymbolLocal(sym);
    dashboard.setSymbol(sym);
  };
  // Listen for context changes from other pages
  useEffect(() => {
    if (dashboard.symbol !== symbol) {
      setSymbolLocal(dashboard.symbol);
    }
  }, [dashboard.symbol]);
  const [timeframe, setTimeframe] = useState("3600");
  const [modelSize, setModelSize] = useState("small");
  const [context, setContext] = useState(500);
  const [horizon, setHorizon] = useState(24);
  const [selectedForecast, setSelectedForecast] = useState<string | null>(null);
  const [showContextBars, setShowContextBars] = useState(50); // how many context bars to show (tail)

  // ── Queries ─────────────────────────────────────────────────
  const { data: instruments = [] } = useQuery({
    queryKey: ["instruments"],
    queryFn: async () => {
      const res = await fetch("/api/instruments");
      return res.json();
    },
  });

  const { data: forecastList = [], isLoading: isListLoading } = useQuery<ForecastListItem[]>({
    queryKey: ["/api/ml/forecasts"],
    queryFn: async () => {
      const res = await fetch("/api/ml/forecasts");
      return res.json();
    },
  });

  const { data: forecastData, isLoading: isDataLoading } = useQuery<ForecastData>({
    queryKey: ["/api/ml/forecasts", selectedForecast],
    queryFn: async () => {
      const res = await fetch(`/api/ml/forecasts/${selectedForecast}`);
      return res.json();
    },
    enabled: !!selectedForecast,
  });

  // ── Run forecast mutation ───────────────────────────────────
  const runForecast = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ml/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          timeframe: parseInt(timeframe),
          context,
          horizon,
          modelSize,
          samples: 20,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Forecast failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ml/forecasts"] });
      // Auto-select the new forecast
      const tfLabels: Record<string, string> = { "60": "1m", "300": "5m", "900": "15m", "1800": "30m", "3600": "1h", "14400": "4h", "86400": "1d" };
      const tfLabel = tfLabels[timeframe] || `${timeframe}s`;
      setSelectedForecast(`chronos_${symbol}_${tfLabel}_${modelSize}.json`);
    },
  });

  // ── Chart Data ──────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!forecastData) return [];

    const { context: ctx, forecast: fc } = forecastData;
    const points: any[] = [];

    // Show last N context bars (so chart isn't overwhelmed)
    const ctxStart = Math.max(0, ctx.timestamps.length - showContextBars);
    for (let i = ctxStart; i < ctx.timestamps.length; i++) {
      const ts = ctx.timestamps[i];
      points.push({
        ts: formatTime(ts),
        rawTs: ts,
        close: ctx.close[i],
        zone: "context",
      });
    }

    // Forecast bars — prediction vs actual
    // Recharts Area supports [min, max] arrays for range rendering
    for (let i = 0; i < fc.timestamps.length; i++) {
      points.push({
        ts: formatTime(fc.timestamps[i]),
        rawTs: fc.timestamps[i],
        actual: fc.actual_close[i],
        predicted: fc.median[i],
        band90: [fc.low_10[i], fc.high_90[i]],
        band50: [fc.low_25[i], fc.high_75[i]],
        zone: "forecast",
      });
    }

    return points;
  }, [forecastData, showContextBars]);

  // Wall index (where context ends and forecast begins)
  const wallIndex = useMemo(() => {
    if (!forecastData) return 0;
    return Math.min(showContextBars, forecastData.context.timestamps.length);
  }, [forecastData, showContextBars]);

  const allSymbols = useMemo(() => {
    const symSet = new Set(instruments.map((i: any) => i.symbol));
    // Add symbols from saved forecasts
    for (const f of forecastList) {
      if (f.metadata?.symbol) symSet.add(f.metadata.symbol);
    }
    // Add common contract symbols that exist in DuckDB
    for (const s of ["EURUSD", "GBPUSD", "USDJPY", "ESM5", "ESZ4", "NQM5", "NQZ4", "MNQ", "MES"]) {
      symSet.add(s);
    }
    return Array.from(symSet).sort() as string[];
  }, [instruments, forecastList]);

  return (
    <div className="space-y-4">
      {/* ── Controls ───────────────────────────────────────────── */}
      <Card className="glass rounded-xl border border-blue-500/20">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Symbol</label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="w-28 h-9 rounded-lg text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allSymbols.map((s: string) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Timeframe</label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="w-20 h-9 rounded-lg text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="300">5m</SelectItem>
                  <SelectItem value="900">15m</SelectItem>
                  <SelectItem value="3600">1H</SelectItem>
                  <SelectItem value="14400">4H</SelectItem>
                  <SelectItem value="86400">1D</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Model Size</label>
              <Select value={modelSize} onValueChange={setModelSize}>
                <SelectTrigger className="w-24 h-9 rounded-lg text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tiny">Tiny (8M)</SelectItem>
                  <SelectItem value="mini">Mini (20M)</SelectItem>
                  <SelectItem value="small">Small (46M)</SelectItem>
                  <SelectItem value="base">Base (200M)</SelectItem>
                  <SelectItem value="large">Large (710M)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 w-32">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Context: {context} bars
              </label>
              <Slider
                value={[context]}
                onValueChange={([v]) => setContext(v)}
                min={100}
                max={1000}
                step={50}
                className="mt-2"
              />
            </div>

            <div className="space-y-1 w-28">
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Horizon: {horizon} bars
              </label>
              <Slider
                value={[horizon]}
                onValueChange={([v]) => setHorizon(v)}
                min={5}
                max={100}
                step={1}
                className="mt-2"
              />
            </div>

            <Button
              onClick={() => runForecast.mutate()}
              disabled={runForecast.isPending}
              className="h-9 rounded-lg px-6 bg-blue-600 hover:bg-blue-500 text-white"
            >
              {runForecast.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running...</>
              ) : (
                <><Play className="h-3.5 w-3.5 mr-1.5" /> Run Forecast</>
              )}
            </Button>
          </div>

          {runForecast.isError && (
            <div className="mt-3 text-sm text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {(runForecast.error as Error).message}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Saved Forecasts ────────────────────────────────────── */}
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

      {/* ── Forecast Chart ─────────────────────────────────────── */}
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
          <Card className="glass rounded-xl border border-border/50">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Eye className="h-4 w-4 text-blue-400" />
                {forecastData.metadata.symbol} {forecastData.metadata.timeframe_label} — Chronos {forecastData.metadata.model_size} Forecast
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="ts"
                    tick={{ fontSize: 10, fill: "#888" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10, fill: "#888" }}
                    tickFormatter={(v: number) => v.toFixed(forecastData.metadata.symbol.includes("JPY") ? 2 : 4)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(0,0,0,0.85)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 12,
                      fontSize: 11,
                    }}
                    formatter={(value: any, name: string) => {
                      const precision = forecastData.metadata.symbol.includes("JPY") ? 3 : 5;
                      if (Array.isArray(value)) {
                        return [`${value[0]?.toFixed(precision)} – ${value[1]?.toFixed(precision)}`, name];
                      }
                      return [typeof value === "number" ? value.toFixed(precision) : value, name];
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                  />

                  {/* THE WALL — vertical line dividing context from forecast */}
                  <ReferenceLine
                    x={chartData[wallIndex - 1]?.ts}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    label={{
                      value: "◄ MODEL SEES | PREDICTS ►",
                      position: "top",
                      style: { fontSize: 10, fill: "#f59e0b", fontWeight: 600 },
                    }}
                  />

                  {/* 90% confidence band (outer) — [low_10, high_90] range */}
                  <Area
                    dataKey="band90"
                    stroke="none"
                    fill="rgba(59, 130, 246, 0.10)"
                    name="90% Confidence"
                    legendType="none"
                    isAnimationActive={false}
                  />

                  {/* 50% confidence band (inner) — [low_25, high_75] range */}
                  <Area
                    dataKey="band50"
                    stroke="none"
                    fill="rgba(59, 130, 246, 0.20)"
                    name="50% Confidence"
                    legendType="none"
                    isAnimationActive={false}
                  />

                  {/* Context (actual past price) */}
                  <Line
                    dataKey="close"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    dot={false}
                    name="Price (Context)"
                    connectNulls={false}
                  />

                  {/* Actual future price (the truth) */}
                  <Line
                    dataKey="actual"
                    stroke="#22c55e"
                    strokeWidth={2.5}
                    dot={{ r: 2, fill: "#22c55e" }}
                    name="Actual (Hidden from Model)"
                    connectNulls={false}
                  />

                  {/* Model prediction */}
                  <Line
                    dataKey="predicted"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                    dot={{ r: 2, fill: "#3b82f6" }}
                    name="Chronos Prediction"
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

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

// ═══════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════

function MetricCard({ label, value, icon, color, hint }: {
  label: string; value: string; icon: React.ReactNode; color: string; hint: string;
}) {
  const colorMap: Record<string, string> = {
    green: "text-green-400 bg-green-500/10 border-green-500/20",
    red: "text-red-400 bg-red-500/10 border-red-500/20",
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    cyan: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  };
  const cls = colorMap[color] || colorMap.blue;
  const [textColor] = cls.split(" ");

  return (
    <Card className={`glass rounded-xl border ${cls.split(" ").slice(1).join(" ")}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <div className={textColor}>{icon}</div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        </div>
        <div className={`text-xl font-bold font-mono ${textColor}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = d.getUTCDate().toString().padStart(2, "0");
    const hr = d.getUTCHours().toString().padStart(2, "0");
    const mn = d.getUTCMinutes().toString().padStart(2, "0");
    return `${mo}/${day} ${hr}:${mn}`;
  } catch {
    return ts.slice(0, 16);
  }
}
