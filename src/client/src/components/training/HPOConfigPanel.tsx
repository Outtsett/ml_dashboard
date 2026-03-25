/**
 * HPOConfigPanel — Hyperparameter Optimization configuration UI.
 *
 * Two sections:
 *  A) Optimizer picker + per-optimizer config form
 *  B) Search-space editor (toggle params in/out, edit ranges)
 */

import { useCallback, useMemo } from "react";
import {
  Brain,
  Dna,
  Dice5,
  Gauge,
  Orbit,
  Sparkles,
  Waves,
  ToggleLeft,
  CheckSquare,
  XSquare,
  Info,
  ChevronDown,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  OptimizerType,
  SearchDimension,
  SearchSpaceDef,
  DistributionType,
} from "@/../../shared/hpoTypes";
import type { HyperparameterDef } from "@/../../shared/trainingTypes";
import { cn } from "@/lib/utils";

// ─── Props ──────────────────────────────────────────────────────────────────

export interface HPOConfigPanelProps {
  optimizerType: OptimizerType;
  onOptimizerTypeChange: (type: OptimizerType) => void;
  optimizerConfig: Record<string, any>;
  onOptimizerConfigChange: (config: Record<string, any>) => void;
  searchSpace: SearchSpaceDef;
  onSearchSpaceChange: (space: SearchSpaceDef) => void;
  /** Source schema from the model — used to build default search dimensions. */
  hyperparameters: Record<string, HyperparameterDef>;
  disabled?: boolean;
  className?: string;
}

// ─── Optimizer Metadata ─────────────────────────────────────────────────────

interface OptimizerMeta {
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
}

