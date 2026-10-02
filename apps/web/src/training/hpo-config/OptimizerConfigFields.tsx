import React from "react";
import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import type { OptimizerType } from "@shared/hpoTypes";
import {
  asRecord,
  readOptunaFormConfig,
  readBayesianFormConfig,
  readPSOFormConfig,
  readMonteCarloFormConfig,
  readEvolutionaryFormConfig,
  readBOHBFormConfig,
} from "@/training/lib/types";

// ─── Constants ──────────────────────────────────────────────────────────────

export const fieldLabel = "text-[10px] text-muted-foreground uppercase tracking-wider";
export const fieldInput =
  "h-7 rounded-md bg-white/5 border-white/10 text-xs font-mono px-2 focus:ring-1 focus:ring-orange-500/50";
export const fieldSelect =
  "h-7 rounded-md bg-white/5 border-white/10 text-xs [&>span]:text-xs";

// ─── Compact field primitives ───────────────────────────────────────────────

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

export function NumberField({
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

export function SelectField({
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
// Each form receives `config` as the raw wire/storage bag
// (`Record<string, unknown>` — see HPOConfigPanel's `optimizerConfig` prop,
// seeded from `DEFAULT_OPTIMIZER_CONFIGS` in `@shared/hpoTypes`). Every read
// goes through the matching `read*FormConfig()` accessor in
// `@/training/lib/types`, which narrows each field with a runtime type guard
// (never asserts) and applies the same defaults this file previously inlined
// via `??`. Writes still merge back into the untyped bag — `onChange` is
// `(c: Record<string, unknown>) => void` on every form, matching
// `OPTIMIZER_FORMS`'s declared shape and `HPOConfigPanel`'s prop types.

export function OptunaForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const parsed = readOptunaFormConfig(config);
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  const setSampler = (k: string, v: unknown) =>
    onChange({ ...config, sampler: { ...asRecord(config.sampler), [k]: v } });
  const setPruner = (k: string, v: unknown) =>
    onChange({ ...config, pruner: { ...asRecord(config.pruner), [k]: v } });

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <SelectField
        label="Sampler"
        value={parsed.sampler.type}
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
        value={parsed.pruner.type}
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
        value={parsed.nTrials}
        onChange={(v) => set("nTrials", v)}
        min={1}
        disabled={disabled}
        tooltip="Total number of optimization trials"
      />
      <SelectField
        label="Direction"
        value={parsed.direction}
        options={[
          { value: "minimize", label: "Minimize" },
          { value: "maximize", label: "Maximize" },
        ]}
        onChange={(v) => set("direction", v)}
        disabled={disabled}
      />
      <NumberField
        label="Timeout (s)"
        value={parsed.timeout}
        onChange={(v) => set("timeout", v)}
        min={0}
        disabled={disabled}
        tooltip="Max seconds before stopping (0 = no limit)"
      />
      <NumberField
        label="Startup Trials"
        value={parsed.sampler.nStartupTrials}
        onChange={(v) => setSampler("nStartupTrials", v)}
        min={0}
        disabled={disabled}
        tooltip="Random trials before model-based sampling"
      />
    </div>
  );
}

export function BayesianForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const parsed = readBayesianFormConfig(config);
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <SelectField
        label="Method"
        value={parsed.method}
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
        value={parsed.acquisitionFunction}
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
        value={parsed.nCalls}
        onChange={(v) => set("nCalls", v)}
        min={1}
        disabled={disabled}
        tooltip="Total evaluation calls"
      />
      <NumberField
        label="Initial Points"
        value={parsed.nInitialPoints}
        onChange={(v) => set("nInitialPoints", v)}
        min={1}
        disabled={disabled}
        tooltip="Random points before surrogate model kicks in"
      />
      <NumberField
        label="Xi"
        value={parsed.xi}
        onChange={(v) => set("xi", v)}
        step={0.001}
        min={0}
        disabled={disabled}
        tooltip="Exploration-exploitation trade-off (EI/PI)"
      />
    </div>
  );
}

export function PSOForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const parsed = readPSOFormConfig(config);
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <NumberField
        label="Particles"
        value={parsed.nParticles}
        onChange={(v) => set("nParticles", v)}
        min={2}
        disabled={disabled}
      />
      <NumberField
        label="Iterations"
        value={parsed.nIterations}
        onChange={(v) => set("nIterations", v)}
        min={1}
        disabled={disabled}
      />
      <NumberField
        label="c₁ (cognitive)"
        value={parsed.c1}
        onChange={(v) => set("c1", v)}
        step={0.1}
        min={0}
        disabled={disabled}
        tooltip="Cognitive parameter — attraction to particle's own best"
      />
      <NumberField
        label="c₂ (social)"
        value={parsed.c2}
        onChange={(v) => set("c2", v)}
        step={0.1}
        min={0}
        disabled={disabled}
        tooltip="Social parameter — attraction to global best"
      />
      <NumberField
        label="w (inertia)"
        value={parsed.w}
        onChange={(v) => set("w", v)}
        step={0.01}
        min={0}
        max={1}
        disabled={disabled}
        tooltip="Inertia weight — momentum of previous velocity"
      />
      <SelectField
        label="Topology"
        value={parsed.topology}
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

export function MonteCarloForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const parsed = readMonteCarloFormConfig(config);
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <SelectField
        label="Method"
        value={parsed.method}
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
        value={parsed.nSamples}
        onChange={(v) => set("nSamples", v)}
        min={1}
        disabled={disabled}
      />
    </div>
  );
}

export function EvolutionaryForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const parsed = readEvolutionaryFormConfig(config);
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <SelectField
        label="Algorithm"
        value={parsed.algorithm}
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
        value={parsed.budget}
        onChange={(v) => set("budget", v)}
        min={1}
        disabled={disabled}
        tooltip="Total function evaluations"
      />
      <NumberField
        label="Population"
        value={parsed.populationSize}
        onChange={(v) => set("populationSize", v)}
        min={2}
        disabled={disabled}
      />
    </div>
  );
}

export function BOHBForm({
  config,
  onChange,
  disabled,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const parsed = readBOHBFormConfig(config);
  const set = (k: string, v: unknown) => onChange({ ...config, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <NumberField
        label="Trials"
        value={parsed.nTrials}
        onChange={(v) => set("nTrials", v)}
        min={1}
        disabled={disabled}
      />
      <NumberField
        label="Min Resource"
        value={parsed.minResource}
        onChange={(v) => set("minResource", v)}
        min={1}
        disabled={disabled}
        tooltip="Minimum resource allocation per trial"
      />
      <NumberField
        label="Max Resource"
        value={parsed.maxResource}
        onChange={(v) => set("maxResource", v)}
        min={1}
        disabled={disabled}
        tooltip="Maximum resource allocation per trial"
      />
      <NumberField
        label="Reduction Factor"
        value={parsed.reductionFactor}
        onChange={(v) => set("reductionFactor", v)}
        min={2}
        disabled={disabled}
        tooltip="Factor for successive halving reduction"
      />
    </div>
  );
}

export const OPTIMIZER_FORMS: Record<
  OptimizerType,
  React.ComponentType<{
    config: Record<string, unknown>;
    onChange: (c: Record<string, unknown>) => void;
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
