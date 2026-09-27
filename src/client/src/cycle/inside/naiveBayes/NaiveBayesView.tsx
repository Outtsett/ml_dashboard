/**
 * Inside the model — Gaussian naive Bayes: the prior (how often up happened
 * in training, as log odds), then each feature's evidence — ln(height of the
 * up bell curve ÷ height of the down bell curve) at this bar's value — added
 * one at a time, ending on the log posterior odds; the S-curve turns that
 * into P(up).
 *
 * Reads `structure.naiveBayes` (priors, per-class means and variances) and
 * `bar.contributions` (per-feature log-likelihood ratios; `base` is the log
 * prior ratio). The sum equals `bar.output.raw`. See `../types.ts`.
 */
import { useState } from "react";

import type { InsideKindViewProps } from "../types";

import { formatPercent } from "@/cycle/format";

import { formatSigned, logistic, rawOutputName } from "../linear/link";
import { LinkCurve } from "../linear/LinkCurve";
import { Waterfall, useWaterfall, type WaterfallBase, type WaterfallTerm } from "../linear/Waterfall";
import { BellCurves } from "./BellCurves";

export function naiveBayesTerms({ structure, bar, featureNames }: Pick<InsideKindViewProps, "structure" | "bar" | "featureNames">): {
  base: WaterfallBase | null;
  terms: WaterfallTerm[];
} {
  const contributions = bar.contributions;
  if (!contributions) return { base: null, terms: [] };
  const priors = structure.naiveBayes?.logPriors;
  const priorDetail = priors
    ? `ln P(up) − ln P(down) in training = ln ${formatPercent(Math.exp(priors[1]))} − ln ${formatPercent(Math.exp(priors[0]))} = ${formatSigned(contributions.base, 4)}`
    : `log prior odds ${formatSigned(contributions.base, 4)}`;
  return {
    base: { label: "Prior (how often up happened)", value: contributions.base, detail: priorDetail },
    terms: contributions.values.map((value, index) => ({
      key: String(index),
      label: featureNames[index] ?? `Feature ${index + 1}`,
      value,
      detail: `evidence ln(up curve height ÷ down curve height) at this bar's value ${formatSigned(bar.inputs.values[index] ?? null, 4)} = ${formatSigned(value, 4)}`,
    })),
  };
}

export function NaiveBayesView({ structure, bar, featureNames }: InsideKindViewProps) {
  const { base, terms } = naiveBayesTerms({ structure, bar, featureNames });
  const state = useWaterfall(base, terms, "magnitude");
  const [picked, setPicked] = useState<string | null>(null);
  const model = structure.naiveBayes;
  if (!bar.contributions || !model) {
    return <p className="text-xs text-neutral-400">This bar's explanation carries no naive Bayes evidence.</p>;
  }

  // The bell curves follow the feature just added, unless the user picked one.
  const following = {
    ...state,
    setStep: (next: number) => {
      setPicked(null);
      state.setStep(next);
    },
  };
  const selectedKey = picked ?? state.current?.key ?? state.ordered[0]?.key ?? "0";
  const featureIndex = Number(selectedKey);
  const means = model.means[featureIndex];
  const variances = model.variances[featureIndex];

  return (
    <div className="flex flex-col gap-2" data-testid="inside-naive-bayes-view">
      <p className="text-[11px] text-neutral-300">
        Think of it as a panel of independent witnesses: each feature asks "does this value look more like an up bar or a down bar?" and the answers add up
        on top of how often up happened.
      </p>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Waterfall
          state={following}
          noun={["feature", "features"]}
          totalName={rawOutputName("posterior")}
          selectedKey={selectedKey}
          onSelect={setPicked}
          testId="waterfall"
        />
        <div className="flex min-w-0 flex-col gap-3">
          <label className="flex items-center gap-2 text-[11px] text-neutral-300">
            Feature shown
            <select
              aria-label="Feature whose bell curves are shown"
              className="min-w-0 flex-1 rounded border border-white/15 bg-neutral-900 px-1 py-0.5 text-[11px] text-neutral-100"
              value={selectedKey}
              onChange={(event) => setPicked(event.target.value)}
            >
              {terms.map((term) => (
                <option key={term.key} value={term.key}>
                  {term.label}
                </option>
              ))}
            </select>
          </label>
          {means && variances && (
            <BellCurves
              featureName={featureNames[featureIndex] ?? `Feature ${featureIndex + 1}`}
              means={means}
              variances={variances}
              value={bar.inputs.values[featureIndex] ?? null}
              evidence={bar.contributions.values[featureIndex] ?? null}
            />
          )}
          <LinkCurve
            link={bar.link}
            structure={structure}
            bar={bar}
            raw={state.total}
            running={state.running}
            runningLabel={`Prior plus ${state.step} of ${terms.length} features (P(up) ${formatPercent(logistic(state.running))})`}
          />
        </div>
      </div>
    </div>
  );
}
