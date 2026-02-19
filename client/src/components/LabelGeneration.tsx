import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Play, Eye, Trash2, Tag, BarChart3, GitBranch, Target, TrendingUp, AlertTriangle } from "lucide-react";
import { LABEL_GENERATORS, type LabelGeneratorKey } from "@shared/mlTaxonomy";

interface LabelGenerationProps {
  selectedSymbol: string;
  symbols: string[];
  onSymbolChange: (symbol: string) => void;
}

interface LabelSet {
  id: number;
  name: string;
  generatorType: string;
  category: string;
  symbol: string;
  config: string;
  sampleCount: number;
  positiveCount: number | null;
  negativeCount: number | null;
  neutralCount: number | null;
  labelDistribution: string | null;
  status: string;
  createdAt: string;
  generationTimeMs: number | null;
}

interface PreviewResult {
  success: boolean;
  preview?: Array<Record<string, unknown>>;
  count?: number;
  error?: string;
}

const GENERATOR_ICONS: Record<string, typeof Tag> = {
  direction: Target,
  triple_barrier: BarChart3,
  npmm: TrendingUp,
  volatility_adaptive: AlertTriangle,
  trend_scanning: GitBranch,
  meta_label: Tag,
  future_return: TrendingUp,
  future_volatility: AlertTriangle,
  regime: Tag,
  contrastive_temporal: GitBranch,
  contrastive_augmentation: GitBranch,
  contrastive_statistical: GitBranch,
};

const CATEGORY_COLORS: Record<string, string> = {
  classification: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  regression: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  sequence: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  contrastive: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};

