import { useState, lazy, Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ScanLine, Repeat, Eye, GitBranch, Sparkles,
  Combine, Waves, Network,
} from "lucide-react";
import { PageLoader } from "@/components/LoadingSkeletons";
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";

import { PipelineOverview } from "./PipelineOverview";
import { CNNDetail } from "./CNNDetail";
import { LSTMDetail } from "./LSTMDetail";
import { TransformerDetail } from "./TransformerDetail";
import { XGBoostDetail } from "./XGBoostDetail";
import { HybridDetail } from "./HybridDetail";
import { ComparisonMatrix } from "./ComparisonMatrix";

const FourierTransform = lazy(() => import("@/pages/FourierTransform"));

export default function ArchitectureExplorer() {
  const [activeArch, setActiveArch] = useState("cnn");

  const archLabels: Record<string, string> = {
    cnn: "CNN", lstm: "LSTM", transformer: "Transformer",
    xgboost: "XGBoost", hybrid: "Hybrid", fourier: "Fourier",
  };
  useBreadcrumbs([{ label: archLabels[activeArch] ?? activeArch }]);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Network className="h-7 w-7 text-primary" />
          Architecture Explorer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Understand how different ML architectures process your market data — then pick the right one
        </p>
      </div>

      {/* Pipeline overview */}
      <PipelineOverview />

      {/* Architecture deep dives */}
      <Tabs value={activeArch} onValueChange={setActiveArch}>
        <TabsList className="bg-card/50 border border-border/50 p-1 h-auto flex-wrap">
          <TabsTrigger value="cnn" className="data-[state=active]:bg-violet-500/15 data-[state=active]:text-violet-300 gap-1.5 text-xs">
            <ScanLine className="h-3.5 w-3.5" /> CNN
          </TabsTrigger>
          <TabsTrigger value="lstm" className="data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-300 gap-1.5 text-xs">
            <Repeat className="h-3.5 w-3.5" /> LSTM
          </TabsTrigger>
          <TabsTrigger value="transformer" className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-300 gap-1.5 text-xs">
            <Eye className="h-3.5 w-3.5" /> Transformer
          </TabsTrigger>
          <TabsTrigger value="xgboost" className="data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-300 gap-1.5 text-xs">
            <GitBranch className="h-3.5 w-3.5" /> XGBoost
          </TabsTrigger>
          <TabsTrigger value="hybrid" className="data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300 gap-1.5 text-xs">
            <Combine className="h-3.5 w-3.5" /> Hybrid
          </TabsTrigger>
          <TabsTrigger value="fourier" className="data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-300 gap-1.5 text-xs">
            <Waves className="h-3.5 w-3.5" /> Fourier
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cnn" className="mt-4">
          <CNNDetail />
        </TabsContent>
        <TabsContent value="lstm" className="mt-4">
          <LSTMDetail />
        </TabsContent>
        <TabsContent value="transformer" className="mt-4">
          <TransformerDetail />
        </TabsContent>
        <TabsContent value="xgboost" className="mt-4">
          <XGBoostDetail />
        </TabsContent>
        <TabsContent value="hybrid" className="mt-4">
          <HybridDetail />
        </TabsContent>
        <TabsContent value="fourier" className="mt-4">
          <Suspense fallback={<PageLoader />}>
            <FourierTransform />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* Comparison matrix */}
      <ComparisonMatrix />

      {/* Bottom recommendation */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-sm mb-1">What's Next?</div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your universal pipeline already decouples features from the model — the architecture
                is the one swappable piece. Pick the approach that matches how you want your model
                to "think" about market data. You can always start with one and compare results.
                The training infrastructure supports any of these architectures.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-300">
                  CNN — already built, start here to baseline
                </Badge>
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-300">
                  Hybrid — natural upgrade from CNN
                </Badge>
                <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-300">
                  Transformer — if you value interpretability + long-range
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
