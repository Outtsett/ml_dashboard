import React, { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'wouter';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Play, Database, BrainCircuit, ActivitySquare } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Input } from '@/shared/ui/input';
import { useTrainableCatalog } from '@/ml/lib/useModelCatalog';
import { useSymbolContext } from '@/shared/contexts/SymbolContext';
import { useTrainingControl } from '@/training/lib/TrainingContext';
import { toast } from 'sonner';

export interface QuickTrainDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickTrainDrawer({ open, onOpenChange }: QuickTrainDrawerProps) {
  const [, setLocation] = useLocation();
  const { symbol, timeframeMinutes } = useSymbolContext();
  const { data: catalog, isLoading } = useTrainableCatalog();
  const { startTraining } = useTrainingControl();

  const [modelType, setModelType] = useState<string>('');
  const [hyperparameters, setHyperparameters] = useState<Record<string, number | string | boolean>>({});
  
  // Select first model by default if not set
  useEffect(() => {
    if (catalog && !modelType) {
      const first = Object.keys(catalog)[0];
      if (first) {
        setModelType(first);
      }
    }
  }, [catalog, modelType]);

  // Sync hyperparams when modelType changes
  const entry = useMemo(() => (catalog && modelType ? catalog[modelType] : null), [catalog, modelType]);
  useEffect(() => {
    if (entry) {
      const defaults: Record<string, number | string | boolean> = {};
      for (const [key, def] of Object.entries(entry.defaultHyperparameters)) {
        defaults[key] = def.default;
      }
      setHyperparameters(defaults);
    }
  }, [entry, modelType]);

  const handleTrain = async () => {
    if (!modelType || !entry) return;
    
    // Map minutes back to string timeframe (e.g. 1m, 5m)
    const tfs: Record<number, string> = { 1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 240: "4h", 1440: "1d", 10080: "1w" };
    const timeframe = tfs[timeframeMinutes] || "1m";

    try {
      await startTraining({
        modelType,
        symbol,
        timeframe,
        hyperparameters,
        featureCategories: [],
      });
      toast.success("Training started!");
      onOpenChange(false);
      // Automatically route to live execution to watch it
      setLocation("/live-execution");
    } catch (e) {
      toast.error("Failed to start training", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed right-0 top-0 z-50 h-full w-[450px] max-w-[90vw] border-l border-white/10 bg-neutral-950 p-6 shadow-2xl duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right flex flex-col gap-6 overflow-hidden">
          
          <div className="flex items-center justify-between shrink-0">
            <Dialog.Title className="text-lg font-semibold text-white flex items-center gap-2">
              <Play className="h-5 w-5 text-amber-500" fill="currentColor" />
              Quick Train Model
            </Dialog.Title>
            <Dialog.Close className="rounded-full p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 space-y-6">
            
            {/* Target Data */}
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold flex items-center gap-2">
                <Database className="h-3.5 w-3.5" /> Target Data
              </div>
              <div className="grid grid-cols-2 gap-4 p-3 rounded-lg border border-white/5 bg-white/[0.02]">
                <div>
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Symbol</div>
                  <div className="text-sm font-mono text-yellow-500">{symbol}</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Timeframe</div>
                  <div className="text-sm font-mono text-white">{timeframeMinutes} min</div>
                </div>
              </div>
            </div>

            {/* Architecture */}
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold flex items-center gap-2">
                <BrainCircuit className="h-3.5 w-3.5" /> Architecture
              </div>
              <Select value={modelType} onValueChange={setModelType} disabled={isLoading}>
                <SelectTrigger className="w-full bg-black/40 border-white/10 text-white">
                  <SelectValue placeholder="Select model..." />
                </SelectTrigger>
                <SelectContent>
                  {catalog && Object.entries(catalog).map(([key, model]) => (
                    <SelectItem key={key} value={key}>{model.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Feature Configuration */}
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold flex items-center gap-2">
                <ActivitySquare className="h-3.5 w-3.5" /> Features & Columns
              </div>
              <div className="rounded-lg border border-white/5 bg-black/40 p-3 max-h-[150px] overflow-y-auto">
                {entry?.featurePipeline ? (
                  <div className="text-xs text-neutral-400 space-y-2">
                    <p>Uses <strong className="text-white">"{entry.featurePipeline}"</strong> pipeline mapping.</p>
                    <p className="text-[11px] leading-relaxed">
                      Features are auto-mapped from OHLCV and volume schemas. 
                      Standard inputs: open, high, low, close, volume.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500 italic">Select a model to see expected features.</p>
                )}
              </div>
            </div>

            {/* Hyperparameters */}
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold">
                Hyperparameters
              </div>
              <div className="grid grid-cols-2 gap-3">
                {entry && Object.entries(entry.defaultHyperparameters).map(([key, def]) => {
                  // Only rendering standard numeric hyperparams for simplicity in the quick-train drawer
                  if (def.type === 'int' || def.type === 'float') {
                    return (
                      <div key={key} className="space-y-1.5">
                        <label className="text-[10px] text-neutral-400 uppercase tracking-wider">{def.label}</label>
                        <Input 
                          type="number"
                          className="h-8 bg-black/40 border-white/10 text-xs font-mono text-white"
                          value={(hyperparameters[key] as number | undefined) ?? ''}
                          onChange={(e) => setHyperparameters({ ...hyperparameters, [key]: Number(e.target.value) })}
                          min={def.min}
                          max={def.max}
                          step={def.step ?? (def.type === 'int' ? 1 : 0.01)}
                        />
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>

          </div>

          <div className="pt-4 border-t border-white/10 shrink-0">
            <Button 
              className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold tracking-wide h-12"
              onClick={handleTrain}
              disabled={!entry}
            >
              <Play className="h-4 w-4 mr-2" fill="currentColor" /> START TRAINING
            </Button>
            <p className="text-[10px] text-neutral-500 text-center mt-3">
              This will automatically navigate to Live Execution
            </p>
          </div>
          
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
