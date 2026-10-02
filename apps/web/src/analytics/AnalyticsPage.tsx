/**
 * Analytics — four tabs, each opening with its question and its method:
 *
 *   Descriptive analytics   What is happening?     Summarize and visualize the data.
 *   Diagnostic analytics    Why is it happening?   Find root causes of events.
 *   Predictive analytics    What will happen?      Identify possible outcomes and the probability that they will happen.
 *   Prescriptive analytics  What should we do?     Determine the best course of action given the outcome you want to achieve.
 *
 * Follows the Market chart's symbol and timeframe (SymbolContext); one request
 * (`/api/analytics`) carries every layer, computed from the lake's bars, the
 * FinBERT-scored news and the Model Cycle runs on the symbol.
 */

import { useState } from "react";
import { Compass } from "lucide-react";
import { PageShell } from "@/backtest/components";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { useEntityStore } from "@/shared/contexts/EntityContext";
import { minutesToApiKey, minutesToLabel } from "@/market/lib/timeframes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { useAnalytics } from "./data";
import { DescriptivePanel } from "./DescriptivePanel";
import { DiagnosticPanel } from "./DiagnosticPanel";
import { PredictivePanel } from "./PredictivePanel";
import { PrescriptivePanel } from "./PrescriptivePanel";
import { Empty, fmtTime } from "./common";
import CyclePage from "@/cycle/CyclePage";

const BAR_WINDOWS = [5_000, 20_000, 50_000] as const;
const HORIZONS = [3, 6, 12, 24, 48, 96] as const;
const SUPPORTED = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

// Each tab opens with its question and what the tab does to answer it.
const LAYERS = [
  { value: "descriptive", label: "Descriptive analytics", question: "What is happening?", method: "Summarize and visualize the data." },
  { value: "diagnostic", label: "Diagnostic analytics", question: "Why is it happening?", method: "Find root causes of events." },
  {
    value: "predictive",
    label: "Predictive analytics",
    question: "What will happen?",
    method: "Identify possible outcomes and the probability that they will happen.",
  },
  {
    value: "prescriptive",
    label: "Prescriptive analytics",
    question: "What should we do?",
    method: "Determine the best course of action given the outcome you want to achieve.",
  },
  {
    value: "models",
    label: "Models & Cycles",
    question: "How are the predictive models performing?",
    method: "Fuse F1, recall, accuracy, prediction percentiles, and active model cycles.",
  },
] as const;

const TAB_KEY = "analytics-tab-v1";

function loadTab(): string {
  try {
    return window.localStorage.getItem(TAB_KEY) ?? "descriptive";
  } catch {
    return "descriptive";
  }
}

export default function AnalyticsPage() {
  const { symbol, timeframeMinutes } = useSymbolContext();
  const activeEntity = useEntityStore(s => s.activeEntity);
  const chartTimeframe = minutesToApiKey(timeframeMinutes);
  const timeframe = SUPPORTED.has(chartTimeframe) ? chartTimeframe : "5m";
  const [bars, setBars] = useState<number>(20_000);
  const [horizon, setHorizon] = useState<number>(12);
  const [tab, setTab] = useState<string>(loadTab);
  
  const query = useAnalytics({ 
    symbol, 
    timeframe, 
    bars, 
    horizon, 
    entityType: activeEntity?.type, 
    entityId: activeEntity?.id 
  });
  const data = query.data;

  const chooseTab = (value: string) => {
    setTab(value);
    try {
      window.localStorage.setItem(TAB_KEY, value);
    } catch {
      // A full quota must not stop the tab from changing.
    }
  };

  const select = "rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200";
  return (
    <PageShell
      title="Analytics"
      icon={Compass}
      subtitle={`${symbol} · ${minutesToLabel(timeframeMinutes)}${timeframe !== chartTimeframe ? ` (read at ${timeframe})` : ""} · follows the Market chart${
        data ? ` · ${fmtTime(data.descriptive.firstBar)} to ${fmtTime(data.descriptive.lastBar)} ${data.assetClass === "futures" ? "Pacific" : "UTC"}` : ""
      }`}
    >
      <Tabs value={tab} onValueChange={chooseTab} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="flex-wrap h-auto">
            {LAYERS.map((layer) => (
              <TabsTrigger key={layer.value} value={layer.value} data-testid={`analytics-tab-${layer.value}`} title={layer.question}>
                {layer.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-3 text-xs text-neutral-400">
            <label className="flex items-center gap-1.5">
              window
              <select className={select} value={bars} onChange={(event) => setBars(Number(event.target.value))}>
                {BAR_WINDOWS.map((count) => (
                  <option key={count} value={count}>
                    last {count.toLocaleString()} bars
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              horizon
              <select className={select} value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}>
                {HORIZONS.map((count) => (
                  <option key={count} value={count}>
                    {count} bars
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {(() => {
          const layer = LAYERS.find((entry) => entry.value === tab) ?? LAYERS[0];
          return (
            <header className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3" data-testid="analytics-question">
              <div className="text-[10px] uppercase tracking-widest text-neutral-500">{layer.label}</div>
              <h2 className="text-xl font-semibold text-neutral-100">{layer.question}</h2>
              <p className="text-sm text-neutral-400">{layer.method}</p>
            </header>
          );
        })()}

        {query.isLoading && <Empty>Reading {bars.toLocaleString()} bars, news and model runs for {symbol}…</Empty>}
        {query.isError && <Empty>{(query.error as Error).message}</Empty>}
        {data && (
          <>
            {data.notes.length > 0 && (
              <div className="rounded-md border border-[#E69F00]/40 bg-[#E69F00]/5 px-3 py-1.5 text-[11px] text-[#E69F00]">{data.notes.join(" · ")}</div>
            )}
            <TabsContent value="descriptive">
              <DescriptivePanel data={data} />
            </TabsContent>
            <TabsContent value="diagnostic">
              <DiagnosticPanel data={data} />
            </TabsContent>
            <TabsContent value="predictive">
              <PredictivePanel data={data} />
            </TabsContent>
            <TabsContent value="prescriptive" className="mt-0 min-h-0 flex-1 outline-none data-[state=inactive]:hidden">
              <PrescriptivePanel data={data} />
            </TabsContent>
          </>
        )}
        <TabsContent value="models" className="mt-0 min-h-0 flex-1 outline-none data-[state=inactive]:hidden overflow-hidden flex flex-col -mx-4 -mb-4">
          <CyclePage />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
