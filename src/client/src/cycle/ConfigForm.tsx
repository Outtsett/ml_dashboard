/**
 * Model Cycle setup form: pick a family, its hyperparameters, the data
 * window and the walk-forward/label/trading/tuning/replay/runtime settings
 * that back it. Fully controlled — `CyclePage` owns the `CycleFormState` and
 * passes it down; this file owns the catalog read (`useCycleCatalog`), the
 * per-family localStorage memory, and validation.
 */
import { useCallback, useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/shared/utils/utils";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import HyperparameterForm from "@/training/HyperparameterForm";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { minutesToLabel } from "@/market/lib/timeframes";
import type { HyperparameterDef } from "@shared/trainingTypes";
import type { CycleModelFamily } from "@shared/cycle/schema";

import { parameterHelpFor } from "@/cycle/parameterHelp";
import { useCycleCatalog, type CycleCatalogEntry } from "@/cycle/useCycleCatalog";

// ─── Form state (owned here, held by CyclePage) ─────────────────────────────

export interface CycleFormState {
  /** Runner key, `"<family>+walk_forward_cycle"`; null until a family is picked. */
  familyKey: string | null;
  timeframe: string;
  /** ISO date, `YYYY-MM-DD`. */
  dateStart: string;
  dateEnd: string;
  hyperparameters: Record<string, number | string | boolean>;
}

export const CYCLE_TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "30m", "1h"] as const;
export const CYCLE_DEFAULT_TIMEFRAME = "5m";
export const CYCLE_DEFAULT_DATE_START = "2025-08-01";
export const CYCLE_DEFAULT_DATE_END = "2025-12-30";

export function createInitialCycleFormState(): CycleFormState {
  return {
    familyKey: null,
    timeframe: CYCLE_DEFAULT_TIMEFRAME,
    dateStart: CYCLE_DEFAULT_DATE_START,
    dateEnd: CYCLE_DEFAULT_DATE_END,
    hyperparameters: {},
  };
}

function defaultHyperparameterValues(hyperparameters: Record<string, HyperparameterDef>): Record<string, number | string | boolean> {
  const values: Record<string, number | string | boolean> = {};
  for (const [key, def] of Object.entries(hyperparameters)) values[key] = def.default;
  return values;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface CycleFormValidation {
  valid: boolean;
  errors: string[];
}

export function validateCycleForm(state: CycleFormState): CycleFormValidation {
  const errors: string[] = [];
  if (!state.familyKey) errors.push("Choose a model family.");

  if (state.hyperparameters.step_days !== undefined) {
    const stepDays = Number(state.hyperparameters.step_days);
    const testDays = Number(state.hyperparameters.test_days ?? 0);
    if (!(stepDays === 0 || stepDays >= testDays)) {
      errors.push(`Step days (${stepDays}) must be 0 or at least the test window (${testDays} days).`);
    }
  }

  if (state.dateStart && state.dateEnd && !(state.dateEnd > state.dateStart)) {
    errors.push("Date end must be after date start.");
  }

  return { valid: errors.length === 0, errors };
}

// ─── Per-family memory ───────────────────────────────────────────────────────

/** The family picked last, so a reload opens on it. */
const LAST_FAMILY_KEY = "cycle-last-family-v1";

function storageKey(familyKey: string): string {
  return `cycle-config-${familyKey}-v1`;
}

function loadStoredState(familyKey: string): Partial<CycleFormState> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(familyKey));
    return raw ? (JSON.parse(raw) as Partial<CycleFormState>) : null;
  } catch {
    return null; // private window, blocked site data, malformed entry
  }
}

function saveStoredState(state: CycleFormState): void {
  if (!state.familyKey) return;
  try {
    window.localStorage.setItem(storageKey(state.familyKey), JSON.stringify(state));
  } catch {
    // Best effort — the form still works for this session.
  }
}

// ─── Family picker ───────────────────────────────────────────────────────────

type FamilyKind = "Linear" | "Tree ensemble" | "Neural network" | "Sequence network";

