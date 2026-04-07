# Training Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tab-based Training page with a single scrollable command center that renders self-describing metrics with rich visualizations, hover tooltips, section accent colors, and live SSE updates.

**Architecture:** Rewrite Training.tsx as a scrollable surface with an inline config strip at top and MetricGrid below. Kill TrainingTabs and the tab split. Extend RendererShell with hover tooltips and MetricGrid with per-group accent colors. ModelBrowser becomes a collapsible inline section.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, visx, recharts, Radix Tooltip, existing 14 renderer components, existing SSE hooks.

---

### Task 1: Add Hover Tooltips to RendererShell

**Files:**
- Modify: `src/client/src/components/renderers/RendererShell.tsx`

Every metric card needs a hover tooltip showing what the metric measures and what the targets are. This is the foundation — all metric cards get tooltips automatically.

- [ ] **Step 1: Add tooltip imports and wrapper to RendererShell**

Replace the full `RendererShell` export in `src/client/src/components/renderers/RendererShell.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { RendererProps, MetricContext } from '@/lib/diagnostics-schema';
import { cn } from '@/lib/utils';
import { Clock } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface RendererShellProps {
  metricKey: string;
  mission: string;
  compact?: boolean;
  severity?: 'great' | 'good' | 'neutral' | 'bad';
  className?: string;
  awaitingData?: boolean;
  context?: MetricContext;
  /** Optional group color class for border tint */
  groupColor?: string;
  children: ReactNode;
}

const BORDER_TINT: Record<string, string> = {
  great: 'border-emerald-500/15',
  good: 'border-cyan-500/15',
  neutral: 'border-zinc-700/60',
  bad: 'border-red-500/15',
};

const GLOW_TINT: Record<string, string> = {
  great: 'shadow-[0_0_20px_-8px_rgba(52,211,153,0.12)]',
  good: 'shadow-[0_0_20px_-8px_rgba(34,211,238,0.12)]',
  neutral: '',
  bad: 'shadow-[0_0_20px_-8px_rgba(248,113,113,0.12)]',
};

function AwaitingOverlay({ context, compact }: { context?: MetricContext; compact?: boolean }) {
  const goals: string[] = [];
  if (context?.good != null) goals.push(`Good: ${context.good}${context.unit ? ' ' + context.unit : ''}`);
  if (context?.great != null) goals.push(`Great: ${context.great}${context.unit ? ' ' + context.unit : ''}`);
  if (context?.breakeven != null) goals.push(`Breakeven: ${context.breakeven}`);
  if (context?.baseline != null) goals.push(`Baseline: ${context.baseline}`);

  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "py-4" : "py-6")}>
      <Clock className="w-5 h-5 text-zinc-600 mb-2" />
      <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">
        Awaiting Training
      </span>
      {goals.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
          {goals.map((g, i) => (
            <span key={i} className="text-[9px] font-mono text-zinc-500/70">{g}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function TooltipBody({ mission, context }: { mission: string; context?: MetricContext }) {
  const direction = context?.higher_is_better === false ? 'Lower is better' : context?.higher_is_better === true ? 'Higher is better' : null;
  const thresholds: string[] = [];
  if (context?.good != null) thresholds.push(`Good: ${context.good}${context.unit ? ' ' + context.unit : ''}`);
  if (context?.great != null) thresholds.push(`Great: ${context.great}${context.unit ? ' ' + context.unit : ''}`);
  if (context?.breakeven != null) thresholds.push(`Breakeven: ${context.breakeven}`);
  if (context?.baseline != null) thresholds.push(`Baseline: ${context.baseline}`);
  if (context?.bad != null) thresholds.push(`Bad: ${context.bad}`);

  return (
    <div className="space-y-1.5 max-w-[280px]">
      <p className="font-medium text-zinc-200 leading-snug">{mission}</p>
      {direction && (
        <p className="text-[10px] text-zinc-400 italic">{direction}</p>
      )}
      {thresholds.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1 border-t border-zinc-700/50">
          {thresholds.map((t, i) => (
            <span key={i} className="text-[10px] text-zinc-400 font-mono">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function RendererShell({
  metricKey,
  mission,
  compact,
  severity = 'neutral',
  className,
  awaitingData,
  context,
  groupColor,
  children,
}: RendererShellProps) {
  const borderClass = awaitingData
    ? (groupColor ?? 'border-zinc-800/60')
    : BORDER_TINT[severity];

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div
          data-metric={metricKey}
          className={cn(
            'glass-elevated gradient-accent-top rounded-lg overflow-hidden transition-all duration-300',
            'border cursor-default',
            borderClass,
            awaitingData ? 'opacity-80' : GLOW_TINT[severity],
            compact ? 'p-2.5' : 'p-3.5',
            className,
          )}
        >
          <div className={cn('mb-2', compact && 'mb-1.5')}>
            <h4 className={cn(
              'font-display tracking-wide leading-tight',
              awaitingData ? 'text-zinc-500' : 'text-zinc-400',
              compact ? 'text-[9px]' : 'text-[10px]',
            )}>
              {mission}
            </h4>
          </div>
          {awaitingData ? <AwaitingOverlay context={context} compact={compact} /> : children}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="bg-zinc-900 border border-zinc-700/50 px-3 py-2 text-xs"
      >
        <TooltipBody mission={mission} context={context} />
      </TooltipContent>
    </Tooltip>
  );
}

export function useShellProps(props: RendererProps) {
  const value = props.metric.value;
  const awaitingData = value === null || value === undefined;
  return {
    metricKey: props.metricKey,
    mission: props.metric.mission,
    compact: props.compact,
    context: props.metric.context,
    awaitingData,
  };
}
```

