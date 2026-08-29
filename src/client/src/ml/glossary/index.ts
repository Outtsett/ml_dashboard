/**
 * The glossary — every authored term file plus everything derived from a registry.
 *
 * SRP: Merge, validate, index. No React, no rendering.
 *
 * Adding a domain is one import and one spread. Adding a term is one entry in
 * whichever file already owns that domain. Nothing here needs editing for either.
 *
 * Duplicate ids are a real hazard once several files cover overlapping ground —
 * `volatility.ts` and `statistics.ts` both want to talk about variance — so the
 * merge fails loudly in development rather than silently dropping one.
 */

import type { Term } from "./types";
import { DERIVED_TERMS } from "./derived";

import { TERMS as statistics } from "./terms/statistics";
import { TERMS as volatility } from "./terms/volatility";
import { TERMS as risk } from "./terms/risk";
import { TERMS as mlTraining } from "./terms/ml-training";
import { TERMS as mlEvaluation } from "./terms/ml-evaluation";
import { TERMS as marketStructure } from "./terms/market-structure";
import { TERMS as timeSeries } from "./terms/time-series";
import { TERMS as options } from "./terms/options";
import { TERMS as mlCore } from "./terms/ml-core";
import { TERMS as mlArchitectures } from "./terms/ml-architectures";
import { TERMS as featuresLabels } from "./terms/features-labels";
import { TERMS as backtesting } from "./terms/backtesting";
import { TERMS as dataInfra } from "./terms/data-infra";

const AUTHORED: Term[] = [
  ...statistics,
  ...volatility,
  ...risk,
  ...mlTraining,
  ...mlEvaluation,
  ...marketStructure,
  ...timeSeries,
  ...options,
  ...mlCore,
  ...mlArchitectures,
  ...featuresLabels,
  ...backtesting,
  ...dataInfra,
].map((t) => ({ ...t, provenance: t.provenance ?? ("authored" as const) }));

/**
 * Merge authored over derived.
 *
 * Authored wins on a collision: a hand-written entry for `sharpe-ratio` should
 * survive a registry that also happens to define a metric by that name.
 */
function merge(authored: Term[], derived: Term[]): Term[] {
  const byId = new Map<string, Term>();
  const collisions: string[] = [];

  for (const t of authored) {
    if (byId.has(t.id)) collisions.push(t.id);
    byId.set(t.id, t);
  }
  for (const t of derived) {
    if (!byId.has(t.id)) byId.set(t.id, t);
  }

  if (collisions.length && import.meta.env.DEV) {
    // Loud in dev, harmless in production: a duplicate id means two files claim
    // the same anchor, and whichever loads last silently wins.
    console.error(
      `[glossary] duplicate term ids — one definition is being discarded:\n  ${collisions.join("\n  ")}`,
    );
  }
  return [...byId.values()];
}

/** Every term, authored and derived, sorted by display name. */
export const ALL_TERMS: Term[] = merge(AUTHORED, DERIVED_TERMS).sort((a, b) =>
  a.term.localeCompare(b.term, undefined, { sensitivity: "base" }),
);

export const AUTHORED_COUNT = AUTHORED.length;
export const DERIVED_COUNT = ALL_TERMS.length - AUTHORED_COUNT;

/** id → term, for resolving `see` cross-references without a scan. */
export const TERM_INDEX: Map<string, Term> = new Map(ALL_TERMS.map((t) => [t.id, t]));

export type { Term, Domain } from "./types";
export { DOMAIN_LABEL, DOMAIN_ORDER } from "./types";
export { DERIVED_COUNTS } from "./derived";