export function LabelGeneration({ selectedSymbol, symbols, onSymbolChange }: LabelGenerationProps) {
  const queryClient = useQueryClient();
  const [selectedGenerator, setSelectedGenerator] = useState<LabelGeneratorKey>("direction");
  const [labelName, setLabelName] = useState("");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  
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
  
  const currentParams = useMemo(() => ({ ...defaultParams, ...params }), [defaultParams, params]);
  
  const { data: labelSets, isLoading: loadingLabelSets } = useQuery<LabelSet[]>({
    queryKey: ["/api/labels", selectedSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/labels?symbol=${selectedSymbol}`);
      if (!res.ok) throw new Error("Failed to fetch label sets");
      return res.json();
    },
  });
  
  const generateMutation = useMutation({
    mutationFn: async (data: { name: string; generatorType: string; symbol: string; params: Record<string, unknown> }) => {
      const res = await fetch("/api/labels/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to generate labels");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
      setLabelName("");
    },
  });
  
  const previewMutation = useMutation({
    mutationFn: async (data: { generatorType: string; symbol: string; params: Record<string, unknown>; limit: number }) => {
      const res = await fetch("/api/labels/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to preview labels");
      return res.json();
    },
    onSuccess: (data) => {
      setPreviewData(data);
    },
  });
  
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/labels/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete label set");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
    },
  });
  
  const handleGenerate = () => {
    if (!labelName.trim()) {
      setLabelName(`${selectedGenerator}-${selectedSymbol}-${Date.now()}`);
    }
    generateMutation.mutate({
      name: labelName.trim() || `${selectedGenerator}-${selectedSymbol}-${Date.now()}`,
      generatorType: selectedGenerator,
      symbol: selectedSymbol,
      params: currentParams,
    });
  };
  
  const handlePreview = () => {
    previewMutation.mutate({
      generatorType: selectedGenerator,
      symbol: selectedSymbol,
      params: currentParams,
      limit: 100,
    });
  };
  
  const updateParam = (id: string, value: unknown) => {
    setParams(prev => ({ ...prev, [id]: value }));
  };
  
  const renderParamInput = (param: { id: string; name: string; type: string; default?: unknown; min?: number; max?: number; step?: number; options?: unknown[] }) => {
    const value = currentParams[param.id] ?? param.default;
    
    switch (param.type) {
      case "number":
        return (
          <Input
            type="number"
            value={value as number}
            onChange={(e) => updateParam(param.id, parseFloat(e.target.value))}
            min={param.min}
            max={param.max}
            step={param.step || 1}
            className="h-8 bg-black/30 border-white/10 text-sm"
            data-testid={`param-${param.id}`}
          />
        );
      case "boolean":
        return (
          <Switch
            checked={value as boolean}
            onCheckedChange={(checked) => updateParam(param.id, checked)}
            data-testid={`param-${param.id}`}
          />
        );
      case "select":
        return (
          <Select
            value={String(value)}
            onValueChange={(v) => updateParam(param.id, param.options?.includes(Number(v)) ? Number(v) : v)}
          >
            <SelectTrigger className="h-8 bg-black/30 border-white/10 text-sm" data-testid={`param-${param.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(param.options || []).map((opt) => (
                <SelectItem key={String(opt)} value={String(opt)}>
                  {String(opt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      default:
        return (
          <Input
            value={String(value)}
            onChange={(e) => updateParam(param.id, e.target.value)}
            className="h-8 bg-black/30 border-white/10 text-sm"
            data-testid={`param-${param.id}`}
          />
        );
    }
  };
  
  const Icon = GENERATOR_ICONS[selectedGenerator] || Tag;
  
  return (
    <div className="space-y-4">
      <Tabs defaultValue="generate" className="w-full">
        <TabsList className="bg-black/40 border border-white/10">
          <TabsTrigger value="generate" className="data-[state=active]:bg-primary/20" data-testid="tab-generate">
            <Tag className="h-3.5 w-3.5 mr-1.5" />
            Generate
          </TabsTrigger>
          <TabsTrigger value="history" className="data-[state=active]:bg-primary/20" data-testid="tab-history">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
            History ({labelSets?.length || 0})
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="generate" className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-4">
            {/* Generator Selection */}
            <Card className="bg-card/50 border-border col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Icon className="h-4 w-4 text-violet-400" />
                  Label Generator
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Symbol</Label>
                  <Select value={selectedSymbol} onValueChange={onSymbolChange}>
                    <SelectTrigger className="h-8 bg-black/30 border-white/10 text-sm" data-testid="select-symbol">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" side="bottom" align="start" className="max-h-[300px] overflow-y-auto">
                      {symbols.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Generator Type</Label>
                  <Select value={selectedGenerator} onValueChange={(v) => {
                    setSelectedGenerator(v as LabelGeneratorKey);
                    setParams({});
                    setPreviewData(null);
                  }}>
                    <SelectTrigger className="h-8 bg-black/30 border-white/10 text-sm" data-testid="select-generator">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" side="bottom" align="start" className="max-h-[300px] overflow-y-auto">
                      {Object.entries(LABEL_GENERATORS).map(([key, gen]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-[9px] px-1 ${CATEGORY_COLORS[gen.category] || ''}`}>
                              {gen.category}
                            </Badge>
                            {gen.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Label Set Name</Label>
                  <Input
                    value={labelName}
                    onChange={(e) => setLabelName(e.target.value)}
                    placeholder={`${selectedGenerator}-${selectedSymbol}`}
                    className="h-8 bg-black/30 border-white/10 text-sm"
                    data-testid="input-label-name"
                  />
                </div>
                
                <div className="pt-2 space-y-2">
                  <p className="text-[10px] text-muted-foreground">{generatorDef?.description}</p>
                </div>
              </CardContent>
            </Card>
            
            {/* Parameters */}
            <Card className="bg-card/50 border-border col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Parameters</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[240px] pr-3">
                  <div className="space-y-3">
                    {generatorDef?.params?.map((param) => (
                      <div key={param.id} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{param.name}</Label>
                        {renderParamInput(param as { id: string; name: string; type: string; default?: unknown; min?: number; max?: number; step?: number; options?: unknown[] })}
                      </div>
                    ))}
                    {(!generatorDef?.params || generatorDef.params.length === 0) && (
                      <p className="text-xs text-muted-foreground italic">No configurable parameters</p>
                    )}
                  </div>
                </ScrollArea>
                
                <div className="flex gap-2 pt-3 border-t border-white/10 mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePreview}
                    disabled={previewMutation.isPending}
                    className="flex-1"
                    data-testid="btn-preview"
                  >
                    {previewMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Eye className="h-3.5 w-3.5 mr-1" />}
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleGenerate}
                    disabled={generateMutation.isPending}
                    className="flex-1"
                    data-testid="btn-generate"
                  >
                    {generateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                    Generate
                  </Button>
                </div>
              </CardContent>
            </Card>
            
            {/* Preview */}
            <Card className="bg-card/50 border-border col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  Preview
                  {previewData?.count !== undefined && (
                    <Badge variant="outline" className="text-[9px]">{previewData.count} samples</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[280px]">
                  {previewData?.error && (
                    <div className="text-rose-400 text-xs p-2 bg-rose-500/10 rounded border border-rose-500/20">
                      {previewData.error}
                    </div>
                  )}
                  {previewData?.preview && previewData.preview.length > 0 && (
                    <div className="space-y-1 font-mono text-[10px]">
                      <div className="grid grid-cols-4 gap-1 text-muted-foreground border-b border-white/10 pb-1 mb-1">
                        <div>Timestamp</div>
                        <div>Close</div>
                        <div>Label</div>
                        <div>Extra</div>
                      </div>
                      {previewData.preview.slice(0, 50).map((row, i) => (
                        <div key={i} className="grid grid-cols-4 gap-1 text-slate-300">
                          <div className="truncate">{row.timestamp ? new Date(row.timestamp as number).toLocaleTimeString() : '--'}</div>
                          <div>{typeof row.close === 'number' ? row.close.toFixed(2) : '--'}</div>
                          <div className={`font-bold ${
                            row.label === 1 ? 'text-emerald-400' : 
                            row.label === -1 ? 'text-rose-400' : 
                            row.label === 0 ? 'text-slate-400' : 'text-muted-foreground'
                          }`}>
                            {row.label !== undefined ? String(row.label) : '--'}
                          </div>
                          <div className="truncate text-muted-foreground">
                            {row.future_return !== undefined ? `r:${(row.future_return as number * 100).toFixed(2)}%` : 
                             row.z_score !== undefined ? `z:${(row.z_score as number).toFixed(2)}` : 
                             row.optimal_horizon !== undefined ? `h:${row.optimal_horizon}` : '--'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!previewData && (
                    <div className="text-muted-foreground text-xs text-center pt-8">
                      Click "Preview" to see sample labels
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
          
          {/* Generation Result */}
          {generateMutation.isSuccess && (
            <Card className="bg-emerald-500/10 border-emerald-500/30">
              <CardContent className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge className="bg-emerald-500/20 text-emerald-400">Success</Badge>
                    <span className="text-sm text-emerald-300">
                      Generated {generateMutation.data?.sampleCount?.toLocaleString()} labels
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {generateMutation.data?.generationTimeMs}ms
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        <TabsContent value="history" className="mt-4">
          <Card className="bg-card/50 border-border">
            <CardContent className="p-0">
              {loadingLabelSets ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : labelSets && labelSets.length > 0 ? (
                <ScrollArea className="h-[400px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b border-white/10">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2">Name</th>
                        <th className="px-4 py-2">Generator</th>
                        <th className="px-4 py-2">Symbol</th>
                        <th className="px-4 py-2">Samples</th>
                        <th className="px-4 py-2">Distribution</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2">Created</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {labelSets.map((ls) => {
                        const dist = ls.labelDistribution ? JSON.parse(ls.labelDistribution) : null;
                        return (
                          <tr key={ls.id} className="border-b border-white/5 hover:bg-white/5">
                            <td className="px-4 py-2 font-mono">{ls.name}</td>
                            <td className="px-4 py-2">
                              <Badge variant="outline" className={`text-[9px] ${CATEGORY_COLORS[ls.category] || ''}`}>
                                {ls.generatorType}
                              </Badge>
                            </td>
                            <td className="px-4 py-2 text-cyan-400">{ls.symbol}</td>
                            <td className="px-4 py-2 font-mono">{ls.sampleCount.toLocaleString()}</td>
                            <td className="px-4 py-2">
                              {dist && (
                                <div className="flex gap-1.5 text-[10px]">
                                  {ls.positiveCount !== null && <span className="text-emerald-400">+{ls.positiveCount}</span>}
                                  {ls.neutralCount !== null && <span className="text-slate-400">0:{ls.neutralCount}</span>}
                                  {ls.negativeCount !== null && <span className="text-rose-400">-{ls.negativeCount}</span>}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <Badge 
                                variant="outline" 
                                className={ls.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 
                                           ls.status === 'failed' ? 'bg-rose-500/20 text-rose-400' : 
                                           'bg-amber-500/20 text-amber-400'}
                              >
                                {ls.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-2 text-muted-foreground text-xs">
                              {new Date(ls.createdAt).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => deleteMutation.mutate(ls.id)}
                                data-testid={`btn-delete-${ls.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollArea>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No label sets generated yet</p>
                  <p className="text-xs mt-1">Generate labels using the form above</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
