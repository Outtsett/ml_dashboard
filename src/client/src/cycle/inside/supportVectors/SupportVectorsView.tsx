/**
 * Inside the model — a support vector machine: the decision value is the
 * intercept plus, for every support vector (a training bar on the edge of the
 * margin), its dual coefficient times the kernel value (how alike that bar is
 * to this one). The view lists the support vectors that pushed hardest, folds
 * the rest into one "everything else" bar, and ends on the decision value; a
 * direction model then reads P(up) off the logistic curve fitted on the
 * validation bars (a price model's decision value is the predicted move).
 *
 * Reads `bar.supportVectors` and `structure.supportVectors` /
 * `structure.logisticCurve`. The sum equals `bar.output.raw`. See `../types.ts`.
 */
import { useState } from "react";

import type { InsideKindViewProps } from "../types";

import { formatCount, formatTime } from "@/cycle/format";

import { formatNumber, formatSigned } from "../linear/link";
import { LinkCurve } from "../linear/LinkCurve";
import { Waterfall, useWaterfall, type WaterfallBase, type WaterfallTerm } from "../linear/Waterfall";

/** The first `shown` support vectors one by one, the rest (and every unlisted one) as one "everything else" term. */
export function supportVectorTerms(
  { structure, bar }: Pick<InsideKindViewProps, "structure" | "bar">,
  shown: number,
): { base: WaterfallBase | null; terms: WaterfallTerm[] } {
  const vectors = bar.supportVectors;
  if (!vectors) return { base: null, terms: [] };
  const listed = vectors.contributions.length;
  const count = Math.max(0, Math.min(shown, listed));
  const terms: WaterfallTerm[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = vectors.contributions[index] ?? 0;
    terms.push({
      key: `vector-${index}`,
      label: `Support vector from ${formatTime(vectors.timestamps[index])}`,
      value,
      detail: `dual coefficient ${formatSigned(vectors.dualCoefficients[index], 4)} × kernel value ${formatNumber(vectors.kernelValues[index], 4)} (how alike that training bar is to this one) = ${formatSigned(value, 4)}`,
    });
  }
  let rest = vectors.otherContribution;
  for (let index = count; index < listed; index += 1) rest += vectors.contributions[index] ?? 0;
  const total = structure.supportVectors?.supportVectorCount ?? null;
  const restCount = total === null ? null : Math.max(0, total - count);
  terms.push({
    key: "everything-else",
    label: restCount === null ? "Everything else (the other support vectors)" : `Everything else (the other ${formatCount(restCount)} support vectors)`,
    value: rest,
    detail: `the sum of dual coefficient × kernel value over every support vector not listed above = ${formatSigned(rest, 4)}`,
  });
  return {
    base: { label: "Intercept (the constant)", value: vectors.intercept, detail: `the decision value before any support vector: ${formatSigned(vectors.intercept, 4)}` },
    terms,
  };
}

export function SupportVectorsView({ structure, bar, role }: InsideKindViewProps) {
  const listed = bar.supportVectors?.contributions.length ?? 0;
  const [shown, setShown] = useState(listed);
  const count = Math.max(0, Math.min(shown, listed));
  const { base, terms } = supportVectorTerms({ structure, bar }, count);
  const state = useWaterfall(base, terms, "given");
  if (!bar.supportVectors) {
    return <p className="text-xs text-neutral-400">This bar's explanation carries no support vectors.</p>;
  }
  const summary = structure.supportVectors;
  const totalName = role === "price" ? "predicted move in typical moves" : "decision value";

  return (
    <div className="flex flex-col gap-2" data-testid="inside-support-vectors-view">
      <p className="text-[11px] text-neutral-300">
        Think of it as the edge-of-the-margin training bars voting: each one pushes by how much it matters (its dual coefficient) times how much this bar looks
        like it (the kernel value).
      </p>
      {summary && (
        <p className="text-[10px] text-neutral-400">
          {formatCount(summary.supportVectorCount)} support vectors out of {formatCount(summary.trainingBarCount)} training bars; kernel {summary.kernel}
          {summary.gamma !== null ? `, width setting (gamma) ${formatNumber(summary.gamma, 4)}` : ""}.
        </p>
      )}
      <label className="flex items-center gap-2 text-[11px] text-neutral-300">
        Support vectors listed one by one
        <input
          type="range"
          aria-label="Support vectors listed one by one"
          min={0}
          max={listed}
          step={1}
          value={count}
          onChange={(event) => setShown(Number(event.target.value))}
          className="w-40"
        />
        <span className="tabular-nums text-neutral-100" data-testid="inside-support-vectors-shown">
          {count} of {listed}
        </span>
        <span className="text-[10px] text-neutral-500">(the rest are folded into "everything else"; the sum does not change)</span>
      </label>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Waterfall state={state} noun={["support vector", "support vectors"]} totalName={totalName} sortable={false} testId="waterfall" />
        <LinkCurve
          link={bar.link}
          structure={structure}
          bar={bar}
          raw={state.total}
          running={state.running}
          runningLabel={`After ${state.step} of ${terms.length} bars`}
        />
      </div>
    </div>
  );
}