- [ ] **Step 2: Verify tooltips render**

Run: `curl -s http://localhost:5000/health` to confirm server is running. Open Electron app, hover over any metric card — tooltip should appear with mission text and thresholds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/components/renderers/RendererShell.tsx
git commit -m "feat(training): add hover tooltips to all metric cards via RendererShell"
```

---

### Task 2: Add Section Accent Colors to MetricGrid

**Files:**
- Modify: `src/client/src/components/renderers/MetricGrid.tsx`

Each metric group gets a distinct accent color: deep_learning=purple, machine_learning=cyan, trading=amber.

- [ ] **Step 1: Add SECTION_COLORS constant and update GroupHeader**

In `src/client/src/components/renderers/MetricGrid.tsx`, add the color map near the top (after the type definitions) and update `GroupHeader` to use it:

```tsx
// ─── Section Accent Colors ──────────────────────────────────────────────

const SECTION_COLORS: Record<string, { text: string; line: string; border: string }> = {
  deep_learning:    { text: 'text-purple-400',  line: 'bg-purple-500/20', border: 'border-purple-500/10' },
  machine_learning: { text: 'text-cyan-400',    line: 'bg-cyan-500/20',   border: 'border-cyan-500/10' },
  trading:          { text: 'text-amber-400',   line: 'bg-amber-500/20',  border: 'border-amber-500/10' },
  regimes:          { text: 'text-orange-400',  line: 'bg-orange-500/20', border: 'border-orange-500/10' },
  quality:          { text: 'text-teal-400',    line: 'bg-teal-500/20',   border: 'border-teal-500/10' },
  performance:      { text: 'text-emerald-400', line: 'bg-emerald-500/20',border: 'border-emerald-500/10' },
  features:         { text: 'text-indigo-400',  line: 'bg-indigo-500/20', border: 'border-indigo-500/10' },
  data:             { text: 'text-sky-400',     line: 'bg-sky-500/20',    border: 'border-sky-500/10' },
  general:          { text: 'text-zinc-400',    line: 'bg-zinc-700',      border: 'border-zinc-700/60' },
};

function getSectionColor(group: string) {
  return SECTION_COLORS[group] ?? SECTION_COLORS.general;
}
```

- [ ] **Step 2: Update GroupHeader to use accent colors**

Replace the existing `GroupHeader` function:

```tsx
function GroupHeader({ name, compact }: { name: string; compact?: boolean }) {
  const label = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const colors = getSectionColor(name);
  return (
    <div className={cn('flex items-center gap-3', compact ? 'mb-2' : 'mb-4 mt-2')}>
      <h3 className={cn(
        'font-display font-semibold tracking-wider uppercase',
        colors.text,
        compact ? 'text-[10px]' : 'text-[11px] tracking-[0.15em]',
      )}>
        {label}
      </h3>
      <div className={cn('flex-1 h-px', colors.line)} />
    </div>
  );
}
```

- [ ] **Step 3: Pass groupColor to RendererShell for awaiting-state border tint**

In the `MetricGrid` component's render loop, update the awaiting-data branch to pass the group border color:

Find the section that renders awaiting metrics (the `if (isAwaiting)` block) and update it:

```tsx
if (isAwaiting) {
  const groupBorder = getSectionColor(group.name).border;
  return (
    <div key={key} className={cn(wide && totalMetrics > 2 && 'sm:col-span-2')}>
      <RendererShell
        metricKey={key}
        mission={metric.mission}
        compact={compact}
        awaitingData
        context={metric.context}
        groupColor={groupBorder}
      >
        {null}
      </RendererShell>
    </div>
  );
}
```

- [ ] **Step 4: Export getSectionColor for external use**

Add to the exports at the bottom of MetricGrid.tsx:

```tsx
export { getSectionColor, SECTION_COLORS };
```

- [ ] **Step 5: Verify section colors render**

Open the Electron app → ML Studio → Training. Each section (Deep Learning, Machine Learning, Trading) should have its own colored header text and divider line. Awaiting cards should have a subtle group-colored border.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/components/renderers/MetricGrid.tsx
git commit -m "feat(training): add per-section accent colors to MetricGrid"
```

