import React, { useCallback, useMemo } from "react";
import { RotateCcw, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { HyperparameterDef } from "@shared/trainingTypes";

export interface HyperparameterFormProps {
  hyperparameters: Record<string, HyperparameterDef>;
  values: Record<string, number | string | boolean>;
  onChange: (key: string, value: number | string | boolean) => void;
  onReset?: () => void;
  disabled?: boolean;
  className?: string;
  showSearchSpace?: boolean;
}

type ParamValue = number | string | boolean;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveType(def: HyperparameterDef): NonNullable<HyperparameterDef["type"]> {
  if (def.type) return def.type;
  if (def.choices && def.choices.length > 0) return "categorical";
  return (def.step ?? 1) >= 1 ? "int" : "float";
}

function clampAndQuantize(v: number, min: number, max: number, step: number, isInt: boolean): number {
  let clamped = Math.min(max, Math.max(min, v));
  if (isInt) {
    clamped = Math.round((clamped - min) / step) * step + min;
    clamped = Math.round(clamped);
  } else {
    clamped = Math.round((clamped - min) / step) * step + min;
    // Fix floating-point precision
    const decimals = step.toString().split(".")[1]?.length ?? 2;
    clamped = parseFloat(clamped.toFixed(decimals));
  }
  return Math.min(max, Math.max(min, clamped));
}

/** Compute the percentage position of a value within [min, max]. */
function pct(v: number, min: number, max: number): number {
  if (max === min) return 0;
  return ((v - min) / (max - min)) * 100;
}

// ---------------------------------------------------------------------------
// Memoised parameter row components
// ---------------------------------------------------------------------------

interface SliderRowProps {
  paramKey: string;
  def: HyperparameterDef;
  value: number;
  onChange: (key: string, value: ParamValue) => void;
  disabled?: boolean;
  showSearchSpace?: boolean;
  isInt: boolean;
}

const SliderRow = React.memo<SliderRowProps>(function SliderRow({
  paramKey,
  def,
  value,
  onChange,
  disabled,
  showSearchSpace,
  isInt,
}) {
  const min = def.min ?? 0;
  const max = def.max ?? 100;
  const step = def.step ?? (isInt ? 1 : 0.01);
  const { searchSpace } = def;
  const decimals = isInt ? 0 : (step.toString().split(".")[1]?.length ?? 2);

  const handleSlider = useCallback(
    (vals: number[]) => {
      const raw = vals[0] ?? min;
      onChange(paramKey, clampAndQuantize(raw, min, max, step, isInt));
    },
    [paramKey, onChange, min, max, step, isInt],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = parseFloat(e.target.value);
      if (Number.isNaN(raw)) return;
      onChange(paramKey, clampAndQuantize(raw, min, max, step, isInt));
    },
    [paramKey, onChange, min, max, step, isInt],
  );

  // Search-space indicator positions
  const ssLeft = showSearchSpace && searchSpace?.min != null ? pct(searchSpace.min, min, max) : null;
  const ssRight = showSearchSpace && searchSpace?.max != null ? pct(searchSpace.max, min, max) : null;

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 min-w-0">
        {ssLeft != null && ssRight != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full bg-primary/10 pointer-events-none"
            style={{ left: `${ssLeft}%`, width: `${ssRight - ssLeft}%` }}
          />
        )}
        <Slider
          className="py-1"
          min={min}
          max={max}
          step={step}
          value={[value]}
          onValueChange={handleSlider}
          disabled={disabled}
        />
      </div>
      <Input
        type="number"
        className="h-6 w-[72px] shrink-0 px-1.5 text-xs font-mono text-center bg-white/5 border-white/10"
        min={min}
        max={max}
        step={step}
        value={value.toFixed(decimals)}
        onChange={handleInput}
        disabled={disabled}
      />
    </div>
  );
});

// ---

interface CategoricalRowProps {
  paramKey: string;
  choices: (string | number | boolean)[];
  value: string;
  onChange: (key: string, value: ParamValue) => void;
  disabled?: boolean;
}

