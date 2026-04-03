/**
 * ModelPicker — Model type selector + dynamic hyperparameter form.
 *
 * Reads available models from the training config API. Each model
 * defines its own hyperparameters (min, max, step, label) in
 * config/models.json. The form renders inputs dynamically.
 */

import { useState, useMemo } from "react";
import { ChevronUp, Play, Square, Settings2, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelRegistryEntry, HyperparameterDef } from "@shared/trainingTypes";

/** Distinct accent color per model type (dot + ring). */
const MODEL_COLORS: Record<string, { dot: string; ring: string; text: string }> = {
};
const DEFAULT_COLOR = { dot: "bg-cyan-500", ring: "ring-cyan-500/30", text: "text-cyan-400" };

interface ModelPickerProps {
  models: Record<string, ModelRegistryEntry>;
  selectedModel: string;
  onSelectModel: (modelType: string) => void;
  hyperparameterOverrides: Record<string, number | string | boolean>;
  onHyperparameterChange: (key: string, value: number | string | boolean) => void;
  isTraining: boolean;
  isPending: boolean;
  onTrain: () => void;
  onStop: () => void;
  symbol: string;
  timeframe: string;
  progress: number;
  phase: string;
  error?: string | null;
}

export default function ModelPicker({
  models,
  selectedModel,
  onSelectModel,
  hyperparameterOverrides,
  onHyperparameterChange,
  isTraining,
  isPending,
  onTrain,
  onStop,
  symbol,
  timeframe,
  progress,
  phase,
  error,
}: ModelPickerProps) {
  const [showConfig, setShowConfig] = useState(false);

  const modelEntry = models[selectedModel];
  const modelList = useMemo(() => Object.entries(models), [models]);

  if (!modelEntry) return null;

  const hyperparams = modelEntry.defaultHyperparameters ?? {};

  return (
    <div className="space-y-3">
      {/* Model selector + train button row */}
      <div className="flex items-center gap-2">
        {/* Model dropdown */}
        <Select value={selectedModel} onValueChange={onSelectModel} disabled={isTraining}>
          <SelectTrigger className="flex-1 bg-white/5 border-white/10 rounded-lg text-sm focus:ring-1 focus:ring-orange-500/50">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full shrink-0 ${(MODEL_COLORS[selectedModel] ?? DEFAULT_COLOR).dot}`} />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent className="bg-[#1a1a2e] border-white/10">
            {modelList.map(([key, model]) => {
              const c = MODEL_COLORS[key] ?? DEFAULT_COLOR;
              return (
                <SelectItem key={key} value={key} className="py-2">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${c.dot} ring-2 ${c.ring}`} />
                    <div>
                      <div className="text-sm font-medium">{model.name}</div>
                      <div className="text-[10px] text-muted-foreground/60">
                        {model.category} · {model.runner}
                      </div>
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {/* Config toggle */}
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="p-2 rounded-lg border border-white/10 hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
          title="Configure hyperparameters"
        >
          <Settings2 className="h-4 w-4" />
        </button>

        {/* Train / Stop button */}
        <button
          onClick={isTraining ? onStop : onTrain}
          disabled={isPending}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
            isTraining
              ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border border-rose-500/30"
              : isPending
                ? "bg-orange-500/10 text-orange-400/60 border border-orange-500/20 cursor-wait"
                : "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border border-orange-500/30"
          }`}
        >
          {isTraining ? (
            <>
              <Square className="h-3.5 w-3.5" />
              Stop
            </>
          ) : isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              Train
            </>
          )}
        </button>
      </div>

      {/* Training status strip */}
      {(isTraining || isPending) && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20">
          <div className="h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
          <span className="text-xs text-orange-400/80 font-mono">
            {symbol} {timeframe} — {phase || "starting"} {progress > 0 ? `${progress.toFixed(0)}%` : ""}
          </span>
          {progress > 0 && (
            <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500/60 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {error && !isTraining && !isPending && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
          {error}
        </div>
      )}

      {/* Model info badges */}
      {(() => {
        const c = MODEL_COLORS[selectedModel] ?? DEFAULT_COLOR;
        return (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
            <span className={`px-1.5 py-0.5 rounded bg-white/5 ${c.text} font-medium`}>{modelEntry.category}</span>
            <span className="px-1.5 py-0.5 rounded bg-white/5">{modelEntry.subcategory}</span>
            <span className="px-1.5 py-0.5 rounded bg-white/5">{modelEntry.runner}</span>
            <span className="px-1.5 py-0.5 rounded bg-white/5">{modelEntry.chartOverlay}</span>
          </div>
        );
      })()}

      {/* Hyperparameter config panel */}
      {showConfig && (
        <div className="space-y-2 p-3 rounded-lg border border-white/6 bg-white/2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
              Hyperparameters
            </span>
            <button
              onClick={() => setShowConfig(false)}
              className="text-muted-foreground/40 hover:text-muted-foreground"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
          </div>

          {Object.entries(hyperparams).map(([key, def]) => (
            <HyperparamInput
              key={key}
              paramKey={key}
              def={def}
              value={hyperparameterOverrides[key] ?? def.default}
              onChange={(val) => onHyperparameterChange(key, val)}
              disabled={isTraining}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Individual Hyperparameter Input ─────────────────────────────────────────

function HyperparamInput({
  paramKey: _paramKey,
  def,
  value,
  onChange,
  disabled,
}: {
  paramKey: string;
  def: HyperparameterDef;
  value: number | string | boolean;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  const numValue = typeof value === "number" ? value : Number(def.default);

  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-muted-foreground w-40 shrink-0 truncate" title={def.label}>
        {def.label}
      </label>
      <input
        type="range"
        min={def.min ?? 0}
        max={def.max ?? 100}
        step={def.step ?? 1}
        value={numValue}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="flex-1 h-1 accent-orange-500 disabled:opacity-40"
      />
      <span className="text-xs font-mono text-foreground/80 w-16 text-right">
        {(def.step ?? 1) < 1 ? numValue.toFixed(2) : numValue}
      </span>
    </div>
  );
}
