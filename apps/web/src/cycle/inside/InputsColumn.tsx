/**
 * Inside the model — the left-hand end of the flow: every input the model read
 * for this bar.
 *
 * Per input: its full-word name; the model input as a bar from zero (orange ▲
 * above, blue ▼ below, with the signed number); the raw value before the
 * rolling z-score; and where it sits among this fold's training bars on a
 * 0–100 track. Sorted, by default, by how much this bar's explanation used it:
 * the number of questions asked about it along the bar's tree paths, or the
 * size of its contribution (linear, naive Bayes).
 */
import { useState } from "react";

import type { CycleExplainBar } from "@shared/cycle/explain";

import { cn } from "@/shared/utils/utils";

import { CYCLE_COLORS } from "../chartModel";
import { formatSigned, formatValue, splitCountsFromPaths } from "./trees/treeTypes";

export type InputSortMode = "used" | "model_order" | "largest_input";

export interface InputUsage {
  /** What the number counts, in words ("questions along this bar's paths"). */
  label: string;
  unit: "splits" | "contribution";
  values: number[];
}

/** How much this bar's explanation used each input; null for kinds that do not say. */
export function inputUsage(bar: CycleExplainBar, featureCount: number): InputUsage | null {
  if (bar.trees) {
    return { label: "questions asked about it along this bar's tree paths", unit: "splits", values: splitCountsFromPaths(bar.trees, featureCount) };
  }
  if (bar.contributions) {
    return { label: "its contribution to the raw output", unit: "contribution", values: bar.contributions.values.slice(0, featureCount) };
  }
  return null;
}

/** Feature positions in display order. Ties keep model order. */
export function sortInputs(bar: CycleExplainBar, featureCount: number, mode: InputSortMode, usage: InputUsage | null): number[] {
  const indices = Array.from({ length: featureCount }, (_, index) => index);
  const measure = (index: number): number => {
    if (mode === "used" && usage) return Math.abs(usage.values[index] ?? 0);
    if (mode === "largest_input" || mode === "used") return Math.abs(bar.inputs.values[index] ?? 0);
    return 0;
  };
  if (mode === "model_order") return indices;
  return indices.sort((a, b) => measure(b) - measure(a) || a - b);
}

function ordinal(value: number): string {
  const rounded = Math.round(value);
  const lastTwo = rounded % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${rounded}th`;
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`;
    case 2:
      return `${rounded}nd`;
    case 3:
      return `${rounded}rd`;
    default:
      return `${rounded}th`;
  }
}

const SORT_LABELS: Record<InputSortMode, string> = {
  used: "Most used by this bar",
  model_order: "Model order",
  largest_input: "Largest input",
};

export interface InputsColumnProps {
  bar: CycleExplainBar;
  featureNames: string[];
}

export function InputsColumn({ bar, featureNames }: InputsColumnProps) {
  const featureCount = Math.max(featureNames.length, bar.inputs.values.length);
  const usage = inputUsage(bar, featureCount);
  const [sortMode, setSortMode] = useState<InputSortMode>("used");
  const order = sortInputs(bar, featureCount, sortMode, usage);
  const values = bar.inputs.values;
  const maxAbs = Math.max(1, ...values.map((value) => (value === null ? 0 : Math.abs(value))));

  return (
    <section className="flex min-w-[220px] flex-1 flex-col gap-2" aria-label="The model's inputs for this bar" data-testid="inside-inputs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-neutral-200">Inputs</h3>
        <label className="flex items-center gap-1 text-[11px] text-neutral-400">
          Sort
          <select
            aria-label="Sort the inputs"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as InputSortMode)}
            className="rounded border border-white/10 bg-neutral-900 px-1 py-0.5 text-[11px] text-neutral-200"
          >
            {(Object.keys(SORT_LABELS) as InputSortMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {SORT_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[11px] leading-snug text-neutral-500">
        What the model saw at this bar. Right of centre (orange ▲) is above the input's usual level, left (blue ▼) below
        {bar.inputs.scaled ? "; the model rescales them with its own scaler, fitted on training bars" : ""}.
      </p>
      <ol className="flex flex-col gap-1.5" data-testid="inside-inputs-list">
        {order.map((index) => {
          const name = featureNames[index] ?? `Input ${index + 1}`;
          const value = values[index] ?? null;
          const raw = bar.inputs.raw[index] ?? null;
          const percentile = bar.inputs.trainingPercentile[index] ?? null;
          const used = usage?.values[index] ?? null;
          const up = value !== null && value > 0;
          const down = value !== null && value < 0;
          const width = value === null ? 0 : (Math.abs(value) / maxAbs) * 50;
          const color = up ? CYCLE_COLORS.up : down ? CYCLE_COLORS.down : CYCLE_COLORS.neutral;
          const usageText =
            usage === null || used === null
              ? ""
              : usage.unit === "splits"
                ? `${used} ${used === 1 ? "question" : "questions"} along this bar's paths`
                : `contribution ${formatSigned(used)}`;
          const title = [
            `${name}`,
            `model input ${value === null ? "missing" : value}`,
            `raw value ${raw === null ? "missing" : raw}`,
            percentile === null ? null : `${ordinal(percentile * 100)} percentile of this fold's training bars`,
            usageText || null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={index} title={title} data-testid="inside-input-row" data-feature-index={index} className="rounded-md px-1.5 py-1 hover:bg-white/[0.04]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] text-neutral-200">{name}</span>
                {usageText && (
                  <span className={cn("shrink-0 font-mono text-[10px]", used === 0 ? "text-neutral-600" : "text-neutral-400")}>
                    {usage?.unit === "splits" ? `${used}×` : formatSigned(used)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <div className="relative h-2.5 flex-1 rounded-sm bg-white/[0.05]" aria-hidden="true">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
                  <div
                    className="absolute inset-y-0 rounded-sm"
                    style={{ background: color, width: `${width}%`, left: up ? "50%" : `${50 - width}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums" style={{ color }}>
                  {value === null ? "missing" : `${up ? "▲" : down ? "▼" : ""} ${formatSigned(value, 3)}`}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-neutral-500">
                <span className="shrink-0">Raw value {formatValue(raw)}</span>
                {percentile !== null && (
                  <>
                    <div className="relative h-1 flex-1 rounded-full bg-white/10" aria-hidden="true">
                      <div className="absolute top-1/2 h-2 w-1 -translate-y-1/2 rounded-sm" style={{ left: `calc(${percentile * 100}% - 2px)`, background: CYCLE_COLORS.sky }} />
                    </div>
                    <span className="shrink-0 tabular-nums">{ordinal(percentile * 100)} percentile</span>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {usage && <p className="text-[10px] text-neutral-600">The number beside each name: {usage.label}.</p>}
    </section>
  );
}
