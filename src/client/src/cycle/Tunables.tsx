/**
 * The model's searchable hyperparameters, when the run tunes them.
 *
 * Think of it as: the list of dials the machine turns itself. Each row is one
 * parameter with an Optuna search space: its range (or choices), whether it is
 * pinned, and — when pinned — the value it is held at. An unpinned dial is not
 * typed by hand: the fold's search chooses it. Pins are written to the
 * `tuning_pinned_parameters` hyperparameter (comma-separated names) that the
 * engine reads; the pinned value is the parameter's own hyperparameter.
 *
 * Render only: the parent form owns the values and the change handler.
 */
import { Pin, PinOff } from "lucide-react";

import type { HyperparameterDef } from "@shared/trainingTypes";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/utils/utils";

export const PINNED_PARAMETERS_KEY = "tuning_pinned_parameters";
export const TUNING_MODE_KEY = "tuning_mode";
export const TUNING_BUDGET_TRIALS_KEY = "tuning_budget_trials";
export const TUNING_BUDGET_SECONDS_KEY = "tuning_budget_seconds";

/** Names in a comma-separated pin list, trimmed, empty names dropped. */
export function parsePinned(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  return value.split(",").map((name) => name.trim()).filter((name) => name.length > 0);
}

export function serialisePinned(names: readonly string[]): string {
  return [...new Set(names)].join(",");
}

/** The parameters the tuner searches: every model parameter with a `search` block. */
export function searchableParameters(hyperparameters: Record<string, HyperparameterDef>): string[] {
  return Object.entries(hyperparameters)
    .filter(([, def]) => def.search !== undefined && (def.group ?? "Model") === "Model")
    .map(([key]) => key);
}

export function isTuned(values: Record<string, unknown>): boolean {
  return values[TUNING_MODE_KEY] === "tuned";
}

/** "2 – 16", "0.01 – 0.3 (log)", "32, 64, 128". */
export function searchRangeText(def: HyperparameterDef): string {
  const search = def.search;
  if (!search) return "";
  if (search.kind === "categorical") return search.choices.map(String).join(", ");
  const low = formatNumber(search.low);
  const high = formatNumber(search.high);
  return `${low} – ${high}${search.log ? " (log)" : ""}`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 1e5) return value.toExponential(0);
  return String(Number(value.toPrecision(3)));
}

export interface TunablesProps {
  hyperparameters: Record<string, HyperparameterDef>;
  values: Record<string, number | string | boolean>;
  onChange: (key: string, value: number | string | boolean) => void;
  disabled?: boolean;
}

export function Tunables({ hyperparameters, values, onChange, disabled = false }: TunablesProps) {
  const names = searchableParameters(hyperparameters);
  const pinned = new Set(parsePinned(values[PINNED_PARAMETERS_KEY]));
  const trials = Number(values[TUNING_BUDGET_TRIALS_KEY] ?? 0);
  const seconds = Number(values[TUNING_BUDGET_SECONDS_KEY] ?? 0);
  const budget = seconds > 0 ? (trials > 0 ? `up to ${trials} trials or ${seconds} s` : `${seconds} s`) : `${trials} trials`;

  const togglePin = (name: string) => {
    const next = new Set(pinned);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(PINNED_PARAMETERS_KEY, serialisePinned([...next]));
  };

  if (names.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground" data-testid="tunables-none">
        This model declares no search space: its parameters below are used as set.
      </p>
    );
  }

  return (
    <div className="space-y-1.5" data-testid="tunables">
      <p className="text-[11px] text-muted-foreground">
        Searched by Optuna inside every fold, on that fold's own training window, {budget} per fold. Pin a dial to hold it
        at a value of your own; unpinned dials are chosen by the search.
      </p>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground">
            <th className="py-1 pr-2 font-medium">Parameter</th>
            <th className="py-1 pr-2 font-medium">Search space</th>
            <th className="py-1 pr-2 font-medium">Pinned at</th>
            <th className="py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {names.map((name) => {
            const def = hyperparameters[name]!;
            const held = pinned.has(name);
            const value = values[name] ?? def.default;
            return (
              <tr key={name} data-testid={`tunable-${name}`} className="border-t border-border/20">
                <td className="py-1 pr-2 font-medium">{def.label}</td>
                <td className="py-1 pr-2 font-mono text-muted-foreground">{searchRangeText(def)}</td>
                <td className="py-1 pr-2">
                  {held ? (
                    def.search?.kind === "categorical" ? (
                      <select
                        aria-label={`${def.label} pinned value`}
                        className="h-7 rounded border border-border/50 bg-transparent px-1 font-mono"
                        value={String(value)}
                        disabled={disabled}
                        onChange={(event) => {
                          const choice = def.search?.kind === "categorical" ? def.search.choices.find((c) => String(c) === event.target.value) : undefined;
                          onChange(name, (choice ?? event.target.value) as number | string | boolean);
                        }}
                      >
                        {def.search.choices.map((choice) => (
                          <option key={String(choice)} value={String(choice)}>{String(choice)}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        aria-label={`${def.label} pinned value`}
                        type="number"
                        step={def.type === "int" ? 1 : def.step ?? "any"}
                        className="h-7 w-28 font-mono text-[11px]"
                        value={String(value)}
                        disabled={disabled}
                        onChange={(event) => {
                          const parsed = Number(event.target.value);
                          if (Number.isFinite(parsed)) onChange(name, def.type === "int" ? Math.round(parsed) : parsed);
                        }}
                      />
                    )
                  ) : (
                    <span className="text-muted-foreground">chosen by the search</span>
                  )}
                </td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    aria-pressed={held}
                    aria-label={held ? `Unpin ${def.label}` : `Pin ${def.label}`}
                    disabled={disabled}
                    onClick={() => togglePin(name)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
                      held ? "border-[#E69F00]/60 bg-[#E69F00]/15 text-foreground" : "border-border/50 text-muted-foreground",
                    )}
                  >
                    {held ? <Pin className="h-3 w-3" aria-hidden="true" /> : <PinOff className="h-3 w-3" aria-hidden="true" />}
                    {held ? "pinned" : "pin"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
