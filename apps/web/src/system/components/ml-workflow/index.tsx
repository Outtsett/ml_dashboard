/**
 * MLWorkflowSidebar — Tabbed workflow panel that lives beside the price chart.
 * 
 * Two tabs:
 *   Labels → Generate and preview labels on the chart
 *   XAI    → Explainability analysis for trained models
 *
 * Training is launched from the toolbar button (model-agnostic, no hardcoded symbol).
 * Backtesting has its own dedicated page.
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Card } from "@/shared/ui/card";
import {
  Tag, Crosshair,
} from "lucide-react";
import { useToast } from "@/shared/hooks/use-toast";
import { LABEL_GENERATORS, type LabelGeneratorKey } from "@shared/mlTaxonomy";
import { type LabelMarker } from "@/market/components/TradingChart";
import { QUERY_KEYS } from "@/shared/utils/types";
import { labelApi, mlApi } from "@/infrastructure/api/api_service";

import type { MlModel } from "@/shared/utils/types";
import type { XAIResult, MLWorkflowSidebarProps } from "@/system/components/ml-workflow/types";
import { LabelsTab } from "./LabelsTab";
import { XAITab } from "./XAITab";

// ─── Component ───────────────────────────────────────────────────────────────

export function MLWorkflowSidebar({
  chartData = [],
  symbol,
  isFutures: _isFutures,
  timeframe,
  onLabelMarkersChange,
  activeTab: externalTab,
  onTabChange,
}: MLWorkflowSidebarProps) {
  const { toast } = useToast();
  const [internalTab, setInternalTab] = useState("labels");
  const activeTab = externalTab ?? internalTab;
  const setActiveTab = (t: string) => {
    setInternalTab(t);
    onTabChange?.(t);
  };

  // ┌──────────────────────────────────────────────────────┐
  // │  LABELS TAB STATE                                    │
  // └──────────────────────────────────────────────────────┘
  const [selectedGenerator, setSelectedGenerator] = useState<LabelGeneratorKey>("direction");
  const [labelPreview, setLabelPreview] = useState<LabelMarker[]>([]);
  const [showLabels, setShowLabels] = useState(false);
  const [labelParams, setLabelParams] = useState<Record<string, unknown>>({});

  const generatorDef = LABEL_GENERATORS[selectedGenerator];
  const defaultParams = useMemo(() => {
    const defaults: Record<string, unknown> = {};
    if (generatorDef?.params) {
      for (const param of generatorDef.params) {
        defaults[param.id] = param.default;
      }
    }
    return defaults;
  }, [generatorDef]);
  const currentParams = useMemo(() => ({ ...defaultParams, ...labelParams }), [defaultParams, labelParams]);

  const previewMutation = useMutation<
    { success: boolean; preview: Array<Record<string, unknown>>; error?: string },
    Error,
    { generatorType: string; symbol: string; params: Record<string, unknown>; limit: number; startTimestamp?: number; endTimestamp?: number; timeframeMinutes?: number }
  >({
    mutationFn: (data) =>
      labelApi.preview(data) as Promise<{ success: boolean; preview: Array<Record<string, unknown>>; error?: string }>,
    onSuccess: (data) => {
      if (data.success && data.preview && data.preview.length > 0) {
        const markers: LabelMarker[] = data.preview
          .filter((row: Record<string, unknown>) => row.label !== null && row.label !== undefined)
          .map((row: Record<string, unknown>) => ({
            timestamp: row.timestamp as number,
            label: row.label as number | null,
            close: row.close as number,
          }));
        setLabelPreview(markers);
        setShowLabels(true);
        onLabelMarkersChange(markers, true);
      } else if (data.error && data.preview?.length === 0) {
        toast({ title: "Not Supported for Preview", description: data.error });
        setLabelPreview([]);
        setShowLabels(false);
        onLabelMarkersChange([], false);
      }
    },
    onError: () => {
      toast({ title: "Preview Failed", description: "Could not generate label preview", variant: "destructive" });
    },
  });

  const generateLabelsRef = useRef<() => void>(() => {});
  useEffect(() => {
    generateLabelsRef.current = () => {
      if (chartData.length === 0) return;
      const startTs = chartData[0]!.timestamp;
      const endTs = chartData[chartData.length - 1]!.timestamp;
      previewMutation.mutate({
        generatorType: selectedGenerator,
        symbol: symbol,
        params: currentParams,
        limit: 50000,
        startTimestamp: startTs,
        endTimestamp: endTs,
        timeframeMinutes: timeframe,
      });
    };
  }, [selectedGenerator, symbol, currentParams, chartData, timeframe]);

  const visibleLabels = useMemo(() => {
    if (!showLabels || labelPreview.length === 0 || chartData.length === 0) return [];
    const start = chartData[0]!.timestamp;
    const end = chartData[chartData.length - 1]!.timestamp;
    return labelPreview.filter(l => l.timestamp >= start && l.timestamp <= end);
  }, [showLabels, labelPreview, chartData]);

  const labelDistribution = useMemo(() => {
    const total = visibleLabels.length;
    const buy = visibleLabels.filter(l => l.label === 1).length;
    const sell = visibleLabels.filter(l => l.label === -1 || l.label === 2).length;
    const hold = visibleLabels.filter(l => l.label === 0).length;
    return {
      total, buy, sell, hold,
      buyPct: total > 0 ? Math.round((buy / total) * 100) : 0,
      sellPct: total > 0 ? Math.round((sell / total) * 100) : 0,
      holdPct: total > 0 ? Math.round((hold / total) * 100) : 0,
    };
  }, [visibleLabels]);

  // ┌──────────────────────────────────────────────────────┐
  // │  XAI TAB STATE                                       │
  // └──────────────────────────────────────────────────────┘
  const { data: mlModels = [] } = useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: () => mlApi.getModels() as Promise<MlModel[]>,
  });
  const activeModelName = mlModels.find(m => m.name.includes(symbol) && m.status === 'active')?.name || `Model-${symbol}`;

  const [xaiMethod, setXaiMethod] = useState("permutation");
  const { data: xaiResult } = useQuery<XAIResult>({
    queryKey: ['xai', activeModelName, xaiMethod],
    queryFn: async () => {
      try {
        return await mlApi.getXAI(activeModelName, xaiMethod) as XAIResult;
      } catch {
        return { method: xaiMethod, features: [] } as unknown as XAIResult;
      }
    },
    enabled: activeTab === 'xai' && !!activeModelName,
  });

  // ┌──────────────────────────────────────────────────────┐
  // │  RENDER                                              │
  // └──────────────────────────────────────────────────────┘
  return (
    <Card className="glass rounded-2xl gradient-border flex flex-col overflow-hidden h-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        {/* Tab strip */}
        <div className="border-b border-white/5 px-2 pt-1.5 shrink-0">
          <TabsList className="w-full h-7 bg-transparent gap-0 p-0">
            <TabsTrigger value="labels" className="flex-1 h-6 text-[10px] data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-400 rounded-md px-1.5 gap-1">
              <Tag className="h-3 w-3" /> Labels
            </TabsTrigger>
            <TabsTrigger value="xai" className="flex-1 h-6 text-[10px] data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 rounded-md px-1.5 gap-1">
              <Crosshair className="h-3 w-3" /> XAI
            </TabsTrigger>
          </TabsList>
        </div>

        {/* LABELS TAB */}
        <TabsContent value="labels" className="flex-1 overflow-auto m-0 p-0">
          <LabelsTab
            selectedGenerator={selectedGenerator}
            setSelectedGenerator={setSelectedGenerator}
            labelParams={labelParams}
            setLabelParams={setLabelParams}
            currentParams={currentParams}
            generatorDef={generatorDef}
            onGenerate={() => generateLabelsRef.current()}
            isPreviewing={previewMutation.isPending}
            chartDataLength={chartData.length}
            showLabels={showLabels}
            onClearLabels={() => {
              setShowLabels(false);
              setLabelPreview([]);
              onLabelMarkersChange([], false);
            }}
            labelDistribution={labelDistribution}
            visibleLabelsCount={visibleLabels.length}
            symbol={symbol}
          />
        </TabsContent>

        {/* XAI TAB */}
        <TabsContent value="xai" className="flex-1 overflow-auto m-0 p-0">
          <XAITab
            xaiMethod={xaiMethod}
            setXaiMethod={setXaiMethod}
            xaiResult={xaiResult}
            activeModelName={activeModelName}
          />
        </TabsContent>

      </Tabs>
    </Card>
  );
}

export default MLWorkflowSidebar;
