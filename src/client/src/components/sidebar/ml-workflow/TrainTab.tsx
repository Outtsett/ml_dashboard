/**
 * TrainTab — Training config, progress, loss sparkline, model info.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Brain, Loader2, Play, Square, ChevronDown, ChevronRight,
} from "lucide-react";
import type { TrainTabProps } from "./types";

export function TrainTab({
  isTraining, currentProgress, currentEpoch, totalEpochs, progressPct, lossHistory,
  pipeline, setPipeline, labelType, setLabelType,
  epochs, setEpochs, batchSize, setBatchSize,
  showAdvanced, setShowAdvanced,
  maxBars, setMaxBars, timeframeSec, setTimeframeSec,
  labelHorizon, setLabelHorizon, labelAtrMultiplier, setLabelAtrMultiplier,
  labelNumClasses, setLabelNumClasses,
  takeProfitATR, setTakeProfitATR, stopLossATR, setStopLossATR,
  maxHoldingPeriod, setMaxHoldingPeriod,
  onStartTraining, isStartingTraining, onStopTraining, isStoppingTraining,
  symbol, activeModelName, mlModels,
}: TrainTabProps) {
  return (
    <div className="p-3 space-y-3">
      {/* Status badge */}
      <div className="flex items-center gap-2">
        <Brain className={`h-4 w-4 ${isTraining ? 'text-emerald-400 pulse-slow' : 'text-muted-foreground'}`} />
        <span className={`text-xs font-medium ${isTraining ? 'text-emerald-400' : 'text-muted-foreground'}`}>
          {isTraining ? 'Training Active' : 'Ready'}
        </span>
        {isTraining && (
          <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 ml-auto">
            E{currentEpoch}/{totalEpochs}
          </Badge>
        )}
      </div>

      {/* Progress bar (visible during training) */}
      {isTraining && (
        <div className="space-y-1.5">
          <Progress value={progressPct} className="h-2" />
          <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
            <span>Loss: {currentProgress?.loss?.toFixed(4) || '--'}</span>
            <span>Val: {currentProgress?.valLoss?.toFixed(4) || '--'}</span>
            <span>Acc: {currentProgress?.accuracy ? (currentProgress.accuracy * 100).toFixed(1) + '%' : '--'}</span>
          </div>
          {/* Mini loss sparkline */}
          {lossHistory.length > 1 && (
            <div className="h-10 flex items-end gap-px">
              {lossHistory.slice(-30).map((h, i) => {
                const maxLoss = Math.max(...lossHistory.slice(-30).map(l => l.loss));
                const pct = maxLoss > 0 ? (h.loss / maxLoss) * 100 : 0;
                return (
                  <div
                    key={i}
                    className="flex-1 bg-emerald-500/40 rounded-t-[1px] min-w-[2px]"
                    style={{ height: `${Math.max(5, pct)}%` }}
                    title={`E${h.epoch}: ${h.loss.toFixed(4)}`}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Training config (only when not training) */}
      {!isTraining && (
        <div className="space-y-2.5">
          {/* Pipeline */}
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Pipeline</label>
            <Select value={pipeline} onValueChange={(v) => setPipeline(v as any)}>
              <SelectTrigger className="h-7 text-[10px] bg-black/30 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="universal" className="text-xs">Universal (31 features)</SelectItem>
                <SelectItem value="legacy" className="text-xs">Legacy (5 OHLCV)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Label type */}
          {pipeline === 'universal' && (
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Label Type</label>
              <Select value={labelType} onValueChange={(v) => setLabelType(v as any)}>
                <SelectTrigger className="h-7 text-[10px] bg-black/30 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direction" className="text-xs">Direction</SelectItem>
                  <SelectItem value="triple_barrier" className="text-xs">Triple Barrier</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Epochs + Batch */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Epochs</label>
              <Input
                type="number"
                value={epochs}
                onChange={e => setEpochs(parseInt(e.target.value) || 50)}
                className="h-7 text-[10px] bg-black/30 border-white/10"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Batch</label>
              <Input
                type="number"
                value={batchSize}
                onChange={e => setBatchSize(parseInt(e.target.value) || 32)}
                className="h-7 text-[10px] bg-black/30 border-white/10"
              />
            </div>
          </div>

          {/* Advanced toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-6 text-[10px] text-muted-foreground hover:text-primary"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
            Advanced Config
          </Button>

          {showAdvanced && pipeline === 'universal' && (
            <div className="space-y-2 p-2 rounded-lg bg-white/5 border border-white/5">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Max Bars</label>
                  <Input type="number" value={maxBars} onChange={e => setMaxBars(parseInt(e.target.value) || 100000)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">TF (sec)</label>
                  <Input type="number" value={timeframeSec} onChange={e => setTimeframeSec(parseInt(e.target.value) || 300)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                </div>
              </div>
              {labelType === 'direction' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Horizon</label>
                    <Input type="number" value={labelHorizon} onChange={e => setLabelHorizon(parseInt(e.target.value) || 10)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">ATR Mult</label>
                    <Input type="number" step="0.1" value={labelAtrMultiplier} onChange={e => setLabelAtrMultiplier(parseFloat(e.target.value) || 0.5)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] text-muted-foreground">Classes</label>
                    <Select value={String(labelNumClasses)} onValueChange={v => setLabelNumClasses(Number(v) as 2 | 3)}>
                      <SelectTrigger className="h-6 text-[10px] bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2" className="text-xs">2 (Up/Down)</SelectItem>
                        <SelectItem value="3" className="text-xs">3 (Up/Down/Hold)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">TP ATR</label>
                    <Input type="number" step="0.1" value={takeProfitATR} onChange={e => setTakeProfitATR(parseFloat(e.target.value) || 2.0)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">SL ATR</label>
                    <Input type="number" step="0.1" value={stopLossATR} onChange={e => setStopLossATR(parseFloat(e.target.value) || 1.0)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-[10px] text-muted-foreground">Max Hold</label>
                    <Input type="number" value={maxHoldingPeriod} onChange={e => setMaxHoldingPeriod(parseInt(e.target.value) || 20)} className="h-6 text-[10px] bg-black/30 border-white/10" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Train / Stop button */}
      {!isTraining ? (
        <Button
          onClick={onStartTraining}
          disabled={isStartingTraining}
          className="w-full h-8 text-xs bg-linear-to-r from-emerald-600 to-teal-500 hover:opacity-90"
        >
          {isStartingTraining ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Play className="h-3 w-3 mr-1.5" />}
          Train {symbol}
        </Button>
      ) : (
        <Button
          variant="destructive"
          onClick={onStopTraining}
          disabled={isStoppingTraining}
          className="w-full h-8 text-xs"
        >
          <Square className="h-3 w-3 mr-1.5" /> Stop Training
        </Button>
      )}

      {/* Model info */}
      <div className="p-2 rounded-lg bg-white/5 space-y-1">
        <p className="text-[10px] text-muted-foreground">Active Model</p>
        <p className="font-mono text-xs text-primary">{activeModelName}</p>
        {mlModels.filter(m => m.name.includes(symbol)).length > 0 && (
          <p className="text-[9px] text-muted-foreground">
            {mlModels.filter(m => m.name.includes(symbol)).length} model{mlModels.filter(m => m.name.includes(symbol)).length !== 1 ? 's' : ''} for {symbol}
          </p>
        )}
      </div>
    </div>
  );
}
