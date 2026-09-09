import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { HyperparameterForm, type HyperparameterConfig, type HyperparameterValue } from "./HyperparameterForm";
import type { CatalogModelDetail } from "@/ml/lib/catalog_types";
import { Checkbox } from "@/shared/ui/checkbox";
import { toast } from "sonner";
import { Play, Beaker, Settings, Database, Server, Activity } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { errorMessage } from "@/shared/utils/errorMessage";

/**
 * One entry of the feature store, as `/api/features/available` returns it —
 * the fields this wizard renders.
 */
interface FeatureStoreEntry {
  id: string;
  name: string;
  category?: string;
}

interface ModelWizardProps {
  model: CatalogModelDetail;
  isOpen: boolean;
  onClose: () => void;
}

export function ModelWizard({ model, isOpen, onClose }: ModelWizardProps) {
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  
  // Available features loaded from backend Feature Store API
  const [availableFeatures, setAvailableFeatures] = useState<FeatureStoreEntry[]>([]);
  const [availableTargets, setAvailableTargets] = useState<FeatureStoreEntry[]>([]);
  
  // State: Stage 1 (Data)
  const [dataset, setDataset] = useState("curated/bars/asset_class=futures/root=MNQ/timeframe=1m");
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [targetVariable, setTargetVariable] = useState("");
  
  // WFV State
  const [wfvFolds, setWfvFolds] = useState<number>(5);
  const [wfvTrainPct, setWfvTrainPct] = useState<number>(65);
  const [wfvValPct, setWfvValPct] = useState<number>(20);
  const [wfvTestPct, setWfvTestPct] = useState<number>(15);
  
  // State: Stage 2 (Hyperparameters)
  const [hpConfig, setHpConfig] = useState<Record<string, HyperparameterValue>>({});
  
  // State: Stage 3 (Execution)
  const [wandbProject, setWandbProject] = useState(`MLOps_${model.name}`);
  const [useAmp, setUseAmp] = useState(true);

  // State: Execution Risk
  const [initialCapital, setInitialCapital] = useState<number>(10000);
  const [slippageBps, setSlippageBps] = useState<number>(1.0);
  const [commissionBps, setCommissionBps] = useState<number>(0.5);
  const [riskFraction, setRiskFraction] = useState<number>(0.02);

  // Load features on mount
  useEffect(() => {
    fetch("/api/features/available")
      .then(res => res.json())
      .then(data => {
        setAvailableFeatures(data.features || []);
        setAvailableTargets(data.targets || []);
      })
      .catch(err => console.error("Failed to load feature store", err));
  }, []);

  // Initialize hyperparams
  useEffect(() => {
    if (model.hyperparameters) {
      const init: Record<string, HyperparameterValue> = {};
      model.hyperparameters.forEach(hp => {
        init[hp.name] = hp.default;
      });
      setHpConfig(init);
    }
  }, [model]);

  const handleLaunch = async () => {
    try {
      const isSweep = Object.keys(hpConfig).some(k => k.endsWith('_isSweep') && hpConfig[k] === true);
      
      const payload = {
        model: model.id,
        dataset,
        features: {
          selected: selectedFeatures,
          target: targetVariable
        },
        hyperparameters: hpConfig,
        validation: { 
          split: `${wfvTrainPct}/${wfvValPct}/${wfvTestPct}`,
          folds: wfvFolds
        },
        execution: { 
          wandbProject, 
          useAmp,
          risk: {
            initialCapital,
            slippageBps,
            commissionBps,
            riskFraction
          }
        },
        isSweep
      };

      const res = await fetch("/api/experiments/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      
      toast.success(`Job ${data.jobId} launched successfully!`);
      onClose();
    } catch (err) {
      toast.error(`Failed to launch job: ${errorMessage(err)}`);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-background/95 backdrop-blur-md border border-primary/20 shadow-2xl">
        <div className="p-6 pb-2 border-b border-border/50 bg-muted/10">
          <DialogTitle className="text-xl font-display flex items-center gap-2">
            <Beaker className="w-5 h-5 text-primary" />
            Configure & Train: {model.name}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Configure your dataset, feature store inputs, and hyperparameter tuning parameters.
          </DialogDescription>
          
          {/* Stage indicator */}
          <div className="flex items-center gap-2 mt-6">
            <div className={`flex-1 h-1 rounded-full ${stage >= 1 ? 'bg-primary' : 'bg-muted'}`} />
            <div className={`flex-1 h-1 rounded-full ${stage >= 2 ? 'bg-primary' : 'bg-muted'}`} />
            <div className={`flex-1 h-1 rounded-full ${stage >= 3 ? 'bg-primary' : 'bg-muted'}`} />
          </div>
          <div className="flex justify-between mt-2 px-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            <span className={stage >= 1 ? 'text-primary' : ''}>1. Data & Features</span>
            <span className={stage >= 2 ? 'text-primary' : ''}>2. Hyperparameters</span>
            <span className={stage >= 3 ? 'text-primary' : ''}>3. Execution</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {stage === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-3">
                <Label className="flex items-center gap-2 text-primary">
                  <Database className="w-4 h-4" />
                  Data Lakehouse Source
                </Label>
                <Input 
                  value={dataset} 
                  onChange={(e) => setDataset(e.target.value)} 
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">Path to the Parquet dataset (e.g., D:\ml_data\...).</p>
              </div>

              <div className="space-y-3">
                <Label>Target Variable</Label>
                <Select value={targetVariable} onValueChange={setTargetVariable}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select prediction target" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTargets.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name} ({t.id})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label>Feature Store Components</Label>
                <div className="grid grid-cols-2 gap-3 border border-border/50 p-4 rounded-md bg-muted/5 max-h-[200px] overflow-y-auto">
                  {availableFeatures.map(f => (
                    <div key={f.id} className="flex items-start space-x-2">
                      <Checkbox 
                        id={f.id} 
                        checked={selectedFeatures.includes(f.id)}
                        onCheckedChange={(c) => {
                          if (c) setSelectedFeatures([...selectedFeatures, f.id]);
                          else setSelectedFeatures(selectedFeatures.filter(id => id !== f.id));
                        }}
                      />
                      <div className="grid gap-1.5 leading-none">
                        <label htmlFor={f.id} className="text-sm font-medium leading-none cursor-pointer">
                          {f.name}
                        </label>
                        <p className="text-[10px] text-muted-foreground">
                          {f.category}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-border/50">
                <Label className="flex items-center gap-2 text-primary">
                  <Settings className="w-4 h-4" />
                  Walk-Forward Validation (IS / OOS)
                </Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Number of Folds</Label>
                    <Input 
                      type="number" 
                      value={wfvFolds} 
                      onChange={(e) => setWfvFolds(Number(e.target.value))} 
                      className="font-mono text-sm"
                      min={1}
                      max={20}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Train / Val / Test (%)</Label>
                    <div className="flex items-center gap-2">
                      <Input 
                        type="number" 
                        value={wfvTrainPct} 
                        onChange={(e) => setWfvTrainPct(Number(e.target.value))} 
                        className="font-mono text-sm text-center px-1"
                        title="Train %"
                      />
                      <span className="text-muted-foreground">/</span>
                      <Input 
                        type="number" 
                        value={wfvValPct} 
                        onChange={(e) => setWfvValPct(Number(e.target.value))} 
                        className="font-mono text-sm text-center px-1"
                        title="Val %"
                      />
                      <span className="text-muted-foreground">/</span>
                      <Input 
                        type="number" 
                        value={wfvTestPct} 
                        onChange={(e) => setWfvTestPct(Number(e.target.value))} 
                        className="font-mono text-sm text-center px-1"
                        title="Test %"
                      />
                    </div>
                  </div>
                </div>
                { (wfvTrainPct + wfvValPct + wfvTestPct) !== 100 && (
                  <p className="text-xs text-destructive">Warning: Splits must sum to 100%. Currently: {wfvTrainPct + wfvValPct + wfvTestPct}%</p>
                )}
              </div>
            </div>
          )}

          {stage === 2 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between mb-4">
                <Label className="flex items-center gap-2 text-primary">
                  <Settings className="w-4 h-4" />
                  Hyperparameter & Sweep Config
                </Label>
              </div>
              <HyperparameterForm 
                hyperparameters={model.hyperparameters as unknown as HyperparameterConfig[]}
                value={hpConfig}
                onChange={(k, v) => setHpConfig(prev => ({ ...prev, [k]: v }))}
              />
            </div>
          )}

          {stage === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-3">
                <Label className="flex items-center gap-2 text-primary">
                  <Server className="w-4 h-4" />
                  W&B and Hardware Execution
                </Label>
                <Input 
                  value={wandbProject} 
                  onChange={(e) => setWandbProject(e.target.value)} 
                  className="font-mono text-sm"
                  placeholder="W&B Project Name"
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="useAmp" 
                  checked={useAmp}
                  onCheckedChange={(c) => setUseAmp(!!c)}
                />
                <div className="grid gap-1.5 leading-none">
                  <label htmlFor="useAmp" className="text-sm font-medium leading-none">
                    Enable Automatic Mixed Precision (AMP)
                  </label>
                  <p className="text-[10px] text-muted-foreground">
                    Drastically reduces VRAM footprint and speeds up execution on RTX series.
                  </p>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-border/50">
                <Label className="flex items-center gap-2 text-primary">
                  <Activity className="w-4 h-4" />
                  Trading Simulator Risk Settings
                </Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Initial Capital ($)</Label>
                    <Input 
                      type="number" 
                      value={initialCapital} 
                      onChange={(e) => setInitialCapital(Number(e.target.value))} 
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Risk Fraction / Trade</Label>
                    <Input 
                      type="number" 
                      value={riskFraction} 
                      onChange={(e) => setRiskFraction(Number(e.target.value))} 
                      className="font-mono text-sm"
                      step={0.01}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Slippage (bps)</Label>
                    <Input 
                      type="number" 
                      value={slippageBps} 
                      onChange={(e) => setSlippageBps(Number(e.target.value))} 
                      className="font-mono text-sm"
                      step={0.1}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Commission (bps)</Label>
                    <Input 
                      type="number" 
                      value={commissionBps} 
                      onChange={(e) => setCommissionBps(Number(e.target.value))} 
                      className="font-mono text-sm"
                      step={0.1}
                    />
                  </div>
                </div>
              </div>
              
              <div className="bg-primary/10 border border-primary/20 p-4 rounded-md mt-4">
                <h4 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
                  <Play className="w-4 h-4" /> Ready for Launch
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your job will be queued to the local Process Manager. If sweep ranges were provided, a W&B sweep agent process will automatically be spawned to distribute the workload.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border/50 bg-muted/10 flex justify-between items-center">
          <Button variant="ghost" onClick={() => {
            if (stage === 1) onClose();
            else setStage((s) => (s - 1) as 1 | 2 | 3);
          }}>
            {stage === 1 ? 'Cancel' : 'Back'}
          </Button>
          
          {stage < 3 ? (
            <Button onClick={() => setStage((s) => (s + 1) as 1 | 2 | 3)}>
              Next Step
            </Button>
          ) : (
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleLaunch}>
              <Play className="w-4 h-4 mr-2" />
              Launch Run
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
