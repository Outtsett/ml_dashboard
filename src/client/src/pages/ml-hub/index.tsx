import { useState, useEffect, lazy, Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Brain, Layers, BarChart3, Wand2, ArrowRight,
} from "lucide-react";

import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { PageLoader } from "@/components/LoadingSkeletons";
import { useLocation } from "wouter";
import { useInstruments } from "@/hooks/useRegimeData";
import { useMLModels, useSavedModels, useMLTrades, useTrainStatus, useMLFeatures } from "@/hooks/useMLData";
import { useTradeMetrics } from "@/hooks/useTradeMetrics";

const ForecastVisualizer = lazy(() => import("@/components/ForecastVisualizer"));

import { OverviewTab } from "./OverviewTab";
import { TradesTab } from "./TradesTab";

export default function MLHub() {
  const dashboard = useDashboard();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedSymbol, setSelectedSymbolLocal] = useState(dashboard.symbol);
  const setSelectedSymbol = (sym: string) => {
    setSelectedSymbolLocal(sym);
    dashboard.setSymbol(sym);
  };
  useEffect(() => {
    if (dashboard.symbol !== selectedSymbol) {
      setSelectedSymbolLocal(dashboard.symbol);
    }
  }, [dashboard.symbol]);
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("mlhub-tab", handler);
    return () => window.removeEventListener("mlhub-tab", handler);
  }, []);

  const tabLabels: Record<string, string> = {
    overview: "Overview", forecast: "Forecast", trades: "Trades",
  };
  useBreadcrumbs([{ label: tabLabels[activeTab] ?? activeTab }]);

  const [, navigate] = useLocation();

  // ─── Data Queries ───────────────────────────────────────────

  const { data: instruments = [] } = useInstruments();
  const { data: models = [] } = useMLModels();
  const { savedModels } = useSavedModels();
  const { data: trainingStatus } = useTrainStatus();
  const { data: trades = [] } = useMLTrades();
  const { data: featureInfo } = useMLFeatures();

  // ─── Derived Metrics ────────────────────────────────────────

  const tradeMetrics = useTradeMetrics(trades);

  const isTraining = trainingStatus?.active === true;
  const futuresSymbols = instruments.filter((i) => i.assetType === 'futures').map((i) => i.symbol);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 shrink-0 px-1">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">ML Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">Universal Trading Agent — Train, Backtest, Analyze</p>
        </div>
        <div className="flex gap-3 items-center">
          <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
            <SelectTrigger className="w-28 h-10 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {futuresSymbols.map((sym: string) => (
                <SelectItem key={sym} value={sym}>{sym}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className={`h-10 px-4 font-mono gap-2 text-sm rounded-full ${
            isTraining ? 'border-green-500/30 text-green-400 bg-green-500/10' : 'border-muted-foreground/30 text-muted-foreground'
          }`}>
            <Brain className={`h-4 w-4 ${isTraining ? 'pulse-slow' : ''}`} />
            {isTraining ? 'Training Active' : 'Idle'}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center gap-3 shrink-0">
          <TabsList className="glass rounded-xl p-1 h-auto w-fit">
            <TabsTrigger value="overview" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <Layers className="h-3.5 w-3.5 mr-1.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="forecast" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-400">
              <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Forecast
            </TabsTrigger>
            <TabsTrigger value="trades" className="rounded-lg px-4 py-2 text-xs data-[state=active]:bg-primary/20">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Trades
            </TabsTrigger>
          </TabsList>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => navigate("/")}
          >
            <ArrowRight className="h-3.5 w-3.5" /> Train / Backtest on Chart
          </Button>
        </div>

        {/* ─── Overview Tab ──────────────────────────────────── */}
        <TabsContent value="overview" className="flex-1 min-h-0 overflow-auto mt-4 space-y-4">
          <OverviewTab
            savedModels={savedModels}
            featureInfo={featureInfo}
            tradeMetrics={tradeMetrics}
            models={models}
          />
        </TabsContent>

        {/* ─── Forecast Tab ──────────────────────────────────── */}
        <TabsContent value="forecast" className="flex-1 min-h-0 overflow-auto mt-4">
          <Suspense fallback={<PageLoader />}>
            <ForecastVisualizer />
          </Suspense>
        </TabsContent>

        {/* ─── Trades Tab ────────────────────────────────────── */}
        <TabsContent value="trades" className="flex-1 min-h-0 overflow-auto mt-4 space-y-4">
          <TradesTab trades={trades} tradeMetrics={tradeMetrics} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
