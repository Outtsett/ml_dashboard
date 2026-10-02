/**
 * Derived terms — vocabulary the codebase already defines, lifted into the glossary.
 *
 * Think of it as: the glossary reading the app's own registries instead of a
 * human retyping them. The indicator list, the label generators, the feature
 * pipeline, the hyperparameter labels and the metric descriptions are all
 * controlled vocabularies that already exist and are already maintained. Copying
 * them by hand would guarantee two versions that disagree within a month.
 *
 * SRP: Adapters only. Each function turns one registry into `Term[]`; nothing
 * here authors prose beyond the connective tissue around a description the
 * source already supplies.
 *
 * These entries carry `provenance: "derived"`, and the page says so, because a
 * derived definition is thin ON PURPOSE — it improves by improving its source,
 * not by editing the glossary.
 *
 * Two sources are deliberately NOT here. The 300-model catalog is served over
 * `/api/model-catalog`, and the feature and metric configs over
 * `/api/training/config` — both are fetched at runtime by `useGlossaryTerms`,
 * so the glossary never holds a stale copy of something that changes on disk.
 */

import { INDICATOR_REGISTRY } from "@/market/lib/indicator_registry";
import { PATTERN_DETECTORS } from "@/market/lib/candles/registry";
import { LABEL_GENERATORS, XAI_METHODS } from "@shared/mlTaxonomy";
import type { Term } from "./types";

/** kebab-case slug, safe as an anchor and stable across renames of the label. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Sentence-case a snake_case or kebab-case identifier for display. */
function humanise(s: string): string {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ── Indicators ───────────────────────────────────────────────────────────
//
// The registry gives `name` (the acronym everyone types) and `fullName` (what
// it stands for) but no prose. That is still the single most-asked question
// about an indicator — "RSI of what?" — so an entry that answers only the
// expansion and the family earns its place.

function indicatorTerms(): Term[] {
  return INDICATOR_REGISTRY.map((ind): Term => {
    const outputs = ind.outputs?.map((o) => o.label ?? o.key).filter(Boolean) ?? [];
    const params = ind.params?.map((p) => p.label ?? p.key).filter(Boolean) ?? [];
    const parts = [
      `**${ind.fullName}** — a ${ind.category} indicator`,
      ind.renderType === "overlay"
        ? "drawn on the price axis."
        : "drawn in its own panel below the price.",
    ];
    return {
      id: `indicator-${slug(ind.id || ind.name)}`,
      term: ind.name,
      expansion: ind.fullName !== ind.name ? ind.fullName : undefined,
      domain: "indicators",
      definition: parts.join(" "),
      why:
        [
          params.length ? `Parameters: ${params.join(", ")}.` : "",
          outputs.length > 1 ? `Outputs ${outputs.length} series: ${outputs.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined,
      aliases: [ind.fullName, ind.id].filter((a): a is string => Boolean(a) && a !== ind.name),
      provenance: "derived",
    };
  });
}

// ── Candlestick patterns ─────────────────────────────────────────────────
//
// Sixty named formations, kept in their own registry because they are detectors
// rather than plottable series and so are not merged into INDICATOR_REGISTRY.
// The naming is the whole point of the entry: "CDL_3WHITESOLDIERS" on a chart
// legend is not self-explanatory, and "Three White Soldiers" barely more so.

function candlePatternTerms(): Term[] {
  return PATTERN_DETECTORS.map((p): Term => {
    const bars =
      /3|THREE|TRI/.test(p.name) ? "three-bar" :
      /2|TWO|ENGULFING|HARAMI|PIERCING|KICKING|COUNTER/.test(p.name) ? "two-bar" :
      "single-bar";
    return {
      id: `candle-${slug(p.name)}`,
      term: p.displayName,
      expansion: p.name,
      domain: "indicators",
      definition: `A **${bars} candlestick pattern**, detected on the bar's open, high, low and close.`,
      why: "A pattern detector returns a signed score, not a forecast — whether the formation predicts anything is a separate, testable question.",
      aliases: [p.name, p.name.replace(/^CDL_/, "")],
      provenance: "derived",
    };
  });
}

// ── Label generators ─────────────────────────────────────────────────────
//
// These already carry a real description AND a `generate` string spelling out
// the rule, which is exactly the "what does this actually compute" a glossary
// is for.

function labelGeneratorTerms(): Term[] {
  return Object.values(LABEL_GENERATORS).map((gen): Term => {
    const g = gen as unknown as {
      id: string;
      name: string;
      description: string;
      category?: string;
      generate?: string;
      params?: { name?: string; id?: string }[];
    };
    return {
      id: `label-${slug(g.id)}`,
      term: g.name,
      domain: "labels",
      definition: `**${g.description}**${g.category ? ` A ${g.category} target.` : ""}`,
      why: g.generate ? `Rule: ${g.generate}` : undefined,
      aliases: [g.id, ...(g.params?.map((p) => p.name ?? p.id ?? "") ?? [])].filter(Boolean),
      provenance: "derived",
    };
  });
}

// ── Explainability methods ───────────────────────────────────────────────

function xaiTerms(): Term[] {
  return Object.values(XAI_METHODS).map((m): Term => {
    const x = m as unknown as {
      id: string;
      name: string;
      description: string;
      category?: string;
      output?: string;
      complexity?: string;
    };
    return {
      id: `xai-${slug(x.id)}`,
      term: x.name,
      domain: "ml-evaluation",
      definition: `**${x.description}**`,
      why: [
        x.category ? `Attribution family: ${x.category}.` : "",
        x.output ? `Produces ${humanise(x.output).toLowerCase()}.` : "",
        x.complexity ? `Compute cost: ${x.complexity}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      aliases: [x.id],
      provenance: "derived",
    };
  });
}

/**
 * Every derived term, deduped by id.
 *
 * Computed once at module load — these registries are static imports, so there
 * is nothing to recompute and no reason to make callers memoise it.
 */
export const DERIVED_TERMS: Term[] = (() => {
  const all = [
    ...indicatorTerms(),
    ...candlePatternTerms(),
    ...labelGeneratorTerms(),
    ...xaiTerms(),
  ];
  const byId = new Map<string, Term>();
  for (const t of all) if (!byId.has(t.id)) byId.set(t.id, t);
  return [...byId.values()];
})();

/** Per-source counts, for the page's provenance line. */
export const DERIVED_COUNTS: Record<string, number> = {
  indicators: indicatorTerms().length,
  candlePatterns: candlePatternTerms().length,
  labels: labelGeneratorTerms().length,
  explainability: xaiTerms().length,
};

export { slug, humanise };
