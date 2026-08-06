import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Play, Square, Loader2, ChevronUp, Settings2 } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import HyperparameterForm from "./HyperparameterForm";
import { useTrainingConfig } from "@/training/lib/useTrainingConfig";
import type {
  AlgorithmEntry,
  ModelRegistryEntry,
  RunnerEntry,
  TaskEntry,
} from "@shared/trainingTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConfigStripProps {
  selectedModelType: string;
  availableModels: Record<string, ModelRegistryEntry>;
  onModelTypeChange: (type: string) => void;
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  hyperparameters: Record<string, number | string | boolean>;
  onHyperparameterChange: (key: string, value: number | string | boolean) => void;
  onResetHyperparameters: () => void;
  isTraining: boolean;
  isPending: boolean;
  progress: number;
  elapsedSec: number;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEFRAME_OPTIONS = [
  { value: "1m",  label: "1m"  },
  { value: "5m",  label: "5m"  },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h",  label: "1h"  },
  { value: "4h",  label: "4h"  },
  { value: "1d",  label: "1d"  },
  { value: "1w",  label: "1w"  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

/** Format a param value compactly for the summary chips. */
function formatParamValue(val: number | string | boolean): string {
  if (typeof val === "boolean") return val ? "T" : "F";
  if (typeof val === "number") {
    // Show up to 4 significant digits without trailing zeros
    return parseFloat(val.toPrecision(4)).toString();
  }
  return String(val);
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function Card({
  className,
  children,
  onClick,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border",
        "bg-white/5 border-white/10",
        onClick && "cursor-pointer select-none hover:bg-white/[0.07] hover:border-white/20 transition-colors",
        className,
      )}
      onClick={onClick}
      title={title}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-medium leading-none">
      {children}
    </span>
  );
}

// ─── Algorithm + Task split picker ────────────────────────────────────────────
//
// As of 2026-05-09, the Train stage decouples "what algorithm" from "what it's
// for". Runners are keyed by `${algorithm}+${task}` composite IDs. The two
// dropdowns here resolve to that composite key and feed the unchanged
// onModelTypeChange contract — so downstream (orchestrator, SSE, storage)
// sees no shape difference, only a more structured key.
//
// Falls back to the legacy single dropdown when the server returns an empty
// `algorithms` map (i.e. the new files don't exist yet and the registry is
// still loading from legacy models.json).
//
// Composite key parsing: split on the FIRST '+'. Algorithm IDs can never
// contain '+', task IDs can never contain '+'. (Enforced by file authorship —
// not validated at runtime to keep this hot path branch-free.)

function parseComposite(modelType: string): { algorithmId: string; taskId: string } | null {
  if (!modelType) return null;
  const plus = modelType.indexOf("+");
  if (plus < 0) return null;
  return { algorithmId: modelType.slice(0, plus), taskId: modelType.slice(plus + 1) };
}

function ModelCard({
  selectedModelType,
  availableModels,
  onModelTypeChange,
  disabled,
}: Pick<ConfigStripProps, "selectedModelType" | "availableModels" | "onModelTypeChange" | "disabled">) {
  const { data: trainingConfig } = useTrainingConfig();
  const algorithms: Record<string, AlgorithmEntry> = trainingConfig?.algorithms ?? {};
  const tasks: Record<string, TaskEntry> = trainingConfig?.tasks ?? {};
  const runners: Record<string, RunnerEntry> = trainingConfig?.runners ?? {};
  const aliases: Record<string, string> = trainingConfig?.aliases ?? {};

  // If the new 3-file source is missing OR the user picked a key that doesn't
  // parse as composite (and no alias resolves it), fall back to the legacy
  // single-select. This keeps test fixtures + ad-hoc deployments working.
  const newRegistryActive = Object.keys(algorithms).length > 0 && Object.keys(runners).length > 0;
  const compositeKey = aliases[selectedModelType] ?? selectedModelType;
  const parsed = parseComposite(compositeKey);
  const useLegacyPicker = !newRegistryActive || !parsed;

  if (useLegacyPicker) {
    const modelEntry = availableModels[selectedModelType];
    const modelList = Object.entries(availableModels);
    return (
      <Card className="flex-1 bg-primary/5 border-primary/15">
        <CardLabel>Model</CardLabel>
        <select
          value={selectedModelType}
          onChange={(e) => onModelTypeChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "w-full bg-transparent text-sm font-medium text-foreground",
            "focus:outline-none cursor-pointer",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {modelList.map(([key, model]) => (
            <option key={key} value={key} className="bg-[#0a0a0f]">
              {model.name}
            </option>
          ))}
        </select>
        {modelEntry && (
          <span className="text-[10px] text-muted-foreground/60 leading-none truncate">
            {modelEntry.category} · {modelEntry.subcategory}
          </span>
        )}
      </Card>
    );
  }

  // ── Composite picker (Algorithm + Task) ───────────────────────────────────
  const { algorithmId, taskId } = parsed;

  // For the chosen algorithm, list tasks that have a wired runner for it.
  const tasksForAlgorithm = useMemo(() => {
    const wired = new Set<string>();
    for (const compositeId of Object.keys(runners)) {
      const p = parseComposite(compositeId);
      if (p && p.algorithmId === algorithmId) wired.add(p.taskId);
    }
    return Object.entries(tasks).filter(([tid]) => wired.has(tid));
  }, [algorithmId, tasks, runners]);

  // For change handlers, we must always end up on a wired (alg, task) pair.
  function handleAlgorithmChange(nextAlg: string) {
    // If current task is wired with the new algorithm, keep it. Otherwise pick the first wired task.
    const candidate = `${nextAlg}+${taskId}`;
    if (runners[candidate]) {
      onModelTypeChange(candidate);
      return;
    }
    const firstWired = Object.keys(runners).find((id) => parseComposite(id)?.algorithmId === nextAlg);
    if (firstWired) onModelTypeChange(firstWired);
  }

  function handleTaskChange(nextTask: string) {
    const candidate = `${algorithmId}+${nextTask}`;
    if (runners[candidate]) onModelTypeChange(candidate);
  }

  const algEntry = algorithms[algorithmId];
  const taskEntry = tasks[taskId];
  const algList = Object.entries(algorithms).filter(([aid]) =>
    // Only show algorithms that have at least one wired runner
    Object.keys(runners).some((rid) => parseComposite(rid)?.algorithmId === aid),
  );

  return (
    <>
      <Card className="flex-1 min-w-0 bg-primary/5 border-primary/15">
        <CardLabel>Algorithm</CardLabel>
        <select
          value={algorithmId}
          onChange={(e) => handleAlgorithmChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "w-full bg-transparent text-sm font-medium text-foreground",
            "focus:outline-none cursor-pointer",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {algList.map(([aid, a]) => (
            <option key={aid} value={aid} className="bg-[#0a0a0f]">
              {a.name}
            </option>
          ))}
        </select>
        {algEntry && (
          <span className="text-[10px] text-muted-foreground/60 leading-none truncate">
            {algEntry.family} · {(algEntry.supports ?? []).join(", ")}
          </span>
        )}
      </Card>

      <Card className="flex-1 min-w-0 bg-primary/5 border-primary/15">
        <CardLabel>Task (use for)</CardLabel>
        <select
          value={taskId}
          onChange={(e) => handleTaskChange(e.target.value)}
          disabled={disabled || tasksForAlgorithm.length <= 1}
          className={cn(
            "w-full bg-transparent text-sm font-medium text-foreground",
            "focus:outline-none cursor-pointer",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {tasksForAlgorithm.map(([tid, t]) => (
            <option key={tid} value={tid} className="bg-[#0a0a0f]">
              {t.name}
            </option>
          ))}
        </select>
        {taskEntry && (
          <span className="text-[10px] text-muted-foreground/60 leading-none truncate">
            head: {taskEntry.head}
            {taskEntry.nClasses ? ` · K=${taskEntry.nClasses}` : ""}
          </span>
        )}
      </Card>
    </>
  );
}

// ─── Market Card ─────────────────────────────────────────────────────────────

function MarketCard({
  symbol,
  onSymbolChange,
  timeframe,
  onTimeframeChange,
  disabled,
}: Pick<ConfigStripProps, "symbol" | "onSymbolChange" | "timeframe" | "onTimeframeChange" | "disabled">) {
  return (
    <Card className="w-[160px] shrink-0">
      <CardLabel>Market</CardLabel>
      <input
        type="text"
        value={symbol}
        onChange={(e) => onSymbolChange(e.target.value.toUpperCase())}
        disabled={disabled}
        placeholder="ES"
        className={cn(
          "w-full bg-transparent text-sm font-medium text-foreground font-mono",
          "focus:outline-none placeholder:text-muted-foreground/30",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
        spellCheck={false}
      />
      <select
        value={timeframe}
        onChange={(e) => onTimeframeChange(e.target.value)}
        disabled={disabled}
        className={cn(
          "w-full bg-transparent text-[11px] text-muted-foreground",
          "focus:outline-none cursor-pointer",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        {TIMEFRAME_OPTIONS.map((tf) => (
          <option key={tf.value} value={tf.value} className="bg-[#0a0a0f]">
            {tf.label}
          </option>
        ))}
      </select>
    </Card>
  );
}

// ─── Hyperparameters Card ─────────────────────────────────────────────────────

function HyperparametersCard({
  selectedModelType,
  availableModels,
  hyperparameters,
  onHyperparameterChange: _onHyperparameterChange,
  onResetHyperparameters: _onResetHyperparameters,
  isOpen,
  onToggle,
  disabled: _disabled,
}: Pick<ConfigStripProps,
  | "selectedModelType"
  | "availableModels"
  | "hyperparameters"
  | "onHyperparameterChange"
  | "onResetHyperparameters"
  | "disabled"
> & {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const modelEntry = availableModels[selectedModelType];
  const paramDefs = modelEntry?.defaultHyperparameters ?? {};
  const paramKeys = Object.keys(paramDefs);
  const paramCount = paramKeys.length;

  // Build compact summary: up to 4 key:val chips
  const summaryEntries = useMemo(
    () =>
      paramKeys.slice(0, 4).map((key) => ({
        key,
        label: paramDefs[key]!.label ?? key,
        val: hyperparameters[key] ?? paramDefs[key]!.default,
      })),
    [paramKeys.join(","), hyperparameters, paramDefs],
  );

  return (
    <Card
      className="flex-1 min-w-0"
      onClick={onToggle}
      title={isOpen ? "Collapse hyperparameters" : "Expand hyperparameters"}
    >
      <div className="flex items-center justify-between gap-2">
        <CardLabel>Hyperparameters</CardLabel>
        <div className="flex items-center gap-1 text-muted-foreground/50">
          <span className="text-[9px] font-mono">{paramCount}</span>
          {isOpen ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <Settings2 className="h-3 w-3" />
          )}
        </div>
      </div>

      {/* Compact param chips */}
      <div className="flex flex-wrap gap-1 min-h-[16px]">
        {summaryEntries.map(({ key, label, val }) => (
          <span
            key={key}
            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground/70 leading-none"
          >
            {label.slice(0, 8)}:<span className="text-foreground/80">{formatParamValue(val)}</span>
          </span>
        ))}
        {paramCount > 4 && (
          <span className="text-[9px] text-muted-foreground/40 leading-none self-center">
            +{paramCount - 4} more
          </span>
        )}
        {paramCount === 0 && (
          <span className="text-[9px] text-muted-foreground/30 italic">no params</span>
        )}
      </div>
    </Card>
  );
}

// ─── Action Card ──────────────────────────────────────────────────────────────

function ActionCard({
  isTraining,
  isPending,
  progress,
  elapsedSec,
  onStart,
  onStop,
  disabled,
}: Pick<ConfigStripProps,
  | "isTraining"
  | "isPending"
  | "progress"
  | "elapsedSec"
  | "onStart"
  | "onStop"
  | "disabled"
>) {
  return (
    <Card className="w-[140px] shrink-0">
      <CardLabel>Action</CardLabel>

      {/* Run / Stop button */}
      <button
        onClick={isTraining ? onStop : onStart}
        disabled={isPending || disabled}
        className={cn(
          "flex items-center justify-center gap-1.5 w-full rounded-md px-3 py-1.5",
          "text-sm font-medium transition-all",
          isTraining
            ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border border-rose-500/30"
            : isPending || disabled
              ? "bg-primary/10 text-primary/40 border border-primary/20 cursor-wait"
              : "bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30",
        )}
      >
        {isTraining ? (
          <>
            <Square className="h-3.5 w-3.5 shrink-0" />
            Stop
          </>
        ) : isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            Starting…
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5 shrink-0" />
            Run
          </>
        )}
      </button>

      {/* Elapsed + progress bar (only while active) */}
      {(isTraining || isPending) && (
        <div className="flex flex-col gap-1">
          <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          {elapsedSec > 0 && (
            <span className="text-[9px] font-mono text-muted-foreground/60 text-right leading-none">
              {formatElapsed(elapsedSec)}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── ConfigStrip ─────────────────────────────────────────────────────────────

export default function ConfigStrip({
  selectedModelType,
  availableModels,
  onModelTypeChange,
  symbol,
  onSymbolChange,
  timeframe,
  onTimeframeChange,
  hyperparameters,
  onHyperparameterChange,
  onResetHyperparameters,
  isTraining,
  isPending,
  progress,
  elapsedSec,
  onStart,
  onStop,
  disabled = false,
}: ConfigStripProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const modelEntry = availableModels[selectedModelType];
  const paramDefs = modelEntry?.defaultHyperparameters ?? {};
  const isDisabled = disabled || isTraining;

  return (
    <div className="px-6 py-4 border-b border-white/5 bg-black/10">
      {/* ── Four-card strip ── */}
      <div className="flex gap-3 items-stretch">
        <ModelCard
          selectedModelType={selectedModelType}
          availableModels={availableModels}
          onModelTypeChange={onModelTypeChange}
          disabled={isDisabled}
        />

        <MarketCard
          symbol={symbol}
          onSymbolChange={onSymbolChange}
          timeframe={timeframe}
          onTimeframeChange={onTimeframeChange}
          disabled={isDisabled}
        />

        <HyperparametersCard
          selectedModelType={selectedModelType}
          availableModels={availableModels}
          hyperparameters={hyperparameters}
          onHyperparameterChange={onHyperparameterChange}
          onResetHyperparameters={onResetHyperparameters}
          isOpen={drawerOpen}
          onToggle={() => setDrawerOpen((v) => !v)}
          disabled={isDisabled}
        />

        <ActionCard
          isTraining={isTraining}
          isPending={isPending}
          progress={progress}
          elapsedSec={elapsedSec}
          onStart={onStart}
          onStop={onStop}
          disabled={disabled}
        />
      </div>

      {/* ── Hyperparameter drawer ── */}
      <AnimatePresence initial={false}>
        {drawerOpen && (
          <motion.div
            key="hp-drawer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="pt-3">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                <HyperparameterForm
                  hyperparameters={paramDefs}
                  values={hyperparameters}
                  onChange={onHyperparameterChange}
                  onReset={onResetHyperparameters}
                  disabled={isDisabled}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
