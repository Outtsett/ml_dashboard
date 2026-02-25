/**
 * ModelPicker — Model type selector + dynamic hyperparameter form.
 *
 * Reads available models from the training config API. Each model
 * defines its own hyperparameters (min, max, step, label) in
 * config/models.json. The form renders inputs dynamically.
 */

import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, Play, Square, Settings2 } from "lucide-react";
import type { ModelRegistryEntry, HyperparameterDef } from "@shared/trainingTypes";

interface ModelPickerProps {
  models: Record<string, ModelRegistryEntry>;
  selectedModel: string;
  onSelectModel: (modelType: string) => void;
  hyperparameterOverrides: Record<string, number | string | boolean>;
  onHyperparameterChange: (key: string, value: number | string | boolean) => void;
  isTraining: boolean;
  onTrain: () => void;
  onStop: () => void;
  symbol: string;
  timeframe: string;
  progress: number;
  phase: string;
}

export default function ModelPicker({
  models,
  selectedModel,
  onSelectModel,
  hyperparameterOverrides,
  onHyperparameterChange,
  isTraining,
  onTrain,
  onStop,
  symbol,
  timeframe,
  progress,
  phase,
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
        <select
          value={selectedModel}
          onChange={(e) => onSelectModel(e.target.value)}
          disabled={isTraining}
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-orange-500/50 disabled:opacity-50"
        >
          {modelList.map(([key, model]) => (
            <option key={key} value={key}>
              {model.name}
            </option>
          ))}
        </select>

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
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
            isTraining
              ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border border-rose-500/30"
              : "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border border-orange-500/30"
          }`}
        >
          {isTraining ? (
            <>
              <Square className="h-3.5 w-3.5" />
              Stop
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
      {isTraining && (
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

      {/* Model info badge */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
        <span className="px-1.5 py-0.5 rounded bg-white/5">{modelEntry.category}</span>
        <span className="px-1.5 py-0.5 rounded bg-white/5">{modelEntry.subcategory}</span>
        <span className="px-1.5 py-0.5 rounded bg-white/5">{modelEntry.runner}</span>
        <span className="px-1.5 py-0.5 rounded bg-white/5">{modelEntry.chartOverlay}</span>
      </div>

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
              value={hyperparameterOverrides[key] ?? def.value}
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
  paramKey,
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
  const numValue = typeof value === "number" ? value : def.value;

  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-muted-foreground w-40 shrink-0 truncate" title={def.label}>
        {def.label}
      </label>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={numValue}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="flex-1 h-1 accent-orange-500 disabled:opacity-40"
      />
      <span className="text-xs font-mono text-foreground/80 w-16 text-right">
        {def.step < 1 ? numValue.toFixed(2) : numValue}
      </span>
    </div>
  );
}
