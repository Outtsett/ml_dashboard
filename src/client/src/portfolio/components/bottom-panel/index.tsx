import { useState, useEffect, lazy, Suspense } from "react";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Button } from "@/shared/ui/button";
import {
  Brain, BarChart3, Wand2, Terminal, TerminalSquare, Trash2, MessageSquare,
} from "lucide-react";

import { useDashboard } from "@/shared/contexts/UnifiedDashboardContext";
import { useTrainingContext } from "@/training/lib/TrainingContext";
import { PageLoader } from "@/shared/layout/LoadingSkeletons";
import { useTradeMetrics } from "@/portfolio/lib/useTradeMetrics";
import { useMLModels, useMLTrades } from "@/ml/lib/useMLData";
import { useRegimeModels } from "@/ml/lib/useRegimeData";
import { ChatTab } from "@/portfolio/components/chat/ChatTab";
import { TerminalTabs } from "@/system/components/TerminalTabs";

import { LogEntry } from "./TradeRow";
import { ModelsTab } from "./ModelsTab";
import { TradesTab } from "./TradesTab";

const ForecastVisualizer = lazy(() => import("@/ml/components/ForecastVisualizer"));

interface BottomPanelProps {
  /** When true, panel is collapsed — show minimal chrome */
  isCollapsed?: boolean;
}

export function BottomPanel({ isCollapsed }: BottomPanelProps) {
  const dashboard = useDashboard();
  const training = useTrainingContext();
  const [activeTab, setActiveTab] = useState("models");

  // Listen for cross-page tab navigation (e.g., context.navigateToMLHub("trades"))
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail?.tab;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("mlhub-tab", handler);
    return () => window.removeEventListener("mlhub-tab", handler);
  }, []);

  // ─── Data Queries ──────────────────────────────────────────

  const { data: models = [] } = useMLModels();
  const { models: regimeModels } = useRegimeModels(training.isTraining);
  const { data: trades = [] } = useMLTrades();

  // ─── Derived metrics ──────────────────────────────────────

  const tradeMetrics = useTradeMetrics(trades);
  const isTraining = training.isTraining;
  const logs = dashboard.logs;

  if (isCollapsed) {
    return (
      <div className="h-full flex items-center justify-center px-2">
        <span className="text-[10px] text-muted-foreground/60 font-mono tracking-widest [writing-mode:vertical-lr] rotate-180">
          PANEL
        </span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 pt-1.5 pb-1 border-b border-white/5 shrink-0">
          <TabsList className="glass rounded-lg p-0.5 h-auto w-fit">
            <TabsTrigger value="models" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-primary/20 gap-1">
              <Brain className="h-3 w-3" /> Models
              {regimeModels.length > 0 && <Badge variant="outline" className="text-[8px] px-1 py-0 rounded-full ml-0.5">{regimeModels.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="forecast" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-400 gap-1">
              <Wand2 className="h-3 w-3" /> Forecast
            </TabsTrigger>
            <TabsTrigger value="trades" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-primary/20 gap-1">
              <BarChart3 className="h-3 w-3" /> Trades
              {tradeMetrics.totalTrades > 0 && <Badge variant="outline" className="text-[8px] px-1 py-0 rounded-full ml-0.5">{tradeMetrics.totalTrades}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="terminal" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-[hsl(var(--data-pos)/0.15)] data-[state=active]:text-[hsl(var(--data-pos))] gap-1">
              <TerminalSquare className="h-3 w-3" /> Terminal
            </TabsTrigger>
            <TabsTrigger value="chat" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-400 gap-1">
              <MessageSquare className="h-3 w-3" /> Chat
            </TabsTrigger>
            <TabsTrigger value="logs" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-violet-500/15 data-[state=active]:text-violet-400 gap-1">
              <Terminal className="h-3 w-3" /> Log
              {logs.length > 0 && <Badge variant="outline" className="text-[8px] px-1 py-0 rounded-full ml-0.5">{logs.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* Status indicator */}
          <div className="ml-auto flex items-center gap-2">
            {isTraining && (
              <Badge variant="outline" className="text-[9px] px-2 py-0.5 rounded-full border-[hsl(var(--data-pos)/0.3)] text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.1)] font-mono gap-1">
                <Brain className="h-3 w-3 pulse-slow" /> Training
              </Badge>
            )}
          </div>
        </div>

        {/* ─── Models Tab ──────────────────────────────────────── */}
        <TabsContent value="models" className="flex-1 min-h-0 overflow-auto mt-0 p-3 space-y-3">
          <ModelsTab
            savedModels={regimeModels}
            tradeMetrics={tradeMetrics}
            models={models}
          />
        </TabsContent>

        {/* ─── Forecast Tab ────────────────────────────────────── */}
        <TabsContent value="forecast" className="flex-1 min-h-0 overflow-auto mt-0 p-3">
          <Suspense fallback={<PageLoader />}>
            <ForecastVisualizer />
          </Suspense>
        </TabsContent>

        {/* ─── Trades Tab ──────────────────────────────────────── */}
        <TabsContent value="trades" className="flex-1 min-h-0 overflow-auto mt-0 p-3 space-y-3">
          <TradesTab trades={trades} tradeMetrics={tradeMetrics} />
        </TabsContent>
        {/* ─── Terminal Tab (real PTY) ──────────────────────── */}
        <TabsContent value="terminal" className="flex-1 min-h-0 overflow-hidden mt-0">
          <TerminalTabs visible={activeTab === "terminal"} />
        </TabsContent>
        {/* ─── Chat Tab (Ollama LLM) ─────────────────────────── */}
        <TabsContent value="chat" className="flex-1 min-h-0 overflow-hidden mt-0">
          <ChatTab />
        </TabsContent>
        {/* ─── Training Log Tab ────────────────────────────────── */}
        <TabsContent value="logs" className="flex-1 min-h-0 overflow-hidden mt-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 shrink-0">
            <Terminal className="h-3 w-3 text-violet-400" />
            <span className="text-[10px] text-muted-foreground font-mono">Training & System Log</span>
            <span className="text-[9px] text-muted-foreground/50 font-mono">{logs.length} entries</span>
            {logs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-5 px-2 text-[9px] text-muted-foreground hover:text-[hsl(var(--data-neg))]"
                onClick={() => dashboard.clearLogs()}
              >
                <Trash2 className="h-2.5 w-2.5 mr-1" /> Clear
              </Button>
            )}
          </div>
          <ScrollArea className="flex-1">
            <div className="p-1 space-y-0">
              {logs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Terminal className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-xs font-medium">No Log Entries</p>
                  <p className="text-[10px] mt-1 text-muted-foreground/60">Training events and system messages appear here</p>
                </div>
              ) : (
                [...logs].reverse().map(log => <LogEntry key={log.id} log={log} />)
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
