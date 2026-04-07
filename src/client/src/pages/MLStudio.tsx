import { useState, useEffect, lazy, Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Brain, FlaskConical, GraduationCap, Layers, 
  Wand2, BarChart3, ArrowRight 
} from "lucide-react";
import { PageLoader } from "@/components/LoadingSkeletons";
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { useTrainingControl } from "@/contexts/TrainingContext";
import { useLocation } from "wouter";
import { useInstruments } from "@/hooks/useRegimeData";
import { useMLTrades } from "@/hooks/useMLData";
import { useTradeMetrics } from "@/hooks/useTradeMetrics";
import { useChartOHLCV } from "@/hooks/useChartOHLCV";
import { useModelCheckpoints, computeAggregateStats } from "@/hooks/useModelCheckpoints";

// Lazy-loaded sub-pages
const Training = lazy(() => import("@/pages/Training"));
const Backtest = lazy(() => import("@/pages/Backtest"));
const Curriculum = lazy(() => import("@/pages/Curriculum"));
const ForecastVisualizer = lazy(() => import("@/components/ForecastVisualizer"));

// Sub-components from former ML Hub
import { DashboardTab } from "./ml-studio/DashboardTab";
import IndicatorChartLayout from "@/components/IndicatorChartLayout";
import { TradesTab } from "./ml-studio/TradesTab";

export default function MLStudio() {
  const dashboard = useDashboard();
  const training = useTrainingControl();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedSymbol, setSelectedSymbolLocal] = useState(dashboard.symbol);
  const [, navigate] = useLocation();

  const setSelectedSymbol = (sym: string) => {
    setSelectedSymbolLocal(sym);
    dashboard.setSymbol(sym);
  };

  useEffect(() => {
    if (dashboard.symbol !== selectedSymbol) {
      setSelectedSymbolLocal(dashboard.symbol);
    }
  }, [dashboard.symbol]);

  const tabLabels: Record<string, string> = {
    dashboard: "Dashboard",
    training: "Training",
    backtest: "Backtest",
    forecast: "Forecast",
    trades: "Trades",
    curriculum: "Curriculum",
  };

  useBreadcrumbs([{ label: tabLabels[activeTab] ?? activeTab }]);

  // Data Queries for the Dashboard/Overview
  const { data: instruments = [] } = useInstruments();
  const { data: trades = [] } = useMLTrades();
  const { chartData } = useChartOHLCV(selectedSymbol, 60); // Default to 1H for overview
  const tradeMetrics = useTradeMetrics(trades);
  const { data: checkpoints = [], isLoading: checkpointsLoading } = useModelCheckpoints();
  const checkpointStats = computeAggregateStats(checkpoints);

  const isTraining = training.isTraining;
  const futuresSymbols = instruments
    .filter((i) => i.assetType === "futures")
    .map((i) => i.symbol);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Institutional Header */}
      <div className="flex justify-between items-center mb-4 shrink-0 px-1">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">ML Studio</h1>
          <p className="text-sm text-muted-foreground mt-1">Universal Trading Agent — Command & Control</p>
        </div>
        
        <div className="flex gap-3 items-center">
          <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
            <SelectTrigger className="w-28 h-10 rounded-xl glass border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {futuresSymbols.map((sym: string) => (
                <SelectItem key={sym} value={sym}>{sym}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Badge variant="outline" className={`h-10 px-4 font-mono gap-2 text-sm rounded-full transition-all duration-500 ${
            isTraining ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10 shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]" : "border-white/10 text-muted-foreground bg-white/5"
          }`}>
            <Brain className={`h-4 w-4 ${isTraining ? "animate-pulse" : ""}`} />
            {isTraining ? "Neural Core Training" : "Idle"}
          </Badge>
        </div>
      </div>

      {/* Neural Price Context — Institutional Overview */}
      <div className="h-[300px] mb-4 glass rounded-2xl border border-white/5 overflow-hidden flex flex-col shrink-0">
        <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between shrink-0 bg-background/40">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            Neural Price Context — {selectedSymbol} 1H
          </h2>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-[9px] border-emerald-500/20 text-emerald-400 bg-emerald-500/5 font-mono">LIVE_TICK_STREAM</Badge>
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <IndicatorChartLayout
            data={chartData}
            symbol={selectedSymbol}
            isFutures={true}
            timeframe={60}
            
            
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center justify-between shrink-0 mb-4">
          <TabsList className="glass rounded-xl p-1 h-auto w-fit border border-white/5">
            <TabsTrigger value="dashboard" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <Layers className="h-3.5 w-3.5 mr-1.5" /> Dashboard
            </TabsTrigger>
            <TabsTrigger value="training" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <Brain className="h-3.5 w-3.5 mr-1.5" /> Training
            </TabsTrigger>
            <TabsTrigger value="backtest" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <FlaskConical className="h-3.5 w-3.5 mr-1.5" /> Backtest
            </TabsTrigger>
            <TabsTrigger value="forecast" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-400">
              <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Forecast
            </TabsTrigger>
            <TabsTrigger value="trades" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Trades
            </TabsTrigger>
            <TabsTrigger value="curriculum" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <GraduationCap className="h-3.5 w-3.5 mr-1.5" /> Curriculum
            </TabsTrigger>
          </TabsList>

          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10 transition-colors"
            onClick={() => navigate("/")}
          >
            <ArrowRight className="h-3.5 w-3.5" /> Institutional Chart
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-card/10 rounded-xl p-0 border border-white/5 relative">
          <Suspense fallback={<PageLoader />}>
            <TabsContent value="dashboard" className="h-full m-0 p-4 space-y-4 data-[state=inactive]:hidden outline-none">
              <DashboardTab
                checkpoints={checkpoints}
                stats={checkpointStats}
                loading={checkpointsLoading}
              />
            </TabsContent>
            
            <TabsContent value="training" className="h-full m-0 data-[state=inactive]:hidden outline-none">
              <Training />
            </TabsContent>
            
            <TabsContent value="backtest" className="h-full m-0 data-[state=inactive]:hidden outline-none">
              <Backtest />
            </TabsContent>
            
            <TabsContent value="forecast" className="h-full m-0 data-[state=inactive]:hidden outline-none">
              <ForecastVisualizer />
            </TabsContent>
            
            <TabsContent value="trades" className="h-full m-0 p-4 space-y-4 data-[state=inactive]:hidden outline-none">
              <TradesTab trades={trades} tradeMetrics={tradeMetrics} />
            </TabsContent>
            
            <TabsContent value="curriculum" className="h-full m-0 data-[state=inactive]:hidden outline-none">
              <Curriculum />
            </TabsContent>
          </Suspense>
        </div>
      </Tabs>
    </div>
  );
}

