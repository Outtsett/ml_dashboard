/**
 * RL Console — the PPO/DQN/Transformer launcher, as a panel of ML Studio.
 *
 * This was its own route (`/rl-console`) with its own sidebar entry until the
 * nav was consolidated; it is now the "RL Console" tab of `/ml-studio`
 * (`MLStudioPage.tsx`). It is deliberately NOT a seventh stage of the pipeline
 * stepper: the stepper renders numbered stages joined by completion connectors,
 * which asserts Data → Features → Labels → Train → Evaluate → Promote feeds
 * forward. This console consumes nothing from Promote and gates nothing after
 * it, so numbering it "Stage 7" would state a dependency the code does not have.
 *
 * MOUNTING MATTERS HERE. `useWebSocketMetrics()` opens a WebSocket in the
 * component body with no gate, so this tree must stay behind a real conditional
 * render — Radix `TabsContent` without `forceMount` does not render an inactive
 * tab's children — and never behind a CSS-only `hidden`/`display:none` wrapper,
 * which would hold the socket open from the moment /ml-studio loads.
 *
 * The page previously wrapped itself in its own `MLStudioProvider`. Nothing in
 * this subtree calls `useMLStudio`, so that provider only ever stood up a second
 * reducer writing to the same `mlstudio:pipeline:v2:<symbol>:<timeframe>`
 * localStorage key as the real one. It is gone; MLStudioPage provides the real
 * context above both tabs.
 */

import { useState } from "react";
import { Play, Square, Loader2, Activity, Sliders, Network } from "lucide-react";
import { toast } from "sonner";
import { useWebSocketMetrics } from "@/hooks/useWebSocketMetrics";
import { useTelemetryStore } from "@/store/telemetryStore";
import { AnalyticsPanel } from "@/shared/quant-layout/AnalyticsPanel";
import { LoggingTerminal } from "@/shared/quant-layout/LoggingTerminal";
import { ModelSummaryPanel } from "./components/ModelSummaryPanel";
import { ModelArchitectureGraph } from "./components/ModelArchitectureGraph";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { HPOWorkflow } from "@/training/HPOWorkflow";
import { errorMessage } from "@/shared/utils/errorMessage";


