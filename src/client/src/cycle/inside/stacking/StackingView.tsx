/**
 * Inside the model — stacking: each base model gives its own answer for this
 * bar, the meta-learner multiplies each answer by the weight it learned for
 * that model, adds its intercept, and the S-curve turns the sum into P(up)
 * (a price stack: the sum is the predicted move).
 *
 * Reads `structure.stacking` (base models, meta weights and intercept) and
 * `bar.stacking` (each base model's answer and its weight × answer). The sum
 * equals `bar.output.raw`. See `../types.ts`.
 */
import { useState } from "react";

import type { InsideKindViewProps } from "../types";

import { formatPercent } from "@/cycle/format";

import { INSIDE_COLORS, formatNumber, formatSigned, probabilityVerdict, rawOutputName } from "../linear/link";
import { LinkCurve } from "../linear/LinkCurve";
import { Waterfall, useWaterfall, type WaterfallBase, type WaterfallTerm } from "../linear/Waterfall";

/** "gradient_boosting" -> "Gradient boosting". */
export function modelWords(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function stackingTerms({ structure, bar }: Pick<InsideKindViewProps, "structure" | "bar">): { base: WaterfallBase | null; terms: WaterfallTerm[] } {
  const meta = structure.stacking;
  const answers = bar.stacking;
  if (!meta || !answers) return { base: null, terms: [] };
  return {
    base: {
      label: "Meta-learner intercept",
      value: meta.metaIntercept,
      detail: `the meta-learner's starting value before any base model: ${formatSigned(meta.metaIntercept, 4)}`,
    },
    terms: answers.baseOutputs.map((output, index) => {
      const weight = meta.metaCoefficients[index];
      const value = answers.metaContributions[index] ?? 0;
      return {
        key: String(index),
        label: modelWords(output.name),
        value,
        detail:
          weight === undefined
            ? `contribution ${formatSigned(value, 4)}`
            : `answer ${formatNumber(output.value, 4)} × meta weight ${formatSigned(weight, 4)} = ${formatSigned(value, 4)}`,
      };
    }),
  };
}

function BaseAnswers({ bar, highlightKey, role }: { bar: InsideKindViewProps["bar"]; highlightKey: string | null; role: InsideKindViewProps["role"] }) {
  const [hover, setHover] = useState<string | null>(null);
  const outputs = bar.stacking?.baseOutputs ?? [];
  const isProbability = role === "direction" && outputs.every((output) => output.value >= 0 && output.value <= 1);
  const largest = Math.max(1e-12, ...outputs.map((output) => Math.abs(output.value)));
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="inside-stacking-answers">
      <p className="text-[11px] font-medium text-neutral-200">{isProbability ? "Each base model's own P(up) for this bar" : "Each base model's own answer for this bar"}</p>
      {outputs.map((output, index) => {
        const key = String(index);
        const verdict = isProbability ? probabilityVerdict(output.value) : null;
        const share = isProbability ? output.value : Math.abs(output.value) / largest;
        const text = isProbability ? `${formatPercent(output.value)} ${verdict?.glyph} ${verdict?.word}` : formatSigned(output.value, 4);
        return (
          <div
            key={key}
            className={`grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_6rem] items-center gap-2 text-[11px] ${highlightKey === key ? "rounded ring-1 ring-white/30" : ""}`}
            onMouseEnter={() => setHover(`${modelWords(output.name)}: ${isProbability ? `P(up) = ${formatPercent(output.value, 2)}` : `answer ${formatSigned(output.value, 4)}`}`)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="truncate text-neutral-300">{modelWords(output.name)}</span>
            <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-2.5 w-full" aria-hidden>
              <rect x={0} y={1} width={100} height={8} fill={INSIDE_COLORS.neutral} fillOpacity={0.15} />
              <rect x={0} y={1} width={Math.max(0.5, share * 100)} height={8} fill={verdict ? verdict.color : INSIDE_COLORS.sky} />
              {isProbability && <line x1={50} x2={50} y1={0} y2={10} stroke={INSIDE_COLORS.neutral} strokeWidth={0.8} />}
            </svg>
            <span className="text-right tabular-nums" style={{ color: verdict?.color }}>
              {text}
            </span>
          </div>
        );
      })}
      <p className="min-h-4 text-[10px] text-neutral-400">{hover ?? (isProbability ? "The line marks 50%. Hover a model for its exact answer." : "Hover a model for its exact answer.")}</p>
    </div>
  );
}

export function StackingView({ structure, bar, role }: InsideKindViewProps) {
  const { base, terms } = stackingTerms({ structure, bar });
  const state = useWaterfall(base, terms, "given");
  if (!structure.stacking || !bar.stacking) {
    return <p className="text-xs text-neutral-400">This bar's explanation carries no base model answers.</p>;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="inside-stacking-view">
      <p className="text-[11px] text-neutral-300">
        Think of it as a panel of experts: each base model answers, the meta-learner weighs each expert by how much it learned to trust them, and{" "}
        {role === "price" ? "the weighted sum is the predicted move." : "the weighted sum goes through the S-curve to become P(up)."}
      </p>
      <BaseAnswers bar={bar} highlightKey={state.current?.key ?? null} role={role} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Waterfall state={state} noun={["base model", "base models"]} totalName={rawOutputName(bar.link)} givenOrderName="Model order" testId="waterfall" />
        <LinkCurve
          link={bar.link}
          structure={structure}
          bar={bar}
          raw={state.total}
          running={state.running}
          runningLabel={`After ${state.step} of ${terms.length} base models`}
        />
      </div>
    </div>
  );
}