const CategoricalRow = React.memo<CategoricalRowProps>(function CategoricalRow({
  paramKey,
  choices,
  value,
  onChange,
  disabled,
}) {
  const handleChange = useCallback(
    (v: string) => {
      // Attempt to coerce back to the original type of the choice
      const match = choices.find((c) => String(c) === v);
      onChange(paramKey, match ?? v);
    },
    [paramKey, onChange, choices],
  );

  return (
    <Select value={String(value)} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger className="h-7 text-xs bg-white/5 border-white/10">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={String(c)} value={String(c)} className="text-xs">
            {String(c)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});

// ---

interface BoolRowProps {
  paramKey: string;
  value: boolean;
  onChange: (key: string, value: ParamValue) => void;
  disabled?: boolean;
}

const BoolRow = React.memo<BoolRowProps>(function BoolRow({
  paramKey,
  value,
  onChange,
  disabled,
}) {
  const handleChange = useCallback(
    (checked: boolean) => onChange(paramKey, checked),
    [paramKey, onChange],
  );

  return <Switch checked={value} onCheckedChange={handleChange} disabled={disabled} />;
});

// ---------------------------------------------------------------------------
// Single parameter row with label + tooltip
// ---------------------------------------------------------------------------

interface ParamRowProps {
  paramKey: string;
  def: HyperparameterDef;
  value: ParamValue;
  onChange: (key: string, value: ParamValue) => void;
  disabled?: boolean;
  showSearchSpace?: boolean;
}

const ParamRow = React.memo<ParamRowProps>(function ParamRow({
  paramKey,
  def,
  value,
  onChange,
  disabled,
  showSearchSpace,
}) {
  const type = resolveType(def);
  const isInt = type === "int";

  const label = (
    <div className="flex items-center gap-1 mb-1">
      <Label className="text-[10px] text-muted-foreground leading-none">
        {def.label}
      </Label>
      {def.description && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3 w-3 text-muted-foreground/50 cursor-help shrink-0" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[240px] text-xs">
            {def.description}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  if (type === "bool") {
    return (
      <div className="flex items-center justify-between py-1">
        <div className="flex items-center gap-1">
          <Label className="text-[10px] text-muted-foreground leading-none">
            {def.label}
          </Label>
          {def.description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/50 cursor-help shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] text-xs">
                {def.description}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <BoolRow
          paramKey={paramKey}
          value={Boolean(value)}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    );
  }

  if (type === "categorical") {
    return (
      <div className="py-1">
        {label}
        <CategoricalRow
          paramKey={paramKey}
          choices={def.choices ?? []}
          value={String(value)}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    );
  }

  // int | float → slider + input
  const numVal = typeof value === "number" ? value : Number(def.default);
  return (
    <div className="py-1">
      {label}
      <SliderRow
        paramKey={paramKey}
        def={def}
        value={numVal}
        onChange={onChange}
        disabled={disabled}
        showSearchSpace={showSearchSpace}
        isInt={isInt}
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px] text-muted-foreground/50 font-mono">{def.min ?? ""}</span>
        <span className="font-mono text-[10px] text-primary">
          {isInt ? numVal : numVal.toFixed((def.step ?? 0.01).toString().split(".")[1]?.length ?? 2)}
        </span>
        <span className="text-[9px] text-muted-foreground/50 font-mono">{def.max ?? ""}</span>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main form component
// ---------------------------------------------------------------------------

function HyperparameterForm({
  hyperparameters,
  values,
  onChange,
  onReset,
  disabled = false,
  className,
  showSearchSpace = false,
}: HyperparameterFormProps) {
  // Group params by group field
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; def: HyperparameterDef }[]>();
    for (const [key, def] of Object.entries(hyperparameters)) {
      const group = def.group ?? "General";
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push({ key, def });
    }
    return map;
  }, [hyperparameters]);

  const groupNames = useMemo(() => Array.from(groups.keys()), [groups]);

  // Evaluate conditional visibility
  const isVisible = useCallback(
    (def: HyperparameterDef): boolean => {
      if (!def.conditionalOn) return true;
      const depVal = values[def.conditionalOn.param];
      return depVal === def.conditionalOn.value;
    },
    [values],
  );

  // Reset handler — prefer external onReset, fallback to resetting to defaults
  const handleReset = useCallback(() => {
    if (onReset) {
      onReset();
      return;
    }
    for (const [key, def] of Object.entries(hyperparameters)) {
      const type = resolveType(def);
      if (type === "bool") {
        onChange(key, Boolean(def.default));
      } else if (type === "categorical") {
        onChange(key, def.choices?.[0] ?? def.default);
      } else {
        onChange(key, def.default);
      }
    }
  }, [onReset, hyperparameters, onChange]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("space-y-1", className)}>
        {/* Header with reset */}
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[9px] text-muted-foreground/50 uppercase tracking-widest">
            Hyperparameters
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground gap-1"
            onClick={handleReset}
            disabled={disabled}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>

        {/* Grouped accordion */}
        <Accordion
          type="multiple"
          defaultValue={groupNames}
          className="space-y-0"
        >
          {groupNames.map((groupName) => {
            const params = groups.get(groupName)!;
            const visibleParams = params.filter(({ def }) => isVisible(def));
            if (visibleParams.length === 0) return null;

            return (
              <AccordionItem
                key={groupName}
                value={groupName}
                className="border-b border-white/5"
              >
                <AccordionTrigger className="py-2 text-[11px] text-muted-foreground hover:no-underline">
                  {groupName}
                </AccordionTrigger>
                <AccordionContent className="pb-2 pt-0">
                  <div className="space-y-1.5 px-0.5">
                    {visibleParams.map(({ key, def }) => (
                      <ParamRow
                        key={key}
                        paramKey={key}
                        def={def}
                        value={values[key] ?? def.default}
                        onChange={onChange}
                        disabled={disabled}
                        showSearchSpace={showSearchSpace}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </TooltipProvider>
  );
}

export default React.memo(HyperparameterForm);