---

### Task 3: Create ConfigStrip Component

**Files:**
- Create: `src/client/src/components/training/ConfigStrip.tsx`

Inline config cards replacing the current header bar. Model card, market card, hyperparameter summary card, and action button.

- [ ] **Step 1: Create ConfigStrip.tsx**

Create `src/client/src/components/training/ConfigStrip.tsx`:

```tsx
/**
 * ConfigStrip — Inline configuration cards for the Training command center.
 *
 * Four cards in a horizontal flex: Model | Market | Hyperparameters | Action.
 * Hyperparameters card expands into a full HyperparameterForm drawer on click.
 */

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Play, Square, Loader2, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ModelRegistryEntry, HyperparameterDef } from '@shared/trainingTypes';
import HyperparameterForm from './HyperparameterForm';
import { cn } from '@/lib/utils';

interface ConfigStripProps {
  /** Currently selected model type key */
  selectedModelType: string;
  /** Model registry entries */
  availableModels: Record<string, ModelRegistryEntry>;
  /** Callback to change model type */
  onModelTypeChange: (type: string) => void;
  /** Current symbol */
  symbol: string;
  /** Callback to change symbol */
  onSymbolChange: (symbol: string) => void;
  /** Current timeframe label */
  timeframe: string;
  /** Callback to change timeframe */
  onTimeframeChange: (tf: string) => void;
  /** Current hyperparameter overrides */
  hyperparameters: Record<string, number | string | boolean>;
  /** Callback to change a hyperparameter */
  onHyperparameterChange: (key: string, value: number | string | boolean) => void;
  /** Reset hyperparameters to defaults */
  onResetHyperparameters: () => void;
  /** Training state */
  isTraining: boolean;
  isPending: boolean;
  progress: number;
  elapsedSec: number;
  /** Callbacks */
  onStart: () => void;
  onStop: () => void;
  /** Disabled state (e.g., during training) */
  disabled?: boolean;
}

export function ConfigStrip({
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
  disabled,
}: ConfigStripProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const modelDef = availableModels[selectedModelType];
  const paramCount = modelDef?.defaultHyperparameters
    ? Object.keys(modelDef.defaultHyperparameters).length
    : 0;

  // Build compact param summary
  const paramSummary = modelDef?.defaultHyperparameters
    ? Object.entries(modelDef.defaultHyperparameters)
        .filter(([, def]) => def.type !== 'bool')
        .slice(0, 5)
        .map(([key, def]) => {
          const val = hyperparameters[key] ?? def.default;
          const label = key.replace(/([A-Z])/g, ' $1').trim().split(' ')[0];
          return `${label}:${val}`;
        })
        .join(' · ')
    : '';

  return (
    <div className="px-6 py-4 border-b border-white/5 bg-black/10">
      {/* Card Row */}
      <div className="flex gap-3 items-stretch">
        {/* Model Card */}
        <div className="flex-1 bg-primary/5 border border-primary/15 rounded-xl px-4 py-3 min-w-0">
          <div className="text-[8px] font-black text-primary uppercase tracking-[0.2em] mb-1">Model</div>
          <select
            value={selectedModelType}
            onChange={e => onModelTypeChange(e.target.value)}
            disabled={isTraining || disabled}
            className="w-full bg-transparent text-sm font-bold text-foreground appearance-none cursor-pointer focus:outline-none disabled:opacity-40 truncate"
          >
            {Object.entries(availableModels).map(([k, v]) => (
              <option key={k} value={k} className="bg-[#0a0a0f]">{v.name}</option>
            ))}
          </select>
          <div className="text-[9px] text-muted-foreground/40 mt-0.5 truncate">
            {modelDef?.category} · {modelDef?.family}
          </div>
        </div>

        {/* Market Card */}
        <div className="w-[160px] bg-white/2 border border-white/6 rounded-xl px-4 py-3 shrink-0">
          <div className="text-[8px] font-black text-muted-foreground/50 uppercase tracking-[0.2em] mb-1">Market</div>
          <div className="flex items-center gap-2">
            <input
              value={symbol}
              onChange={e => onSymbolChange(e.target.value.toUpperCase())}
              disabled={isTraining || disabled}
              className="w-16 bg-transparent text-sm font-bold text-foreground focus:outline-none uppercase disabled:opacity-40"
            />
            <select
              value={timeframe}
              onChange={e => onTimeframeChange(e.target.value)}
              disabled={isTraining || disabled}
              className="bg-transparent text-xs font-mono text-muted-foreground appearance-none cursor-pointer focus:outline-none disabled:opacity-40"
            >
              {['1m','5m','15m','1h','1d'].map(tf => (
                <option key={tf} value={tf} className="bg-[#0a0a0f]">{tf}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Hyperparameters Card */}
        <button
          onClick={() => setDrawerOpen(prev => !prev)}
          disabled={isTraining || disabled}
          className={cn(
            'flex-1 bg-white/2 border rounded-xl px-4 py-3 text-left transition-colors min-w-0',
            drawerOpen ? 'border-primary/30 bg-primary/5' : 'border-white/6 hover:border-white/10',
            (isTraining || disabled) && 'opacity-40 cursor-not-allowed',
          )}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] font-black text-muted-foreground/50 uppercase tracking-[0.2em]">
              Hyperparameters ({paramCount})
            </span>
            {drawerOpen ? <ChevronUp className="w-3 h-3 text-muted-foreground/40" /> : <Settings2 className="w-3 h-3 text-muted-foreground/40" />}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/60 truncate">
            {paramSummary || 'Click to configure'}
          </div>
        </button>

        {/* Action Card */}
        <div className="w-[140px] flex flex-col items-center justify-center shrink-0">
          {isTraining ? (
            <div className="text-center">
              <button
                onClick={onStop}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all font-bold text-[10px] uppercase tracking-widest"
              >
                <Square className="w-3 h-3 fill-current" /> Stop
              </button>
              <div className="mt-2 text-[9px] font-mono text-muted-foreground/40">{elapsedSec}s · {progress}%</div>
            </div>
          ) : (
            <button
              onClick={onStart}
              disabled={isPending || disabled}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary border border-primary/20 text-white hover:bg-primary/90 disabled:opacity-50 transition-all font-bold text-[10px] uppercase tracking-widest shadow-[0_0_20px_rgba(59,130,246,0.2)]"
            >
              {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
              Run
            </button>
          )}
        </div>
      </div>

      {/* Hyperparameter Drawer */}
      <AnimatePresence>
        {drawerOpen && modelDef?.defaultHyperparameters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-4 pb-2">
              <HyperparameterForm
                hyperparameters={modelDef.defaultHyperparameters}
                values={hyperparameters}
                onChange={onHyperparameterChange}
                onReset={onResetHyperparameters}
                disabled={isTraining || disabled}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep ConfigStrip` — should show no errors for this file.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/components/training/ConfigStrip.tsx