const FAMILY_KIND: Record<CycleModelFamily, FamilyKind> = {
  logistic_regression: "Linear",
  random_forest: "Tree ensemble",
  xgboost: "Tree ensemble",
  lightgbm: "Tree ensemble",
  multilayer_perceptron: "Neural network",
  lstm: "Sequence network",
  temporal_convolution_network: "Sequence network",
  transformer_encoder: "Sequence network",
};

const FAMILY_DESCRIPTION: Record<CycleModelFamily, string> = {
  logistic_regression: "A single weighted vote across your features — a scale that tips toward up or down.",
  random_forest: "Hundreds of simple yes/no trees vote together — a committee of rough guessers whose average is sharper than any one of them.",
  xgboost: "Trees built one after another, each one fixing the last one's mistakes.",
  lightgbm: "The same fix-the-mistakes idea as XGBoost, built leaf by leaf instead of level by level — faster on wide feature sets.",
  multilayer_perceptron: "A stack of weighted layers that reshapes your features step by step into one probability.",
  lstm: "Reads the bars in order, keeping a running memory of what it has seen — built for patterns that unfold over time.",
  temporal_convolution_network: "Slides a small window across the recent bars, like a pattern scanner looking for the same shape at different points.",
  transformer_encoder: "Looks at every recent bar at once and learns which ones matter most — the network deciding its own attention span.",
};

const KIND_BADGE_CLASS: Record<FamilyKind, string> = {
  Linear: "border-[#0072B2]/40 text-[#56B4E9] bg-[#0072B2]/10",
  "Tree ensemble": "border-[#009E73]/40 text-[#009E73] bg-[#009E73]/10",
  "Neural network": "border-[#E69F00]/40 text-[#E69F00] bg-[#E69F00]/10",
  "Sequence network": "border-[#CC79A7]/40 text-[#CC79A7] bg-[#CC79A7]/10",
};

function FamilyCard({ entry, selected, disabled, onSelect }: { entry: CycleCatalogEntry; selected: boolean; disabled?: boolean; onSelect: () => void }) {
  const kind = FAMILY_KIND[entry.family];
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "text-left rounded-lg border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0072B2]",
        selected ? "border-[#E69F00] bg-[#E69F00]/10" : "border-white/10 bg-white/[0.02] hover:border-white/25",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-neutral-100">{entry.label}</span>
        <Badge variant="outline" className={cn("shrink-0 text-[10px]", KIND_BADGE_CLASS[kind])}>
          {kind}
        </Badge>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-neutral-400">{FAMILY_DESCRIPTION[entry.family] ?? entry.description ?? ""}</p>
    </button>
  );
}

// ─── Main form ───────────────────────────────────────────────────────────────

export interface ConfigFormProps {
  value: CycleFormState;
  onChange: (next: CycleFormState) => void;
  disabled?: boolean;
}

