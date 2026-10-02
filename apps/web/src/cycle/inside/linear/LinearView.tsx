/**
 * Inside the model — a linear model: each input times its weight, added one
 * feature at a time onto the intercept, then the link (logistic, probit or
 * the validation logistic curve; the identity for a price model).
 *
 * Reads `bar.contributions` (weight × input per feature, and the intercept as
 * `base`) and `structure.linear` (the weights, for the arithmetic text). The
 * sum it draws is the model's raw output, `bar.output.raw`. See `../types.ts`.
 */
import type { InsideKindViewProps } from "../types";

import { formatSigned, rawOutputName } from "./link";
import { LinkCurve } from "./LinkCurve";
import { Waterfall, useWaterfall, type WaterfallBase, type WaterfallTerm } from "./Waterfall";

export function linearTerms({ structure, bar, featureNames }: Pick<InsideKindViewProps, "structure" | "bar" | "featureNames">): {
  base: WaterfallBase | null;
  terms: WaterfallTerm[];
} {
  const contributions = bar.contributions;
  if (!contributions) return { base: null, terms: [] };
  const weights = structure.linear?.coefficients ?? [];
  const scaledNote = bar.inputs.scaled ? " (after the model's own scaler)" : "";
  return {
    base: {
      label: "Intercept (the constant)",
      value: contributions.base,
      detail: `the model's starting value before any feature: ${formatSigned(contributions.base, 4)}`,
    },
    terms: contributions.values.map((value, index) => {
      const weight = weights[index];
      const input = bar.inputs.values[index];
      const name = featureNames[index] ?? `Feature ${index + 1}`;
      return {
        key: String(index),
        label: name,
        value,
        detail:
          weight !== undefined && input !== null && input !== undefined
            ? `weight ${formatSigned(weight, 4)} × input ${formatSigned(input, 4)}${scaledNote} = ${formatSigned(value, 4)}`
            : `contribution ${formatSigned(value, 4)}`,
      };
    }),
  };
}

export function LinearView({ structure, bar, featureNames, role }: InsideKindViewProps) {
  const { base, terms } = linearTerms({ structure, bar, featureNames });
  const state = useWaterfall(base, terms, "magnitude");
  if (!bar.contributions) {
    return <p className="text-xs text-neutral-400">This bar's explanation carries no per-feature contributions.</p>;
  }
  const link = bar.link;
  const featureWord = terms.length === 1 ? "feature" : "features";

  return (
    <div className="flex flex-col gap-2" data-testid="inside-linear-view">
      <p className="text-[11px] text-neutral-300">
        Think of it as a scale: each feature adds its weight times its value to the intercept;{" "}
        {role === "price" ? "the total is the predicted move." : "the total goes through the curve on the right to become P(up)."}
      </p>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Waterfall state={state} noun={["feature", "features"]} totalName={rawOutputName(link)} givenOrderName="Feature order" />
        <LinkCurve
          link={link}
          structure={structure}
          bar={bar}
          raw={state.total}
          running={state.running}
          runningLabel={`After ${state.step} of ${terms.length} ${featureWord}`}
        />
      </div>
    </div>
  );
}