const OPTIMIZER_META: Record<OptimizerType, OptimizerMeta> = {
  optuna: {
    label: "Optuna",
    description: "Tree-structured Parzen Estimator with pruning",
    icon: Brain,
    color: "text-violet-400",
  },
  bayesian: {
    label: "Bayesian",
    description: "Gaussian Process surrogate model",
    icon: Gauge,
    color: "text-sky-400",
  },
  pso: {
    label: "PSO",
    description: "Particle swarm optimization",
    icon: Orbit,
    color: "text-amber-400",
  },
  montecarlo: {
    label: "Monte Carlo",
    description: "Random/quasi-random sampling",
    icon: Dice5,
    color: "text-emerald-400",
  },
  evolutionary: {
    label: "Evolutionary",
    description: "Genetic & evolution strategies",
    icon: Dna,
    color: "text-rose-400",
  },
  bohb: {
    label: "BOHB",
    description: "Bayesian optimization + early stopping",
    icon: Sparkles,
    color: "text-orange-400",
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Estimate total evaluations from search config. */
function estimateEvaluations(
  optimizer: OptimizerType,
  config: Record<string, any>,
): number {
  switch (optimizer) {
    case "optuna":
      return (config.nTrials as number) ?? 50;
    case "bayesian":
      return (config.nCalls as number) ?? 50;
    case "pso":
      return ((config.nParticles as number) ?? 30) * ((config.nIterations as number) ?? 100);
    case "montecarlo":
      return (config.nSamples as number) ?? 100;
    case "evolutionary":
      return (config.budget as number) ?? 100;
    case "bohb":
      return (config.nTrials as number) ?? 50;
    default:
      return 50;
  }
}

/** Derive a search dimension from a HyperparameterDef. */
function dimFromHpDef(hp: HyperparameterDef): SearchDimension {
  const dimType = hp.type ?? (hp.step >= 1 ? "int" : "float");

  if (dimType === "categorical") {
    return {
      type: "categorical",
      choices: hp.choices ?? [],
      distribution: "choice",
      default: hp.value,
    };
  }
  if (dimType === "bool") {
    return { type: "bool", choices: [true, false], default: hp.value };
  }

  return {
    type: dimType as "int" | "float",
    low: hp.searchSpace?.min ?? hp.min,
    high: hp.searchSpace?.max ?? hp.max,
    step: hp.searchSpace?.step ?? hp.step,
    logScale: hp.searchSpace?.logScale ?? hp.logScale ?? false,
    distribution:
      (hp.searchSpace?.distribution as DistributionType) ?? "uniform",
    default: hp.value,
  };
}

/** Group hyperparameters by their `group` field. */
function groupParams(
  params: Record<string, HyperparameterDef>,
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const [key, def] of Object.entries(params)) {
    const g = def.group ?? "General";
    (groups[g] ??= []).push(key);
  }
  return groups;
}

// ─── Compact field primitives ───────────────────────────────────────────────

const fieldLabel = "text-[10px] text-muted-foreground uppercase tracking-wider";
const fieldInput =
  "h-7 rounded-md bg-white/5 border-white/10 text-xs font-mono px-2 focus:ring-1 focus:ring-orange-500/50";
const fieldSelect =
  "h-7 rounded-md bg-white/5 border-white/10 text-xs [&>span]:text-xs";

interface NumberFieldProps {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  tooltip?: string;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  tooltip,
}: NumberFieldProps) {
  const inner = (
    <div className="space-y-1">
      <Label className={fieldLabel}>{label}</Label>
      <Input
        type="number"
        className={fieldInput}
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const v = step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
          if (!isNaN(v)) onChange(v);
        }}
      />
    </div>
  );

  if (!tooltip) return inner;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{inner}</TooltipTrigger>
      <TooltipContent side="top" className="text-[10px] max-w-48">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
}: SelectFieldProps) {
  return (
    <div className="space-y-1">
      <Label className={fieldLabel}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={fieldSelect}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#1a1a2e] border-white/10">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Per-Optimizer Config Forms ─────────────────────────────────────────────

function OptunaForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  disabled?: boolean;
}) {
  const sampler = config.sampler ?? {};
  const pruner = config.pruner ?? {};
  const set = (k: string, v: any) => onChange({ ...config, [k]: v });
  const setSampler = (k: string, v: any) =>
    onChange({ ...config, sampler: { ...sampler, [k]: v } });
  const setPruner = (k: string, v: any) =>
    onChange({ ...config, pruner: { ...pruner, [k]: v } });

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <SelectField
        label="Sampler"
        value={sampler.type ?? "tpe"}
        options={[
          { value: "tpe", label: "TPE" },
          { value: "cma_es", label: "CMA-ES" },
          { value: "random", label: "Random" },
          { value: "grid", label: "Grid" },
        ]}
        onChange={(v) => setSampler("type", v)}
        disabled={disabled}
      />
      <SelectField
        label="Pruner"
        value={pruner.type ?? "median"}
        options={[
          { value: "median", label: "Median" },
          { value: "successive_halving", label: "Successive Halving" },
          { value: "hyperband", label: "Hyperband" },
          { value: "none", label: "None" },
        ]}
        onChange={(v) => setPruner("type", v)}
        disabled={disabled}
      />
      <NumberField
        label="Trials"
        value={config.nTrials}
        onChange={(v) => set("nTrials", v)}
        min={1}
        disabled={disabled}
        tooltip="Total number of optimization trials"
      />
      <SelectField
        label="Direction"
        value={config.direction ?? "minimize"}
        options={[
          { value: "minimize", label: "Minimize" },
          { value: "maximize", label: "Maximize" },
        ]}
        onChange={(v) => set("direction", v)}
        disabled={disabled}
      />
      <NumberField
        label="Timeout (s)"
        value={config.timeout}
        onChange={(v) => set("timeout", v)}
        min={0}
        disabled={disabled}
        tooltip="Max seconds before stopping (0 = no limit)"
      />
      <NumberField
        label="Startup Trials"
        value={sampler.nStartupTrials}
        onChange={(v) => setSampler("nStartupTrials", v)}
        min={0}
        disabled={disabled}
        tooltip="Random trials before model-based sampling"
      />
    </div>
  );
}

function BayesianForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  disabled?: boolean;
}) {
  const set = (k: string, v: any) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <SelectField
        label="Method"
        value={config.method ?? "gp"}
        options={[
          { value: "gp", label: "GP" },
          { value: "forest", label: "Random Forest" },
          { value: "gbrt", label: "GBRT" },
        ]}
        onChange={(v) => set("method", v)}
        disabled={disabled}
      />
      <SelectField
        label="Acquisition Fn"
        value={config.acquisitionFunction ?? "ei"}
        options={[
          { value: "ei", label: "EI" },
          { value: "ucb", label: "UCB (LCB)" },
          { value: "poi", label: "PI" },
        ]}
        onChange={(v) => set("acquisitionFunction", v)}
        disabled={disabled}
      />
      <NumberField
        label="Calls"
        value={config.nCalls}
        onChange={(v) => set("nCalls", v)}
        min={1}
        disabled={disabled}
        tooltip="Total evaluation calls"
      />
      <NumberField
        label="Initial Points"
        value={config.nInitialPoints}
        onChange={(v) => set("nInitialPoints", v)}
        min={1}
        disabled={disabled}
        tooltip="Random points before surrogate model kicks in"
      />
      <NumberField
        label="Xi"
        value={config.xi}
        onChange={(v) => set("xi", v)}
        step={0.001}
        min={0}
        disabled={disabled}
        tooltip="Exploration-exploitation trade-off (EI/PI)"
      />
    </div>
  );
}

function PSOForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  disabled?: boolean;
}) {
  const set = (k: string, v: any) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <NumberField
        label="Particles"
        value={config.nParticles}
        onChange={(v) => set("nParticles", v)}
        min={2}
        disabled={disabled}
      />
      <NumberField
        label="Iterations"
        value={config.nIterations}
        onChange={(v) => set("nIterations", v)}
        min={1}
        disabled={disabled}
      />
      <NumberField
        label="c₁ (cognitive)"
        value={config.c1}
        onChange={(v) => set("c1", v)}
        step={0.1}
        min={0}
        disabled={disabled}
        tooltip="Cognitive parameter — attraction to particle's own best"
      />
      <NumberField
        label="c₂ (social)"
        value={config.c2}
        onChange={(v) => set("c2", v)}
        step={0.1}
        min={0}
        disabled={disabled}
        tooltip="Social parameter — attraction to global best"
      />
      <NumberField
        label="w (inertia)"
        value={config.w}
        onChange={(v) => set("w", v)}
        step={0.01}
        min={0}
        max={1}
        disabled={disabled}
        tooltip="Inertia weight — momentum of previous velocity"
      />
      <SelectField
        label="Topology"
        value={config.topology ?? "global"}
        options={[
          { value: "global", label: "Global" },
          { value: "local", label: "Local" },
        ]}
        onChange={(v) => set("topology", v)}
        disabled={disabled}
      />
    </div>
  );
}

function MonteCarloForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  disabled?: boolean;
}) {
  const set = (k: string, v: any) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <SelectField
        label="Method"
        value={config.method ?? "lhs"}
        options={[
          { value: "random", label: "Random" },
          { value: "lhs", label: "Latin Hypercube" },
          { value: "sobol", label: "Sobol" },
        ]}
        onChange={(v) => set("method", v)}
        disabled={disabled}
      />
      <NumberField
        label="Samples"
        value={config.nSamples}
        onChange={(v) => set("nSamples", v)}
        min={1}
        disabled={disabled}
      />
    </div>
  );
}

function EvolutionaryForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  disabled?: boolean;
}) {
  const set = (k: string, v: any) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <SelectField
        label="Algorithm"
        value={config.algorithm ?? "cma"}
        options={[
          { value: "cma", label: "CMA-ES" },
          { value: "de", label: "Diff. Evolution" },
          { value: "two_points_de", label: "2-Point DE" },
          { value: "one_plus_one", label: "OnePlusOne" },
          { value: "pso_nevergrad", label: "PSO (Nevergrad)" },
        ]}
        onChange={(v) => set("algorithm", v)}
        disabled={disabled}
      />
      <NumberField
        label="Budget"
        value={config.budget}
        onChange={(v) => set("budget", v)}
        min={1}
        disabled={disabled}
        tooltip="Total function evaluations"
      />
      <NumberField
        label="Population"
        value={config.populationSize}
        onChange={(v) => set("populationSize", v)}
        min={2}
        disabled={disabled}
      />
    </div>
  );
}

function BOHBForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  disabled?: boolean;
}) {
  const set = (k: string, v: any) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <NumberField
        label="Trials"
        value={config.nTrials}
        onChange={(v) => set("nTrials", v)}
        min={1}
        disabled={disabled}
      />
      <NumberField
        label="Min Resource"
        value={config.minResource}
        onChange={(v) => set("minResource", v)}
        min={1}
        disabled={disabled}
        tooltip="Minimum resource allocation per trial"
      />
      <NumberField
        label="Max Resource"
        value={config.maxResource}
        onChange={(v) => set("maxResource", v)}
        min={1}
        disabled={disabled}
        tooltip="Maximum resource allocation per trial"
      />
      <NumberField
        label="Reduction Factor"
        value={config.reductionFactor}
        onChange={(v) => set("reductionFactor", v)}
        min={2}
        disabled={disabled}
        tooltip="Factor for successive halving reduction"
      />
    </div>
  );
}

function WandbSweepForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, any>;
  onChange: (c: Record<string, any>) => void;
  disabled?: boolean;
}) {
  const set = (k: string, v: any) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <SelectField
        label="Method"
        value={config.method ?? "bayes"}
        options={[
          { value: "bayes", label: "Bayesian" },
          { value: "grid", label: "Grid" },
          { value: "random", label: "Random" },
        ]}
        onChange={(v) => set("method", v)}
        disabled={disabled}
      />
      <SelectField
        label="Goal"
        value={config.metricGoal ?? "minimize"}
        options={[
          { value: "minimize", label: "Minimize" },
          { value: "maximize", label: "Maximize" },
        ]}
        onChange={(v) => set("metricGoal", v)}
        disabled={disabled}
      />
      <NumberField
        label="Max Runs"
        value={config.maxRuns}
        onChange={(v) => set("maxRuns", v)}
        min={1}
        disabled={disabled}
      />
      <div className="space-y-1">
        <Label className={fieldLabel}>Metric Name</Label>
        <Input
          className={fieldInput}
          value={config.metricName ?? ""}
          placeholder="e.g. log_likelihood"
          disabled={disabled}
          onChange={(e) => set("metricName", e.target.value)}
        />
      </div>
    </div>
  );
}

const OPTIMIZER_FORMS: Record<
  OptimizerType,
  React.ComponentType<{
    config: Record<string, any>;
    onChange: (c: Record<string, any>) => void;
    disabled?: boolean;
  }>
> = {
  optuna: OptunaForm,
  bayesian: BayesianForm,
  pso: PSOForm,
  montecarlo: MonteCarloForm,
  evolutionary: EvolutionaryForm,
  bohb: BOHBForm,
};

// ─── Search Space Param Row ─────────────────────────────────────────────────

