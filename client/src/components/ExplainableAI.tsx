import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, AreaChart, Area, LineChart, Line
} from "recharts";
import {
  Brain, Eye, Lightbulb, HelpCircle, TrendingUp, TrendingDown,
  ArrowRight, Zap, Target, BarChart3, Layers, ChevronRight, RefreshCw,
  AlertTriangle, CheckCircle2, Info
} from "lucide-react";

interface FeatureContribution {
  feature: string;
  value: number;
  contribution: number;
  direction: 'positive' | 'negative';
}

interface CalibrationBin {
  binMid: number;
  accuracy: number;
  count: number;
}

interface CounterfactualExample {
  changes: Array<{ feature: string; from: number; to: number }>;
  newPrediction: number | string;
  distance: number;
}

interface XAIExplanation {
  method: string;
  timestamp: number;
  prediction: {
    class: number | string;
    confidence: number;
    probabilities?: number[];
  };
  featureContributions?: FeatureContribution[];
  attentionWeights?: number[];
  calibration?: {
    expectedConfidence: number;
    actualAccuracy: number;
    reliabilityDiagram: CalibrationBin[];
  };
  counterfactuals?: CounterfactualExample[];
  summary: string;
}

interface XAIMethod {
  id: string;
  name: string;
  description: string;
  category: string;
  output: string;
  complexity: string;
  params: Array<{
    id: string;
    name: string;
    type: string;
    default?: unknown;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
  }>;
}

interface ExplainableAIProps {
  symbol: string;
  modelId?: number;
}

const XAI_CATEGORY_ICONS: Record<string, React.ReactNode> = {
  attribution: <BarChart3 className="h-4 w-4" />,
  attention: <Eye className="h-4 w-4" />,
  gradient: <Zap className="h-4 w-4" />,
  local: <Target className="h-4 w-4" />,
  interaction: <Layers className="h-4 w-4" />,
  calibration: <CheckCircle2 className="h-4 w-4" />,
  contrastive: <ArrowRight className="h-4 w-4" />,
};

