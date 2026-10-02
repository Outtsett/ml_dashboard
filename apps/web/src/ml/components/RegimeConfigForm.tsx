/**
 * RegimeConfig — Training configuration form for Regime Detection model.
 *
 * Think of it as: the knobs on a "market mood detector" — you tell it which
 * market to scan, how many sampling passes to run, and how sticky vs. jumpy
 * the regimes should be.
 */

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Progress } from "@/shared/ui/progress";
import { Play, Square, Layers, ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import type { RegimeConfig as RegimeConfigState } from "./useRegimeAnalytics";
import type { TrainingProgress } from "@/ml/components/regime-analytics/types";

interface RegimeConfigProps {
  config: RegimeConfigState;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  isTraining: boolean;
  progress: TrainingProgress | null;
  trainLogs: string[];
  trainError: string | null;
  onStart: () => void;
  onStop: () => void;
}

export function RegimeConfigForm({
  config,
  showAdvanced,
  onToggleAdvanced,
  isTraining,
  progress,
  trainLogs,
  trainError,
  onStart,
  onStop,
}: RegimeConfigProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-orange-400" />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Regime Detection
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div>
          <label className="text-[9px] text-muted-foreground">Symbol</label>
          <Input
            value={config.selectedSymbol}
            onChange={e => config.setSelectedSymbol(e.target.value.toUpperCase())}
            className="h-6 text-[10px] bg-black/30 border-white/10 px-2"
            disabled={isTraining}
          />
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground">Timeframe</label>
          <Select value={config.selectedTimeframe} onValueChange={config.setSelectedTimeframe} disabled={isTraining}>
            <SelectTrigger className="h-6 text-[10px] bg-black/30 border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["1m", "5m", "15m", "30m", "1h", "4h", "1d"].map(tf => (
                <SelectItem key={tf} value={tf} className="text-xs">{tf}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[9px] text-muted-foreground">Gibbs Iter</label>
          <Input
            type="number"
            value={config.gibbsIter}
            onChange={e => config.setGibbsIter(Math.max(30, Math.min(500, parseInt(e.target.value) || 100)))}
            className="h-6 text-[10px] bg-black/30 border-white/10 px-2"
            min={30} max={500}
            disabled={isTraining}
          />
        </div>
      </div>

      {/* Advanced config toggle */}
      <button
        className="flex items-center gap-1 text-[8px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        onClick={onToggleAdvanced}
      >
        <Settings2 className="h-2.5 w-2.5" />
        <span>{showAdvanced ? "Hide" : "Show"} Validation Settings</span>
        {showAdvanced ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
      </button>

      {showAdvanced && (
        <div className="space-y-1.5 p-2 rounded-lg bg-black/20 border border-white/5">
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <label className="text-[8px] text-muted-foreground">Burn-In</label>
              <Input
                type="number"
                value={config.burnIn}
                onChange={e => config.setBurnIn(Math.max(10, Math.min(200, parseInt(e.target.value) || 30)))}
                className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                min={10} max={200}
                disabled={isTraining}
              />
            </div>
            <div>
              <label className="text-[8px] text-muted-foreground">Test Split</label>
              <Input
                type="number"
                value={config.testSplit}
                onChange={e => config.setTestSplit(Math.max(0.05, Math.min(0.5, parseFloat(e.target.value) || 0.15)))}
                className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                step={0.05}
                min={0.05} max={0.5}
                disabled={isTraining}
              />
            </div>
            <div>
              <label className="text-[8px] text-muted-foreground">WF Windows</label>
              <Input
                type="number"
                value={config.wfWindows}
                onChange={e => config.setWfWindows(Math.max(2, Math.min(10, parseInt(e.target.value) || 5)))}
                className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                min={2} max={10}
                disabled={isTraining}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <label className="text-[8px] text-muted-foreground" title="Transition concentration - higher = more regime diversity">Alpha</label>
              <Input
                type="number"
                value={config.alpha}
                onChange={e => config.setAlpha(Math.max(0.1, Math.min(50, parseFloat(e.target.value) || 1.0)))}
                className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                step={0.5}
                min={0.1} max={50}
                disabled={isTraining}
              />
            </div>
            <div>
              <label className="text-[8px] text-muted-foreground" title="DP concentration - higher = more new regimes">Gamma</label>
              <Input
                type="number"
                value={config.gamma}
                onChange={e => config.setGamma(Math.max(0.1, Math.min(50, parseFloat(e.target.value) || 5.0)))}
                className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                step={1}
                min={0.1} max={50}
                disabled={isTraining}
              />
            </div>
            <div>
              <label className="text-[8px] text-muted-foreground" title="Stickiness - higher = longer regime durations">Kappa</label>
              <Input
                type="number"
                value={config.kappa}
                onChange={e => config.setKappa(Math.max(1, Math.min(500, parseFloat(e.target.value) || 50)))}
                className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                step={10}
                min={1} max={500}
                disabled={isTraining}
              />
            </div>
          </div>
          <p className="text-[7px] text-muted-foreground/40 mt-1">Gamma = regime creation willingness | Kappa = regime persistence (stickiness)</p>
        </div>
      )}

      {/* Train / Stop button */}
      <Button
        size="sm"
        className={`w-full h-7 text-[10px] gap-1.5 ${isTraining
          ? "bg-[hsl(var(--data-neg)/0.2)] hover:bg-[hsl(var(--data-neg)/0.3)] text-[hsl(var(--data-neg))] border border-[hsl(var(--data-neg)/0.3)]"
          : "bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30"
        }`}
        variant="ghost"
        onClick={isTraining ? onStop : onStart}
      >
        {isTraining ? (
          <><Square className="h-3 w-3" /> Stop Training</>
        ) : (
          <><Play className="h-3 w-3" /> Train Regime Detection</>
        )}
      </Button>

      {/* Progress bar */}
      {isTraining && progress && (
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[9px] text-muted-foreground">{progress.message}</span>
            <span className="text-[9px] font-mono text-orange-400">{progress.pct}%</span>
          </div>
          <Progress value={progress.pct} className="h-1.5" />
        </div>
      )}

      {/* Training logs (last 3 lines) */}
      {trainLogs.length > 0 && (
        <div className="p-1.5 rounded bg-black/30 border border-white/5 max-h-[48px] overflow-hidden">
          {trainLogs.slice(-3).map((line, i) => (
            <p key={i} className="text-[8px] font-mono text-muted-foreground/70 truncate">{line}</p>
          ))}
        </div>
      )}

      {/* Error */}
      {trainError && (
        <div className="p-2 rounded bg-[hsl(var(--data-neg)/0.1)] border border-[hsl(var(--data-neg)/0.2)]">
          <p className="text-[9px] text-[hsl(var(--data-neg))]">{trainError}</p>
        </div>
      )}
    </div>
  );
}