git commit -m "feat(training): create ConfigStrip inline config cards component"
```

---

### Task 4: Rewrite Training.tsx as Scrollable Command Center

**Files:**
- Modify: `src/client/src/pages/Training.tsx`

Replace the entire file — kill tabs, use ConfigStrip + MetricGrid directly.

- [ ] **Step 1: Rewrite Training.tsx**

Replace `src/client/src/pages/Training.tsx` with:

```tsx
/**
 * Training — Scrollable Command Center.
 *
 * Single surface: ConfigStrip → MetricGrid (self-describing) → ModelBrowser.
 * No tabs. Metrics driven entirely by metricDeclarations from models.json.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDashboard } from '@/contexts/UnifiedDashboardContext';
import { useTrainingControl, useTrainingLive } from '@/contexts/TrainingContext';
import { useQuery } from '@tanstack/react-query';
import { ConfigStrip } from '@/components/training/ConfigStrip';
import { MetricGrid } from '@/components/renderers/MetricGrid';
import { ModelBrowser } from '@/components/training/ModelBrowser';
import type { SelfDescribingDiagnostics, MetricDeclaration } from '@/lib/diagnostics-schema';
import { ChevronDown, ChevronUp, FolderTree } from 'lucide-react';

/** Build skeleton self-describing diagnostics from model registry declarations. */
function buildSkeletonDiagnostics(
  modelType: string,
  declarations: Record<string, any>,
  symbol: string,
  timeframe: string,
): SelfDescribingDiagnostics {
  const metrics: Record<string, MetricDeclaration> = {};
  for (const [key, decl] of Object.entries(declarations)) {
    metrics[key] = {
      value: null,
      renderer: decl.renderer,
      mission: decl.mission,
      context: decl.context,
      group: decl.group,
      order: decl.order,
    };
  }
  return {
    model_type: modelType,
    symbol,
    timeframe,
    metrics,
    training: { duration_sec: 0, trained_at: '' },
  };
}

