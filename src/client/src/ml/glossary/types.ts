/**
 * Glossary types — the shape every term file conforms to.
 *
 * Think of it as: the schema for the index at the back of the textbook. One
 * entry per concept, tagged by which part of the desk it belongs to, so a
 * reader can narrow from "everything" to "just the options vocabulary".
 *
 * SRP: Types and taxonomy only. No data, no React.
 *
 * A term file exports `const TERMS: Term[]`. `./index.ts` merges every file,
 * checks for duplicate ids, and exposes the result. Adding a domain means
 * adding a file and one line in the index — never editing the page.
 */

/**
 * Which part of the desk a term belongs to.
 *
 * These are DOMAINS, not parts of speech: a reader filtering the glossary is
 * asking "show me the options vocabulary", not "show me the nouns". Keep them
 * broad enough that no domain holds fewer than ~10 terms, or the filter row
 * turns into a wall of one-item buttons.
 */
export type Domain =
  | "statistics"
  | "probability"
  | "time-series"
  | "volatility"
  | "options"
  | "microstructure"
  | "risk"
  | "portfolio"
  | "ml-core"
  | "ml-training"
  | "ml-architectures"
  | "ml-evaluation"
  | "features"
  | "labels"
  | "backtesting"
  | "execution"
  | "data"
  | "infrastructure"
  | "market-structure"
  | "indicators";

/**
 * How confident the desk is in this entry, and where it came from.
 *
 * `derived` entries are generated from a registry that already exists in the
 * codebase (the model catalog, the indicator list), so they stay correct by
 * construction but carry thinner prose. `authored` entries were written by
 * hand. The distinction matters when a definition looks thin: derived ones are
 * thin on purpose and improve by improving their source.
 */
export type Provenance = "authored" | "derived";

export interface Term {
  /** Stable kebab-case slug. The anchor, the dedupe key, the deep-link. */
  id: string;
  /** Display name, as it appears on an axis or in a table header. */
  term: string;
  /** Notation or formula, when there is one. Rendered in the accent serif. */
  symbol?: string;
  /** Expansion for an acronym — "Generalised AutoRegressive Conditional …". */
  expansion?: string;
  domain: Domain;
  /** Plain-language definition. `**bold**` marks the load-bearing phrase. */
  definition: string;
  /** What it buys you, where it bites, or how it is misread. Optional. */
  why?: string;
  /** Extra search keys: abbreviations, alternate spellings, related names. */
  aliases?: string[];
  /** Ids of terms worth reading next. Rendered as chips. */
  see?: string[];
  provenance?: Provenance;
}

export const DOMAIN_LABEL: Record<Domain, string> = {
  statistics: "Statistics",
  probability: "Probability",
  "time-series": "Time series",
  volatility: "Volatility",
  options: "Options",
  microstructure: "Microstructure",
  risk: "Risk",
  portfolio: "Portfolio",
  "ml-core": "ML core",
  "ml-training": "Training",
  "ml-architectures": "Architectures",
  "ml-evaluation": "Evaluation",
  features: "Features",
  labels: "Labels",
  backtesting: "Backtesting",
  execution: "Execution",
  data: "Data",
  infrastructure: "Infrastructure",
  "market-structure": "Market structure",
  indicators: "Indicators",
};

/** Sidebar order. Roughly: the maths, then the market, then the modelling. */
export const DOMAIN_ORDER: Domain[] = [
  "statistics",
  "probability",
  "time-series",
  "volatility",
  "risk",
  "portfolio",
  "options",
  "market-structure",
  "microstructure",
  "execution",
  "indicators",
  "features",
  "labels",
  "ml-core",
  "ml-architectures",
  "ml-training",
  "ml-evaluation",
  "backtesting",
  "data",
  "infrastructure",
];