export function RLConsolePanel() {
  const { metrics, history, logs } = useWebSocketMetrics();
  const modelSummary = useTelemetryStore((state) => state.modelSummary);
  
  const [instrument, setInstrument] = useState("MNQ");
  const [timeframe, setTimeframe] = useState("1m");
  const [selectedModel, setSelectedModel] = useState("PPOAgent");
  const [dataSize, setDataSize] = useState(0);


  
  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.target.value);
    setDataSize(0);
  };
  
  const handleLaunch = async () => {
    useTelemetryStore.getState().reset();
    try {
      const res = await fetch("/api/experiments/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          instrument: instrument,
          timeframe: timeframe,
          dataSize: dataSize,
          dataset: "QuestDB",
          isSweep: false,
          features: [],
          hyperparameters: {}
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(`Job ${data.jobId} launched!`);
    } catch (e) {
      toast.error(`Failed to launch: ${errorMessage(e)}`);
    }
  };

  const handleAbort = async () => {
    try {
      const res = await fetch("/api/experiments/abort", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Abort signal sent.");
    } catch (e) {
      toast.error(`Failed to abort: ${errorMessage(e)}`);
    }
  };

  const chartData = (history.reward || []).map((_, i) => ({
    iteration: i,
    reward: history.reward[i],
    loss: history.loss[i],
    value_loss: history.value_loss?.[i] || 0,
    kl: history.kl[i],
    entropy: history.entropy[i],
  }));

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      <header className="flex justify-between items-center bg-[#111] border border-neutral-800 rounded px-4 py-2 shadow-sm shrink-0">
        <div className="flex flex-col">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-neutral-200 tracking-wide">RL Console</h1>
            <div className="h-4 w-[1px] bg-neutral-700"></div>
            <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
              <span className={metrics.status === 'training' ? 'text-(--color-accent)' : 'text-neutral-500'}>
                ● {metrics.status.toUpperCase()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-neutral-500">
            <div className="flex items-center gap-2">
              <label>MODEL</label>
              <select value={selectedModel} onChange={handleModelChange} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-0.5 text-neutral-300 outline-none">
                <option value="PPOAgent">PPOAgent (Reinforcement Learning)</option>
                <option value="TransformerModel">TransformerModel (Deep Learning)</option>
                <option value="DQNAgent">DQNAgent (Reinforcement Learning)</option>
                <option value="TFT">TFT</option>
                <option value="CNN_Transformer">CNN_Transformer</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label>ASSET</label>
              <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-0.5 text-neutral-300 outline-none">
                <option value="MNQ">MNQ (Micro Nasdaq)</option>
                <option value="NQ">NQ (Nasdaq)</option>
                <option value="ES">ES (S&P 500)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label>PERIOD</label>
              <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-0.5 text-neutral-300 outline-none">
                <option value="1m">1m (1 Minute)</option>
                <option value="5m">5m (5 Minutes)</option>
                <option value="15m">15m (15 Minutes)</option>
                <option value="1h">1h (1 Hour)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label>DATA SIZE</label>
              <select value={dataSize} onChange={(e) => setDataSize(Number(e.target.value))} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-0.5 text-neutral-300 outline-none">
                <option value={0}>All</option>
                <option value={10000}>10K</option>
                <option value={50000}>50K</option>
                <option value={100000}>100K</option>
                <option value={500000}>500K</option>
              </select>
            </div>
          </div>
        </div>
          
        <div className="flex items-center gap-3">
          <button onClick={handleLaunch} className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--accent)/0.15)] hover:bg-[hsl(var(--accent)/0.25)] text-(--color-accent) border border-[hsl(var(--accent)/0.4)] rounded transition-colors text-sm font-semibold">
            {metrics.status === 'training' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {metrics.status === 'training' ? 'TRAINING...' : 'START RUN'}
          </button>
          <button onClick={handleAbort} className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 rounded transition-colors text-sm font-semibold">
            <Square className="w-4 h-4" />
            ABORT
          </button>
        </div>
      </header>
        
      <Tabs defaultValue="hpo" className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-[#111] border border-neutral-800 rounded-lg p-1 w-fit mb-2 shrink-0">
          <TabsTrigger value="hpo" className="px-4 py-2 text-xs font-medium rounded data-[state=active]:bg-neutral-800 data-[state=active]:text-[#D4AF37]">
            <Sliders className="w-3 h-3 mr-2" /> HPO Config
          </TabsTrigger>
          <TabsTrigger value="training" className="px-4 py-2 text-xs font-medium rounded data-[state=active]:bg-neutral-800 data-[state=active]:text-[#D4AF37]">
            <Activity className="w-3 h-3 mr-2" /> Training
          </TabsTrigger>
          <TabsTrigger value="architecture" className="px-4 py-2 text-xs font-medium rounded data-[state=active]:bg-neutral-800 data-[state=active]:text-[#D4AF37]">
            <Network className="w-3 h-3 mr-2" /> Architecture
          </TabsTrigger>
        </TabsList>
          
        <div className="flex-1 min-h-0 relative">
          <TabsContent value="hpo" className="absolute inset-0 m-0 data-[state=inactive]:hidden outline-none overflow-y-auto">
            <HPOWorkflow />
          </TabsContent>
            
          <TabsContent value="training" className="absolute inset-0 m-0 data-[state=inactive]:hidden outline-none flex flex-col gap-2 overflow-y-auto pr-2 pb-2">
            <div className="flex-grow grid grid-cols-1 lg:grid-cols-4 gap-2 min-h-[500px]">
              <div className="lg:col-span-1 flex flex-col gap-2">
                <ModelSummaryPanel modelSummary={modelSummary} />
              </div>
                
              <div className="lg:col-span-3">
                <AnalyticsPanel data={chartData} title="RL Actor-Critic Telemetry" />
              </div>
                
                
              <div className="lg:col-span-4 h-64">
                <LoggingTerminal logs={logs} title="Rollout Logs" />
              </div>
            </div>
          </TabsContent>
            
          <TabsContent value="architecture" className="absolute inset-0 m-0 data-[state=inactive]:hidden outline-none overflow-y-auto">
            <ModelArchitectureGraph model={selectedModel} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
