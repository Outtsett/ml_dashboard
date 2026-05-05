/**
 * ModelBrowser — Navigable tree of trained models.
 *
 * Hierarchy: Model Type → Instrument (symbol_timeframe) → Checkpoints
 *
 * Each checkpoint shows: evaluation grade, quality score, training date,
 * bar count, regime count, training time. Click to expand full diagnostics.
 *
 * Adaptive: auto-discovers model types and instruments from server data.
 * New model types appear automatically — zero UI changes needed.
 */

import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  Brain,
  BarChart3,
  Clock,
  Layers,
  Trash2,
  Star,
} from "lucide-react";
import { useTrainedModels, useDeleteModel, type ModelGroup, type InstrumentGroup, type TrainedModel } from "@/hooks/useTrainedModels";

interface ModelBrowserProps {
  /** Called when user selects a model to view details */
  onSelectModel?: (modelId: string) => void;
  /** Filter to specific model type */
  filterModelType?: string;
  /** Filter to specific symbol */
  filterSymbol?: string;
}

export function ModelBrowser({ onSelectModel, filterModelType, filterSymbol }: ModelBrowserProps) {
  const { grouped, isLoading, models } = useTrainedModels();
  const deleteMutation = useDeleteModel();
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [expandedInstruments, setExpandedInstruments] = useState<Set<string>>(new Set());
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = grouped;
    if (filterModelType) {
      result = result.filter(g => g.modelType === filterModelType);
    }
    if (filterSymbol) {
      result = result.map(g => ({
        ...g,
        instruments: g.instruments.filter(i => i.symbol === filterSymbol),
        totalModels: g.instruments.filter(i => i.symbol === filterSymbol).reduce((n, i) => n + i.models.length, 0),
      })).filter(g => g.instruments.length > 0);
    }
    return result;
  }, [grouped, filterModelType, filterSymbol]);

  const toggleType = (type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  const toggleInstrument = (key: string) => {
    setExpandedInstruments(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleSelect = (id: string) => {
    setSelectedModelId(id);
    onSelectModel?.(id);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground/40">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 border border-blue-400/50 border-t-blue-400 rounded-full animate-spin" />
          <span className="text-xs font-mono">Loading models...</span>
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground/30">
        <div className="text-center">
          <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs font-mono">No trained models yet</p>
          <p className="text-[10px] font-mono text-muted-foreground/20 mt-1">
            Train a model to see it here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-white/5 shrink-0">
        <span className="text-[10px] font-mono text-blue-400 font-medium uppercase tracking-wider">
          Model Browser
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/40">
          {models.length} checkpoints across {filtered.length} model types
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {filtered.map(group => (
          <ModelTypeNode
            key={group.modelType}
            group={group}
            expanded={expandedTypes.has(group.modelType)}
            onToggle={() => toggleType(group.modelType)}
            expandedInstruments={expandedInstruments}
            onToggleInstrument={toggleInstrument}
            selectedModelId={selectedModelId}
            onSelect={handleSelect}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Tree Nodes ──────────────────────────────────────────────────────────────

function ModelTypeNode({
  group,
  expanded,
  onToggle,
  expandedInstruments,
  onToggleInstrument,
  selectedModelId,
  onSelect,
  onDelete,
}: {
  group: ModelGroup;
  expanded: boolean;
  onToggle: () => void;
  expandedInstruments: Set<string>;
  onToggleInstrument: (key: string) => void;
  selectedModelId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/3 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        )}
        <Brain className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <span className="text-xs font-mono font-medium text-foreground/80 flex-1">
          {group.modelType}
        </span>
        <GradeBadge grade={group.bestGrade} />
        <span className="text-[9px] font-mono text-muted-foreground/40">
          {group.totalModels} models, {group.instruments.length} instruments
        </span>
      </button>

      {expanded && (
        <div className="ml-3 border-l border-white/5">
          {group.instruments.map(inst => (
            <InstrumentNode
              key={inst.key}
              instrument={inst}
              expanded={expandedInstruments.has(`${group.modelType}:${inst.key}`)}
              onToggle={() => onToggleInstrument(`${group.modelType}:${inst.key}`)}
              selectedModelId={selectedModelId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InstrumentNode({
  instrument,
  expanded,
  onToggle,
  selectedModelId,
  onSelect,
  onDelete,
}: {
  instrument: InstrumentGroup;
  expanded: boolean;
  onToggle: () => void;
  selectedModelId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/3 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/40 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
        )}
        <span className="text-[11px] font-mono font-medium text-amber-400/80">
          {instrument.symbol}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/40">
          {instrument.timeframe}
        </span>
        <span className="text-[9px] font-mono text-muted-foreground/30 ml-auto">
          {instrument.models.length} checkpoints
        </span>
        {instrument.bestModel && (
          <GradeBadge grade={instrument.bestModel.evaluation_grade} size="sm" />
        )}
      </button>

      {expanded && (
        <div className="ml-4">
          {instrument.models.map((m, i) => (
            <CheckpointRow
              key={m.id}
              model={m}
              isBest={i === 0 || m.id === instrument.bestModel?.id}
              isSelected={m.id === selectedModelId}
              onSelect={() => onSelect(m.id)}
              onDelete={() => onDelete(m.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckpointRow({
  model,
  isBest,
  isSelected,
  onSelect,
  onDelete,
}: {
  model: TrainedModel;
  isBest: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const trainedDate = model.trained_at
    ? new Date(model.trained_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
    : "?";

  const duration = model.training_time_sec > 0
    ? model.training_time_sec < 60
      ? `${Math.round(model.training_time_sec)}s`
      : `${(model.training_time_sec / 60).toFixed(1)}m`
    : "?";

  return (
    <div
      onClick={onSelect}
      className={`
        flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors text-left
        ${isSelected ? "bg-blue-500/10 border-l-2 border-blue-400" : "hover:bg-white/3 border-l-2 border-transparent"}
      `}
    >
      {isBest && <Star className="h-3 w-3 text-amber-400/70 shrink-0" />}
      {!isBest && <div className="w-3" />}

      <GradeBadge grade={model.evaluation_grade} size="sm" />

      <span className="text-[10px] font-mono text-muted-foreground/60 flex-1 truncate" title={model.id}>
        {trainedDate}
      </span>

      <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground/40">
        <span title="Quality score">
          <BarChart3 className="h-2.5 w-2.5 inline mr-0.5" />
          {model.quality_score}
        </span>
        <span title="Regimes">
          <Layers className="h-2.5 w-2.5 inline mr-0.5" />
          {model.n_regimes}
        </span>
        <span title={`${(model.n_bars / 1000).toFixed(0)}K bars`}>
          {(model.n_bars / 1000).toFixed(0)}K
        </span>
        <span title="Training time">
          <Clock className="h-2.5 w-2.5 inline mr-0.5" />
          {duration}
        </span>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="p-0.5 rounded text-muted-foreground/20 hover:text-red-400/60 hover:bg-red-400/5 transition-colors"
        title="Delete checkpoint"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Grade Badge ─────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  "A+": "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  "A": "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  "A-": "text-emerald-400/80 bg-emerald-400/8 border-emerald-400/15",
  "B+": "text-blue-400 bg-blue-400/10 border-blue-400/20",
  "B": "text-blue-400/80 bg-blue-400/8 border-blue-400/15",
  "B-": "text-blue-400/60 bg-blue-400/5 border-blue-400/10",
  "C+": "text-amber-400 bg-amber-400/10 border-amber-400/20",
  "C": "text-amber-400/80 bg-amber-400/8 border-amber-400/15",
  "C-": "text-amber-400/60 bg-amber-400/5 border-amber-400/10",
  "D+": "text-orange-400 bg-orange-400/10 border-orange-400/20",
  "D": "text-orange-400/80 bg-orange-400/8 border-orange-400/15",
  "D-": "text-orange-400/60 bg-orange-400/5 border-orange-400/10",
  "F": "text-red-400 bg-red-400/10 border-red-400/20",
  "N/A": "text-muted-foreground/40 bg-white/3 border-white/5",
};

function GradeBadge({ grade, size = "md" }: { grade: string; size?: "sm" | "md" }) {
  const colorClass = GRADE_COLORS[grade] ?? GRADE_COLORS["N/A"];
  const sizeClass = size === "sm"
    ? "text-[8px] px-1 py-0"
    : "text-[9px] px-1.5 py-0.5";

  return (
    <span className={`font-mono font-bold rounded border ${colorClass} ${sizeClass}`}>
      {grade}
    </span>
  );
}

export { GradeBadge };
