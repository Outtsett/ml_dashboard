import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Brain, Eye, Lightbulb, HelpCircle, BarChart3, Zap, Target,
  Layers, RefreshCw, CheckCircle2, ArrowRight, Info
} from "lucide-react";
import { xaiApi } from "@/lib/api_service";
import { QUERY_KEYS } from "@/lib/types";

import type { ExplainableAIProps, XAIExplanation, XAIMethod } from "./types";
import { COMPLEXITY_COLORS } from "./types";
import {
  FeatureWaterfall, AttentionHeatmap, CalibrationCurve,
  CounterfactualList, PredictionBadge, ClassProbabilities,
} from "./visualizations";

// ─── Constants ──────────────────────────────────────────────────────────────

const XAI_CATEGORY_ICONS: Record<string, React.ReactNode> = {
  attribution: <BarChart3 className="h-4 w-4" />,
  attention: <Eye className="h-4 w-4" />,
  gradient: <Zap className="h-4 w-4" />,
  local: <Target className="h-4 w-4" />,
  interaction: <Layers className="h-4 w-4" />,
  calibration: <CheckCircle2 className="h-4 w-4" />,
  contrastive: <ArrowRight className="h-4 w-4" />,
};

// ─── Main Component ─────────────────────────────────────────────────────────

export function ExplainableAI({ symbol, modelId }: ExplainableAIProps) {
  const { toast } = useToast();
  const [selectedMethod, setSelectedMethod] = useState<string>("shap");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [explanation, setExplanation] = useState<XAIExplanation | null>(null);

  const { data: methodsData } = useQuery<{ methods: Record<string, XAIMethod> }>({
    queryKey: [...QUERY_KEYS.xaiMethods],
    queryFn: () => xaiApi.getMethods() as Promise<{ methods: Record<string, XAIMethod> }>,
  });

  const methods: Record<string, XAIMethod> = useMemo(() => {
    return methodsData?.methods || {};
  }, [methodsData]);

  const selectedMethodDef = useMemo(() => {
    return methods[selectedMethod];
  }, [methods, selectedMethod]);

  useEffect(() => {
    if (selectedMethodDef?.params) {
      const defaultParams: Record<string, unknown> = {};
      for (const param of selectedMethodDef.params) {
        defaultParams[param.id] = param.default;
      }
      setParams(defaultParams);
    }
  }, [selectedMethodDef]);

  const explainMutation = useMutation<{ explanation: XAIExplanation }, Error>({
    mutationFn: async () => {
      return xaiApi.explain({
        symbol,
        method: selectedMethod,
        params,
        modelId: modelId || 0,
      }) as Promise<{ explanation: XAIExplanation }>;
    },
    onSuccess: (data) => {
      setExplanation(data.explanation);
      toast({
        title: "Explanation Generated",
        description: `${selectedMethodDef?.name || selectedMethod} analysis complete`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Explanation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleExplain = () => {
    explainMutation.mutate();
  };

  const renderParamInput = (param: XAIMethod['params'][0]) => {
    const value = params[param.id] ?? param.default;

    if (param.type === 'number') {
      return (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{param.min ?? 0}</span>
            <span className="font-mono text-primary">{value as number}</span>
            <span className="text-muted-foreground">{param.max ?? 100}</span>
          </div>
          <Slider
            value={[value as number]}
            min={param.min ?? 0}
            max={param.max ?? 100}
            step={param.step ?? 1}
            onValueChange={([v]) => setParams(p => ({ ...p, [param.id]: v }))}
            className="w-full"
          />
        </div>
      );
    }

    if (param.type === 'select') {
      return (
        <Select
          value={String(value)}
          onValueChange={(v) => setParams(p => ({ ...p, [param.id]: v }))}
        >
          <SelectTrigger className="h-8 bg-black/30 border-white/10 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" side="bottom" align="start" className="max-h-[200px] overflow-y-auto">
            {param.options?.map((opt) => (
              <SelectItem key={opt} value={String(opt)}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (param.type === 'boolean') {
      return (
        <Switch
          checked={value as boolean}
          onCheckedChange={(v) => setParams(p => ({ ...p, [param.id]: v }))}
        />
      );
    }

    return null;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* ── Method Selection Panel ─────────────────────────────────────── */}
      <Card className="bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 border-white/10 backdrop-blur-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            XAI Method
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Explanation Method</Label>
            <Select value={selectedMethod} onValueChange={setSelectedMethod}>
              <SelectTrigger className="h-9 bg-black/30 border-white/10" data-testid="select-xai-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom" align="start" className="max-h-[300px] overflow-y-auto">
                {Object.values(methods).map((method) => (
                  <SelectItem key={method.id} value={method.id}>
                    <div className="flex items-center gap-2">
                      {XAI_CATEGORY_ICONS[method.category] || <Brain className="h-4 w-4" />}
                      <span>{method.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedMethodDef && (
            <>
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <Badge className={COMPLEXITY_COLORS[selectedMethodDef.complexity] || COMPLEXITY_COLORS.medium}>
                    {selectedMethodDef.complexity} complexity
                  </Badge>
                  <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
                    {selectedMethodDef.category}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {selectedMethodDef.description}
                </p>
              </div>

              {selectedMethodDef.params && selectedMethodDef.params.length > 0 && (
                <div className="space-y-3">
                  <Label className="text-xs text-muted-foreground">Parameters</Label>
                  {selectedMethodDef.params.map((param) => (
                    <div key={param.id} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-white/80">{param.name}</span>
                      </div>
                      {renderParamInput(param)}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <Button
            onClick={handleExplain}
            disabled={explainMutation.isPending || !selectedMethod}
            className="w-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500"
            data-testid="btn-generate-explanation"
          >
            {explainMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />
                Generate Explanation
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ── Explanation Results Panel ──────────────────────────────────── */}
      <Card className="lg:col-span-2 bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 border-white/10 backdrop-blur-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Eye className="h-4 w-4 text-cyan-400" />
            Explanation Results
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!explanation ? (
            <div className="flex flex-col items-center justify-center h-[400px] text-center">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                <HelpCircle className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-white mb-2">No Explanation Yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Select an XAI method and click "Generate Explanation" to understand model predictions
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Prediction</p>
                    <PredictionBadge prediction={explanation.prediction} />
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground mb-1">Method</p>
                    <Badge className="bg-primary/20 text-primary border-primary/30">
                      {methods[explanation.method]?.name || explanation.method}
                    </Badge>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 rounded-lg p-3 border border-violet-500/20">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-violet-400 mt-0.5 shrink-0" />
                    <p className="text-sm text-white/90 leading-relaxed">{explanation.summary}</p>
                  </div>
                </div>

                {explanation.featureContributions && explanation.featureContributions.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-emerald-400" />
                      Feature Contributions
                    </h4>
                    <FeatureWaterfall contributions={explanation.featureContributions} />
                  </div>
                )}

                {explanation.attentionWeights && explanation.attentionWeights.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white flex items-center gap-2">
                      <Eye className="h-4 w-4 text-violet-400" />
                      Attention Weights Over Time
                    </h4>
                    <AttentionHeatmap weights={explanation.attentionWeights} />
                  </div>
                )}

                {explanation.calibration && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-cyan-400" />
                      Confidence Calibration
                    </h4>
                    <CalibrationCurve calibration={explanation.calibration} />
                  </div>
                )}

                {explanation.counterfactuals && explanation.counterfactuals.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white flex items-center gap-2">
                      <ArrowRight className="h-4 w-4 text-amber-400" />
                      Counterfactual Examples
                    </h4>
                    <CounterfactualList counterfactuals={explanation.counterfactuals} currentPrediction={explanation.prediction.class} />
                  </div>
                )}

                {explanation.prediction.probabilities && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white flex items-center gap-2">
                      <Target className="h-4 w-4 text-rose-400" />
                      Class Probabilities
                    </h4>
                    <ClassProbabilities probabilities={explanation.prediction.probabilities} />
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ExplainableAI;