function ParamRow({
  paramKey,
  hp,
  dimension,
  included,
  onToggle,
  onDimensionChange,
  disabled,
}: {
  paramKey: string;
  hp: HyperparameterDef;
  dimension: SearchDimension;
  included: boolean;
  onToggle: (key: string, on: boolean) => void;
  onDimensionChange: (key: string, dim: SearchDimension) => void;
  disabled?: boolean;
}) {
  const dimType = dimension.type;
  const isNumeric = dimType === "int" || dimType === "float";

  const updateDim = (patch: Partial<SearchDimension>) =>
    onDimensionChange(paramKey, { ...dimension, ...patch });

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 transition-colors",
        included
          ? "border-orange-500/25 bg-orange-500/5"
          : "border-white/6 bg-white/[0.02]",
      )}
    >
      {/* header row */}
      <div className="flex items-center gap-2">
        <Switch
          checked={included}
          onCheckedChange={(v) => onToggle(paramKey, v)}
          disabled={disabled}
          className="scale-75 origin-left"
        />
        <span className="text-xs font-medium truncate flex-1" title={hp.label}>
          {hp.label}
        </span>
        <Badge
          variant="outline"
          className="text-[9px] px-1.5 py-0 font-mono shrink-0"
        >
          {dimType}
        </Badge>
        {hp.description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground/40 shrink-0 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px] max-w-56">
              {hp.description}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* range editor — visible only when included */}
      {included && (
        <div className="mt-2 pl-6">
          {isNumeric && (
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-0.5">
                <Label className="text-[9px] text-muted-foreground/60">Low</Label>
                <Input
                  type="number"
                  className={cn(fieldInput, "h-6 text-[11px]")}
                  value={dimension.low ?? ""}
                  step={dimension.step ?? (dimType === "int" ? 1 : 0.01)}
                  disabled={disabled}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) updateDim({ low: v });
                  }}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[9px] text-muted-foreground/60">High</Label>
                <Input
                  type="number"
                  className={cn(fieldInput, "h-6 text-[11px]")}
                  value={dimension.high ?? ""}
                  step={dimension.step ?? (dimType === "int" ? 1 : 0.01)}
                  disabled={disabled}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) updateDim({ high: v });
                  }}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[9px] text-muted-foreground/60">Step</Label>
                <Input
                  type="number"
                  className={cn(fieldInput, "h-6 text-[11px]")}
                  value={dimension.step ?? ""}
                  min={0}
                  disabled={disabled}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v > 0) updateDim({ step: v });
                  }}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[9px] text-muted-foreground/60">Dist</Label>
                <Select
                  value={dimension.distribution ?? "uniform"}
                  onValueChange={(v) =>
                    updateDim({ distribution: v as DistributionType })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger className="h-6 rounded-md bg-white/5 border-white/10 text-[11px] px-1.5 [&>span]:text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/10">
                    <SelectItem value="uniform" className="text-[11px]">Uniform</SelectItem>
                    <SelectItem value="loguniform" className="text-[11px]">Log-uniform</SelectItem>
                    <SelectItem value="normal" className="text-[11px]">Normal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* logScale toggle */}
              <div className="col-span-4 flex items-center gap-1.5 mt-0.5">
                <Switch
                  checked={dimension.logScale ?? false}
                  onCheckedChange={(v) => updateDim({ logScale: v })}
                  disabled={disabled}
                  className="scale-[0.6] origin-left"
                />
                <span className="text-[9px] text-muted-foreground/60">
                  Log scale
                </span>
              </div>
            </div>
          )}

          {dimType === "categorical" && (
            <div className="space-y-1">
              <Label className="text-[9px] text-muted-foreground/60">
                Choices
              </Label>
              <div className="flex flex-wrap gap-1">
                {(hp.choices ?? []).map((choice) => {
                  const active = dimension.choices?.includes(choice) ?? false;
                  return (
                    <button
                      key={String(choice)}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        const current = dimension.choices ?? [];
                        const next = active
                          ? current.filter((c) => c !== choice)
                          : [...current, choice];
                        updateDim({ choices: next });
                      }}
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                        active
                          ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
                          : "bg-white/5 border-white/10 text-muted-foreground/60 hover:bg-white/10",
                        disabled && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      {String(choice)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {dimType === "bool" && (
            <span className="text-[9px] text-muted-foreground/50 italic">
              true / false (no config needed)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function HPOConfigPanel({
  optimizerType,
  onOptimizerTypeChange,
  optimizerConfig,
  onOptimizerConfigChange,
  searchSpace,
  onSearchSpaceChange,
  hyperparameters,
  disabled = false,
  className,
}: HPOConfigPanelProps) {
  // derive dimension defaults for each hyperparameter
  const defaultDimensions = useMemo(() => {
    const dims: Record<string, SearchDimension> = {};
    for (const [key, hp] of Object.entries(hyperparameters)) {
      dims[key] = dimFromHpDef(hp);
    }
    return dims;
  }, [hyperparameters]);

  const includedCount = Object.keys(searchSpace).length;
  const totalParams = Object.keys(hyperparameters).length;
  const evals = estimateEvaluations(optimizerType, optimizerConfig);

  const grouped = useMemo(() => groupParams(hyperparameters), [hyperparameters]);

  // ── Search space callbacks

  const toggleParam = useCallback(
    (key: string, on: boolean) => {
      const next = { ...searchSpace };
      if (on) {
        next[key] = searchSpace[key] ?? defaultDimensions[key]!;
      } else {
        delete next[key];
      }
      onSearchSpaceChange(next);
    },
    [searchSpace, defaultDimensions, onSearchSpaceChange],
  );

  const updateDimension = useCallback(
    (key: string, dim: SearchDimension) => {
      onSearchSpaceChange({ ...searchSpace, [key]: dim });
    },
    [searchSpace, onSearchSpaceChange],
  );

  const selectAll = useCallback(() => {
    const next: SearchSpaceDef = {};
    for (const key of Object.keys(hyperparameters)) {
      next[key] = searchSpace[key] ?? defaultDimensions[key]!;
    }
    onSearchSpaceChange(next);
  }, [hyperparameters, searchSpace, defaultDimensions, onSearchSpaceChange]);

  const deselectAll = useCallback(() => {
    onSearchSpaceChange({});
  }, [onSearchSpaceChange]);

  // ── Optimizer form

  const OptimizerForm = OPTIMIZER_FORMS[optimizerType];
  const meta = OPTIMIZER_META[optimizerType];

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("space-y-4", className)}>
        <Tabs defaultValue="optimizer" className="w-full">
          <TabsList className="w-full justify-start bg-transparent border-b border-white/5 rounded-none h-auto p-0 gap-0">
            <TabsTrigger
              value="optimizer"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500
                         data-[state=active]:bg-transparent data-[state=active]:text-orange-400
                         text-muted-foreground/60 text-xs px-3 py-2 transition-colors"
            >
              <ToggleLeft className="h-3 w-3 mr-1.5" />
              Optimizer
            </TabsTrigger>
            <TabsTrigger
              value="search-space"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500
                         data-[state=active]:bg-transparent data-[state=active]:text-orange-400
                         text-muted-foreground/60 text-xs px-3 py-2 transition-colors"
            >
              <Search className="h-3 w-3 mr-1.5" />
              Search Space
              {includedCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 text-[9px] px-1 py-0 h-4 bg-orange-500/20 text-orange-300 border-0"
                >
                  {includedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Tab A: Optimizer selection + config ── */}
          <TabsContent value="optimizer" className="mt-3 space-y-3">
            {/* Optimizer picker */}
            <div className="space-y-1">
              <Label className={fieldLabel}>Optimizer Engine</Label>
              <Select
                value={optimizerType}
                onValueChange={(v) => onOptimizerTypeChange(v as OptimizerType)}
                disabled={disabled}
              >
                <SelectTrigger className="h-9 rounded-lg bg-white/5 border-white/10 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a2e] border-white/10">
                  {(Object.entries(OPTIMIZER_META) as [OptimizerType, OptimizerMeta][]).map(
                    ([key, m]) => {
                      const Icon = m.icon;
                      return (
                        <SelectItem key={key} value={key} className="text-xs py-2">
                          <div className="flex items-center gap-2">
                            <Icon className={cn("h-3.5 w-3.5 shrink-0", m.color)} />
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">{m.label}</span>
                              <span className="text-[9px] text-muted-foreground/50">
                                {m.description}
                              </span>
                            </div>
                          </div>
                        </SelectItem>
                      );
                    },
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Active optimizer description badge */}
            <div className="flex items-center gap-2 px-1">
              {(() => {
                const Icon = meta.icon;
                return <Icon className={cn("h-4 w-4 shrink-0", meta.color)} />;
              })()}
              <span className="text-[10px] text-muted-foreground/60">
                {meta.description}
              </span>
            </div>

            {/* Per-optimizer config */}
            <div className="p-3 rounded-lg border border-white/6 bg-white/[0.02]">
              <OptimizerForm
                config={optimizerConfig}
                onChange={onOptimizerConfigChange}
                disabled={disabled}
              />
            </div>

            {/* Evaluation estimate */}
            <div className="flex items-center justify-between px-1 py-1.5 rounded-md bg-white/[0.03]">
              <span className="text-[10px] text-muted-foreground/50">
                Est. evaluations
              </span>
              <span className="text-xs font-mono text-orange-400">
                ~{evals.toLocaleString()}
              </span>
            </div>
          </TabsContent>

          {/* ── Tab B: Search Space Editor ── */}
          <TabsContent value="search-space" className="mt-3 space-y-3">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={selectAll}
                  disabled={disabled}
                  className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                >
                  <CheckSquare className="h-3 w-3 mr-1" />
                  Select All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={deselectAll}
                  disabled={disabled}
                  className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                >
                  <XSquare className="h-3 w-3 mr-1" />
                  Deselect All
                </Button>
              </div>
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 font-mono"
              >
                {includedCount}/{totalParams} params &middot; ~
                {(includedCount * evals).toLocaleString()} evals
              </Badge>
            </div>

            {/* Grouped param list */}
            {Object.keys(grouped).length > 1 ? (
              <Accordion
                type="multiple"
                defaultValue={Object.keys(grouped)}
                className="space-y-1"
              >
                {Object.entries(grouped).map(([group, keys]) => (
                  <AccordionItem
                    key={group}
                    value={group}
                    className="border-white/6 rounded-lg overflow-hidden"
                  >
                    <AccordionTrigger className="text-[10px] uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground px-2 py-1.5 hover:no-underline">
                      {group}
                      <Badge
                        variant="secondary"
                        className="ml-auto mr-2 text-[8px] px-1 py-0 h-3.5 bg-white/5 border-0"
                      >
                        {keys.filter((k) => k in searchSpace).length}/{keys.length}
                      </Badge>
                    </AccordionTrigger>
                    <AccordionContent className="px-1 pb-1 space-y-1">
                      {keys.map((key) => (
                        <ParamRow
                          key={key}
                          paramKey={key}
                          hp={hyperparameters[key]!}
                          dimension={searchSpace[key] ?? defaultDimensions[key]!}
                          included={key in searchSpace}
                          onToggle={toggleParam}
                          onDimensionChange={updateDimension}
                          disabled={disabled}
                        />
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              <div className="space-y-1">
                {Object.keys(hyperparameters).map((key) => (
                  <ParamRow
                    key={key}
                    paramKey={key}
                    hp={hyperparameters[key]!}
                    dimension={searchSpace[key] ?? defaultDimensions[key]!}
                    included={key in searchSpace}
                    onToggle={toggleParam}
                    onDimensionChange={updateDimension}
                    disabled={disabled}
                  />
                ))}
              </div>
            )}

            {totalParams === 0 && (
              <div className="text-center py-6 text-xs text-muted-foreground/40 italic">
                No hyperparameters defined for this model
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