/** Check if diagnostics uses self-describing format */
function isSelfDescribing(diag: Record<string, any> | null): diag is SelfDescribingDiagnostics {
  if (!diag?.metrics || typeof diag.metrics !== 'object') return false;
  const firstKey = Object.keys(diag.metrics)[0];
  if (!firstKey) return false;
  const first = diag.metrics[firstKey];
  return first && typeof first === 'object' && 'renderer' in first && 'mission' in first;
}

export default function Training() {
  const dashboard = useDashboard();
  const {
    isTraining, isPending, progress, error,
    startTraining, stopTraining,
    availableModels, selectedModelType, setSelectedModelType,
    completedModelId,
  } = useTrainingControl();
  const { diagnostics, elapsedSec } = useTrainingLive();

  const [symbol, setSymbol] = useState(dashboard.symbol || 'MNQ');
  const [timeframe, setTimeframe] = useState('1m');
  const [hyperparameters, setHyperparameters] = useState<Record<string, number | string | boolean>>({});
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [modelBrowserOpen, setModelBrowserOpen] = useState(false);

  // Initialize hyperparameters from model defaults
  const modelDef = availableModels[selectedModelType];
  useEffect(() => {
    if (modelDef?.defaultHyperparameters) {
      const defaults: Record<string, number | string | boolean> = {};
      for (const [key, def] of Object.entries(modelDef.defaultHyperparameters)) {
        defaults[key] = def.default;
      }
      setHyperparameters(defaults);
    }
  }, [selectedModelType, modelDef]);

  // Load trained models
  const { data: trainedModels } = useQuery<any[]>({
    queryKey: ['/api/training/models'],
    queryFn: async () => {
      const r = await fetch('/api/training/models');
      if (!r.ok) return [];
      const d = await r.json();
      return d?.models ?? d ?? [];
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!selectedModelId && !completedModelId && trainedModels?.length) {
      const first = trainedModels[0] as any;
      setSelectedModelId(first.id);
      if (first.modelType) setSelectedModelType(first.modelType);
    }
  }, [trainedModels, selectedModelId, completedModelId, setSelectedModelType]);

  const activeModelId = completedModelId || selectedModelId;

  // Load saved diagnostics for selected model
  const { data: savedDiagnostics } = useQuery<Record<string, any>>({
    queryKey: ['/api/training/models', activeModelId, 'diagnostics'],
    queryFn: async () => {
      const r = await fetch(`/api/training/models/${activeModelId}/diagnostics`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!activeModelId,
    staleTime: 60_000,
  });

  // Build effective diagnostics: live SSE > saved from disk > skeleton from declarations
  const effectiveDiag = useMemo((): SelfDescribingDiagnostics | null => {
    const liveDiag = diagnostics as Record<string, any> | null;
    if (isSelfDescribing(liveDiag)) return liveDiag;
    if (isSelfDescribing(savedDiagnostics)) return savedDiagnostics as SelfDescribingDiagnostics;
    // Build skeleton from declarations
    if (modelDef?.metricDeclarations && Object.keys(modelDef.metricDeclarations).length > 0) {
      return buildSkeletonDiagnostics(
        selectedModelType,
        modelDef.metricDeclarations as Record<string, any>,
        symbol,
        timeframe,
      );
    }
    return null;
  }, [diagnostics, savedDiagnostics, modelDef, selectedModelType, symbol, timeframe]);

  const handleHyperparameterChange = useCallback((key: string, value: number | string | boolean) => {
    setHyperparameters(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleResetHyperparameters = useCallback(() => {
    if (!modelDef?.defaultHyperparameters) return;
    const defaults: Record<string, number | string | boolean> = {};
    for (const [key, def] of Object.entries(modelDef.defaultHyperparameters)) {
      defaults[key] = def.default;
    }
    setHyperparameters(defaults);
  }, [modelDef]);

  const handleStart = useCallback(() => {
    startTraining({
      modelType: selectedModelType,
      symbol,
      timeframe,
      hyperparameters,
    });
  }, [startTraining, selectedModelType, symbol, timeframe, hyperparameters]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col">
        {/* Config Strip */}
        <ConfigStrip
          selectedModelType={selectedModelType}
          availableModels={availableModels}
          onModelTypeChange={setSelectedModelType}
          symbol={symbol}
          onSymbolChange={setSymbol}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          hyperparameters={hyperparameters}
          onHyperparameterChange={handleHyperparameterChange}
          onResetHyperparameters={handleResetHyperparameters}
          isTraining={isTraining}
          isPending={isPending}
          progress={progress}
          elapsedSec={elapsedSec}
          onStart={handleStart}
          onStop={stopTraining}
        />

        {/* Metric Grid — self-describing, scrollable */}
        <div className="px-6 py-6">
          {effectiveDiag ? (
            <MetricGrid diagnostics={effectiveDiag} />
          ) : (
            <div className="text-center py-20 text-zinc-600">
              <p className="text-sm">Select a model to see its metrics</p>
            </div>
          )}
        </div>

        {/* Model Browser — collapsible section */}
        <div className="border-t border-white/5">
          <button
            onClick={() => setModelBrowserOpen(prev => !prev)}
            className="w-full flex items-center justify-between px-6 py-3 hover:bg-white/2 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground/50 uppercase tracking-widest">
              <FolderTree className="w-3.5 h-3.5" />
              Trained Models
              {trainedModels?.length ? (
                <span className="text-muted-foreground/30">({trainedModels.length})</span>
              ) : null}
            </div>
            {modelBrowserOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/30" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30" />}
          </button>
          {modelBrowserOpen && (
            <div className="px-6 pb-6">
              <ModelBrowser
                onSelectModel={(id: string) => {
                  setSelectedModelId(id);
                  const m = trainedModels?.find((x: any) => x.id === id);
                  if (m?.modelType) setSelectedModelType(m.modelType);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Verify page loads**

Open the Electron app → ML Studio → Training. Should see:
- Config strip at top (model, market, hyperparameters, run button)
- Three metric sections below (Deep Learning purple, Machine Learning cyan, Trading amber)
- Collapsible "Trained Models" section at bottom

- [ ] **Step 3: Commit**

```bash
git add src/client/src/pages/Training.tsx
git commit -m "feat(training): rewrite as scrollable command center with ConfigStrip + MetricGrid"
```

---

### Task 5: Clean Up Dead Code

**Files:**
- Delete: `src/client/src/components/training/tabs/TrainingTabs.tsx`
- Delete: `src/client/src/components/training/tabs/OverviewTab.tsx`
- Keep: `src/client/src/components/training/tabs/ConvergenceTab.tsx` (referenced by other pages)

- [ ] **Step 1: Delete TrainingTabs.tsx and OverviewTab.tsx**

```bash
rm src/client/src/components/training/tabs/TrainingTabs.tsx
rm src/client/src/components/training/tabs/OverviewTab.tsx
```

- [ ] **Step 2: Verify no imports remain**

Run: `grep -r "TrainingTabs\|OverviewTab" src/client/src/ --include="*.tsx" --include="*.ts" -l`

If any files still import these, update them. The only consumer was Training.tsx which was already rewritten.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` — count should not increase from pre-existing errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove TrainingTabs and OverviewTab (replaced by scrollable command center)"
```

---

### Task 6: Playwright Verification

**Files:** None (verification only)

- [ ] **Step 1: Navigate to Training page**

```
browser_navigate: http://host.docker.internal:5000/ml-studio
browser_click: ML Studio link
```

- [ ] **Step 2: Verify ConfigStrip renders**

Check for: model selector, symbol input, timeframe dropdown, Run button.

- [ ] **Step 3: Verify metric sections render with accent colors**

Check for headings: "Deep Learning", "Machine Learning", "Trading" — each with distinct color.

- [ ] **Step 4: Verify hover tooltips work**

Hover over a metric card — tooltip should show mission text and thresholds.

- [ ] **Step 5: Switch model type**

Select "Non-Parametric Bayesian Regime Discovery" from model dropdown — metric cards should change to HDP-HMM metrics (8 cards instead of 19).

- [ ] **Step 6: Take final screenshot**

Full page screenshot of the completed redesign.
