import { useState } from "react";
import { Play, Database, Network, LineChart, Server, Layers, GitBranch, Brain } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { Label } from "@/shared/ui/label";
import { useTrainingControl } from "@/training/lib/TrainingContext";
import { toast } from "sonner";
import type { CatalogModelDetail } from "@/ml/lib/catalog_types";

export function RunConfigurator({ model }: { model: CatalogModelDetail }) {
  const { startTraining, isTraining } = useTrainingControl();
  const [dataSource, setDataSource] = useState("timescaledb-realtime");
  const [featureSet, setFeatureSet] = useState("standard-ohlcv");
  const [targetLabel, setTargetLabel] = useState("ret-log-1m");
  const [hpoEnabled, setHpoEnabled] = useState(false);
  const [wfvFolds, setWfvFolds] = useState("5");

  const handleLaunch = async () => {
    toast.success("Initializing Training Pipeline...");
    try {
      await startTraining({ modelType: model.architecture || model.id, symbol: "MNQ" } as any);
      toast.success("Training run dispatched to GPU workers");
    } catch (err: any) {
      toast.error(err.message || "Failed to start training");
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 h-full p-2">
      {/* Configuration Panel */}
      <div className="w-full md:w-80 flex flex-col gap-6">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
            <Database className="w-4 h-4" /> Data & Features
          </h3>
          
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Ingestion Engine</Label>
            <Select value={dataSource} onValueChange={setDataSource}>
              <SelectTrigger className="h-8 text-xs bg-muted/20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="timescaledb-realtime">TimescaleDB (High-Frequency L2)</SelectItem>
                <SelectItem value="duckdb-lake">DuckDB (Batch Parquet Lake)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Feature Pipeline</Label>
            <Select value={featureSet} onValueChange={setFeatureSet}>
              <SelectTrigger className="h-8 text-xs bg-muted/20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard-ohlcv">First-Principles OHLCV</SelectItem>
                <SelectItem value="microstructure">Market Microstructure</SelectItem>
                <SelectItem value="volatility">Stochastic Volatility</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Target Predictand</Label>
            <Select value={targetLabel} onValueChange={setTargetLabel}>
              <SelectTrigger className="h-8 text-xs bg-muted/20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ret-log-1m">RET_LOG_1M (1m Forward Return)</SelectItem>
                <SelectItem value="ret-log-5m-vol-adj">RET_LOG_5M_VOL_ADJ (Sharpe-Scaled)</SelectItem>
                <SelectItem value="structural-pivot">STRUCTURAL_PIVOT_PROB</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border/50">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-primary">
            <Network className="w-4 h-4" /> Optimization
          </h3>
          
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Bayesian HPO (Sweep)</Label>
            <Switch checked={hpoEnabled} onCheckedChange={setHpoEnabled} />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Walk-Forward Folds</Label>
            <Input 
              type="number" 
              value={wfvFolds} 
              onChange={e => setWfvFolds(e.target.value)} 
              className="h-8 text-xs bg-muted/20"
              min="1"
              max="20"
            />
          </div>
        </div>

        <Button 
          size="lg" 
          onClick={handleLaunch}
          disabled={isTraining}
          className="mt-4 w-full shadow-[0_0_15px_rgba(230,159,0,0.2)] hover:shadow-[0_0_25px_rgba(230,159,0,0.4)] transition bg-[#E69F00] hover:bg-[#E69F00]/90 text-black font-bold"
        >
          <Play className="w-4 h-4 mr-2" />
          {isTraining ? "Training Active..." : "Launch Run (24 Cores)"}
        </Button>
      </div>

      {/* DAG Visualization Canvas */}
      <div className="flex-1 rounded-md border border-border/50 bg-neutral-950 flex flex-col relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full p-3 border-b border-border/30 bg-neutral-900/50 flex items-center justify-between z-10">
          <span className="text-xs font-mono text-muted-foreground flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5" /> Pipeline Topology DAG
          </span>
          <Badge variant="outline" className="text-[10px] text-[#E69F00] border-[#E69F00]/30">Probabilistic Heads Enabled</Badge>
        </div>
        
        {/* Mock DAG Node Canvas */}
        <div className="flex-1 p-8 flex flex-col items-center justify-center gap-8 relative mt-10">
          {/* Edge line */}
          <div className="absolute left-1/2 top-8 bottom-8 w-px bg-blue-500/20 -z-10" />
          
          <Card className="w-64 p-3 bg-neutral-900 border-blue-900/50 shadow-lg text-center relative">
            <div className="absolute -top-2 -right-2 bg-blue-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded">Source</div>
            <Server className="w-5 h-5 mx-auto mb-2 text-blue-400" />
            <h4 className="text-xs font-semibold">{dataSource.toUpperCase()}</h4>
            <p className="text-[10px] text-muted-foreground mt-1">Zero-copy Arrow IPC</p>
          </Card>
          
          <Card className="w-64 p-3 bg-neutral-900 border-amber-900/50 shadow-lg text-center relative">
            <div className="absolute -top-2 -right-2 bg-amber-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded">Transforms</div>
            <Layers className="w-5 h-5 mx-auto mb-2 text-amber-400" />
            <h4 className="text-xs font-semibold">{featureSet.toUpperCase()}</h4>
            <p className="text-[10px] text-muted-foreground mt-1">Vectorized Polars LazyFrame</p>
          </Card>
          
          <Card className="w-64 p-3 bg-neutral-900 border-[#E69F00]/30 shadow-lg text-center relative">
            <div className="absolute -top-2 -right-2 bg-[#E69F00] text-black text-[9px] font-bold px-1.5 py-0.5 rounded">Target</div>
            <LineChart className="w-5 h-5 mx-auto mb-2 text-[#E69F00]" />
            <h4 className="text-xs font-semibold">{targetLabel.toUpperCase()}</h4>
            <p className="text-[10px] text-muted-foreground mt-1">Gaussian NLL Probabilistic</p>
          </Card>

          <Card className="w-64 p-3 bg-neutral-900 border-purple-900/50 shadow-lg text-center relative">
            <div className="absolute -top-2 -right-2 bg-purple-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">Architecture</div>
            <Brain className="w-5 h-5 mx-auto mb-2 text-purple-400" />
            <h4 className="text-xs font-semibold truncate px-2">{model.name}</h4>
            <p className="text-[10px] text-muted-foreground mt-1">{hpoEnabled ? 'Bayesian Sweep (Ray Tune)' : `Static WFV (${wfvFolds} Folds)`}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}