const COMPLEXITY_COLORS: Record<string, string> = {
  low: "bg-green-500/20 text-green-400 border-green-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function ExplainableAI({ symbol, modelId }: ExplainableAIProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedMethod, setSelectedMethod] = useState<string>("shap");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [explanation, setExplanation] = useState<XAIExplanation | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);

  const { data: methodsData } = useQuery({
    queryKey: ['xai-methods'],
    queryFn: async () => {
      const res = await fetch('/api/xai/methods');
      if (!res.ok) throw new Error('Failed to fetch XAI methods');
      return res.json();
    },
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

  const explainMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/xai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          method: selectedMethod,
          params,
          modelId: modelId || 0,
        }),
      });
      if (!res.ok) throw new Error('Failed to generate explanation');
      return res.json();
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
    setIsExplaining(true);
    explainMutation.mutate();
    setIsExplaining(false);
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

  const renderFeatureWaterfall = (contributions: FeatureContribution[]) => {
    const top10 = contributions.slice(0, 10);
    const chartData = top10.map(c => ({
      feature: c.feature.length > 12 ? c.feature.slice(0, 10) + '...' : c.feature,
      fullFeature: c.feature,
      contribution: c.contribution,
      value: c.value,
      fill: c.direction === 'positive' ? '#10b981' : '#ef4444',
    }));

    return (
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 80, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
              tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            />
            <YAxis
              dataKey="feature"
              type="category"
              tick={{ fill: 'rgba(255,255,255,0.8)', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
              tickLine={false}
              width={75}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-black/90 border border-white/20 rounded-lg p-3 shadow-xl">
                      <p className="text-white font-medium text-sm">{data.fullFeature}</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        Value: <span className="font-mono text-white">{data.value?.toFixed(4)}</span>
                      </p>
                      <p className={`text-xs mt-1 ${data.contribution >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        Contribution: <span className="font-mono">{data.contribution >= 0 ? '+' : ''}{data.contribution?.toFixed(4)}</span>
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <ReferenceLine x={0} stroke="rgba(255,255,255,0.3)" />
            <Bar dataKey="contribution" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderAttentionHeatmap = (weights: number[]) => {
    const chartData = weights.map((w, i) => ({
      step: i + 1,
      attention: w,
    }));

    return (
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <defs>
              <linearGradient id="attentionGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="step"
              tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
              label={{ value: 'Time Step', position: 'insideBottom', offset: -5, fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
            />
            <YAxis
              tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
              domain={[0, 1]}
              label={{ value: 'Attention', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-black/90 border border-white/20 rounded-lg p-2 shadow-xl">
                      <p className="text-white text-sm">
                        Step {payload[0].payload.step}: <span className="font-mono text-violet-400">{(payload[0].value as number * 100).toFixed(1)}%</span>
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="attention"
              stroke="#8b5cf6"
              strokeWidth={2}
              fill="url(#attentionGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const renderCalibrationCurve = (calibration: NonNullable<XAIExplanation['calibration']>) => {
    const chartData = calibration.reliabilityDiagram.map(bin => ({
      confidence: bin.binMid * 100,
      accuracy: bin.accuracy * 100,
      count: bin.count,
    }));

    const perfectCalibration = [
      { confidence: 0, perfect: 0 },
      { confidence: 100, perfect: 100 },
    ];

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <p className="text-xs text-muted-foreground">Expected Confidence</p>
            <p className="text-lg font-mono text-white">{(calibration.expectedConfidence * 100).toFixed(1)}%</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3 border border-white/10">
            <p className="text-xs text-muted-foreground">Actual Accuracy</p>
            <p className="text-lg font-mono text-white">{(calibration.actualAccuracy * 100).toFixed(1)}%</p>
          </div>
        </div>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey="confidence"
                tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                label={{ value: 'Confidence (%)', position: 'insideBottom', offset: -10, fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                domain={[0, 100]}
                label={{ value: 'Accuracy (%)', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-black/90 border border-white/20 rounded-lg p-2 shadow-xl">
                        <p className="text-white text-sm">
                          Confidence: <span className="font-mono">{data.confidence?.toFixed(0)}%</span>
                        </p>
                        <p className="text-cyan-400 text-sm">
                          Accuracy: <span className="font-mono">{data.accuracy?.toFixed(1)}%</span>
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Line
                data={perfectCalibration}
                dataKey="perfect"
                stroke="rgba(255,255,255,0.3)"
                strokeDasharray="5 5"
                dot={false}
              />
              <Line
                data={chartData}
                dataKey="accuracy"
                stroke="#06b6d4"
                strokeWidth={2}
                dot={{ fill: '#06b6d4', r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  const renderCounterfactuals = (counterfactuals: CounterfactualExample[], currentPrediction: string | number) => {
    return (
      <div className="space-y-3">
        {counterfactuals.map((cf, idx) => (
          <div key={idx} className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 text-xs">
                Counterfactual {idx + 1}
              </Badge>
              <span className="text-xs text-muted-foreground font-mono">
                Distance: {cf.distance.toFixed(4)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm mb-2">
              <span className="text-muted-foreground">Flips prediction to:</span>
              <Badge className={
                cf.newPrediction === 2 ? "bg-green-500/20 text-green-400" :
                cf.newPrediction === 0 ? "bg-red-500/20 text-red-400" :
                "bg-yellow-500/20 text-yellow-400"
              }>
                {cf.newPrediction === 2 ? 'UP' : cf.newPrediction === 0 ? 'DOWN' : 'NEUTRAL'}
              </Badge>
            </div>
            <div className="space-y-1.5">
              {cf.changes.slice(0, 5).map((change, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-white/70 w-20 truncate">{change.feature}</span>
                  <span className="font-mono text-red-400">{change.from.toFixed(3)}</span>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono text-green-400">{change.to.toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderPredictionBadge = (prediction: XAIExplanation['prediction']) => {
    const direction = prediction.class === 2 ? 'up' : prediction.class === 0 ? 'down' : 'neutral';
    const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Target;
    const colorClass = direction === 'up' ? 'text-green-400 bg-green-500/20' :
                       direction === 'down' ? 'text-red-400 bg-red-500/20' :
                       'text-yellow-400 bg-yellow-500/20';

    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${colorClass}`}>
        <Icon className="h-4 w-4" />
        <span className="font-medium text-sm uppercase">{direction}</span>
        <span className="text-xs opacity-70">({(prediction.confidence * 100).toFixed(1)}%)</span>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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
                    {renderPredictionBadge(explanation.prediction)}
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
                    {renderFeatureWaterfall(explanation.featureContributions)}
                  </div>
                )}

                {explanation.attentionWeights && explanation.attentionWeights.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white flex items-center gap-2">
                      <Eye className="h-4 w-4 text-violet-400" />
                      Attention Weights Over Time
                    </h4>
                    {renderAttentionHeatmap(explanation.attentionWeights)}
                  </div>
                )}

                {explanation.calibration && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-cyan-400" />
                      Confidence Calibration
                    </h4>
                    {renderCalibrationCurve(explanation.calibration)}
                  </div>
                )}

                {explanation.counterfactuals && explanation.counterfactuals.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white flex items-center gap-2">
                      <ArrowRight className="h-4 w-4 text-amber-400" />
                      Counterfactual Examples
                    </h4>
                    {renderCounterfactuals(explanation.counterfactuals, explanation.prediction.class)}
                  </div>
                )}

                {explanation.prediction.probabilities && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-white flex items-center gap-2">
                      <Target className="h-4 w-4 text-rose-400" />
                      Class Probabilities
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                      {['Down', 'Neutral', 'Up'].map((label, i) => (
                        <div key={label} className="bg-white/5 rounded-lg p-2 border border-white/10 text-center">
                          <p className="text-xs text-muted-foreground">{label}</p>
                          <p className="text-lg font-mono text-white">
                            {((explanation.prediction.probabilities?.[i] || 0) * 100).toFixed(1)}%
                          </p>
                          <Progress
                            value={(explanation.prediction.probabilities?.[i] || 0) * 100}
                            className="h-1 mt-1"
                          />
                        </div>
                      ))}
                    </div>
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