export function ConfigForm({ value, onChange, disabled = false }: ConfigFormProps) {
  const { entries, isLoading } = useCycleCatalog();
  const { symbol } = useSymbolContext();
  const selectedEntry = value.familyKey ? entries.find((entry) => entry.key === value.familyKey) : undefined;
  const validation = validateCycleForm(value);

  const emit = useCallback(
    (next: CycleFormState) => {
      onChange(next);
      saveStoredState(next);
    },
    [onChange],
  );

  const selectFamily = useCallback(
    (entry: CycleCatalogEntry) => {
      const stored = loadStoredState(entry.key);
      const defaults = defaultHyperparameterValues(entry.hyperparameters);
      const hyperparameters: Record<string, number | string | boolean> = {};
      for (const key of Object.keys(defaults)) {
        hyperparameters[key] = stored?.hyperparameters?.[key] ?? defaults[key]!;
      }
      try {
        window.localStorage.setItem(LAST_FAMILY_KEY, entry.key);
      } catch {
        // storage unavailable (private window, blocked site data): nothing to remember
      }
      emit({
        familyKey: entry.key,
        timeframe: stored?.timeframe ?? value.timeframe,
        dateStart: stored?.dateStart ?? value.dateStart,
        dateEnd: stored?.dateEnd ?? value.dateEnd,
        hyperparameters,
      });
    },
    [emit, value.timeframe, value.dateStart, value.dateEnd],
  );

  // After a reload, come back to the family used last (once the catalog is in).
  useEffect(() => {
    if (value.familyKey || entries.length === 0) return;
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(LAST_FAMILY_KEY);
    } catch {
      remembered = null;
    }
    const entry = remembered ? entries.find((candidate) => candidate.key === remembered) : undefined;
    if (entry) selectFamily(entry);
  }, [entries, value.familyKey, selectFamily]);

  const setTimeframe = useCallback((timeframe: string) => emit({ ...value, timeframe }), [emit, value]);
  const setDateStart = useCallback((dateStart: string) => emit({ ...value, dateStart }), [emit, value]);
  const setDateEnd = useCallback((dateEnd: string) => emit({ ...value, dateEnd }), [emit, value]);

  const setHyperparameter = useCallback(
    (key: string, hyperValue: number | string | boolean) => {
      emit({ ...value, hyperparameters: { ...value.hyperparameters, [key]: hyperValue } });
    },
    [emit, value],
  );

  const resetHyperparameters = useCallback(() => {
    if (!selectedEntry) return;
    emit({ ...value, hyperparameters: defaultHyperparameterValues(selectedEntry.hyperparameters) });
  }, [emit, value, selectedEntry]);

  // Rebuild the hyperparameter map in the plan's group order so the reused
  // HyperparameterForm's accordion (which follows object insertion order)
  // renders Model, Walk-forward, Labels, Trading, Tuning, Replay, Runtime.
  const orderedHyperparameters: Record<string, HyperparameterDef> = {};
  if (selectedEntry) {
    for (const group of selectedEntry.groups) {
      for (const { key, def } of group.parameters) {
        orderedHyperparameters[key] = { ...def, description: parameterHelpFor(key, def.description) };
      }
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-neutral-500">Model family</span>
          {isLoading && <span className="text-[10px] text-neutral-500">Loading catalog…</span>}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {entries.map((entry) => (
            <FamilyCard
              key={entry.key}
              entry={entry}
              selected={entry.key === value.familyKey}
              disabled={disabled}
              onSelect={() => selectFamily(entry)}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[10px] text-muted-foreground">Symbol</Label>
          <div className="mt-1 flex h-8 items-center rounded-md border border-white/10 bg-white/5 px-2 font-mono text-sm text-neutral-200">
            {symbol}
          </div>
          <p className="mt-1 text-[10px] text-neutral-500">Change it on the Market toolbar.</p>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Timeframe</Label>
          <Select value={value.timeframe} onValueChange={setTimeframe} disabled={disabled}>
            <SelectTrigger className="mt-1 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CYCLE_TIMEFRAME_OPTIONS.map((tf) => (
                <SelectItem key={tf} value={tf}>
                  {minutesToLabel(tf === "1h" ? 60 : parseInt(tf, 10))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Date start</Label>
          <Input
            type="date"
            className="mt-1 h-8 text-sm"
            value={value.dateStart}
            onChange={(event) => setDateStart(event.target.value)}
            disabled={disabled}
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Date end</Label>
          <Input
            type="date"
            className="mt-1 h-8 text-sm"
            value={value.dateEnd}
            onChange={(event) => setDateEnd(event.target.value)}
            disabled={disabled}
          />
        </div>
        <p className="col-span-2 text-[10px] text-neutral-500">MNQ 1-minute data is dense 2024-03-01 to 2025-12-30.</p>
      </div>

      {selectedEntry ? (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="pt-4">
            <HyperparameterForm
              hyperparameters={orderedHyperparameters}
              values={value.hyperparameters}
              onChange={setHyperparameter}
              onReset={resetHyperparameters}
              disabled={disabled}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-neutral-500">Pick a model family to configure its hyperparameters.</p>
      )}

      {!validation.valid && value.familyKey && (
        <div className="flex items-start gap-2 rounded-md border border-[#D55E00]/40 bg-[#D55E00]/10 px-3 py-2 text-xs text-[#D55E00]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <ul className="space-y-0.5">
            {validation.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
