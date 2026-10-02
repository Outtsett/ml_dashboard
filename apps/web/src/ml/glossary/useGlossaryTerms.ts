/**
 * The full term list, including the model catalog fetched at runtime.
 *
 * SRP: One hook. Merges the static glossary with the 300 model specs the
 * catalog API already serves, and builds the search index.
 *
 * The catalog is fetched rather than vendored because it is a corpus on disk
 * that changes without this file changing. A copy checked in here would be
 * stale the first time someone writes a spec, and there would be no signal that
 * it had gone stale.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { ALL_TERMS, type Term } from "./index";

interface CatalogModel {
  id: string;
  name: string;
  shortName?: string;
  category: string;
  subcategory?: string;
  overview?: string;
  hasContent: boolean;
}

/** One sentence, trimmed at a sentence boundary where there is one. */
function firstSentence(text: string, max = 260): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = cut.lastIndexOf(". ");
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut) + "…";
}

function catalogToTerms(models: CatalogModel[]): Term[] {
  return models.map((m): Term => {
    const family = m.category.replace(/-/g, " ");
    return {
      id: `model-${m.id}`,
      term: m.name,
      expansion: m.shortName && m.shortName !== m.name ? m.shortName : undefined,
      domain: "ml-architectures",
      definition: m.hasContent && m.overview
        ? `**${firstSentence(m.overview)}**`
        : `A ${family} model. **Spec not written yet** — the catalog entry exists but is empty.`,
      why: m.subcategory ? `Catalogued under ${family} › ${m.subcategory.replace(/-/g, " ")}.` : undefined,
      aliases: [m.shortName, m.category, m.subcategory].filter((a): a is string => Boolean(a)),
      provenance: "derived",
    };
  });
}

// ── Feature & metric configs, served by /api/training/config ─────────────

interface FeatureEntry {
  name: string;
  category?: string;
  type?: string;
  description?: string;
  requires?: string[];
}

interface TrainingConfig {
  features?: {
    features?: FeatureEntry[];
    categories?: Record<string, string | { description?: string }>;
  };
  runners?: Record<string, { defaultHyperparameters?: Record<string, { label?: string; group?: string }> }>;
}

function humanise(s: string): string {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function configToTerms(cfg: TrainingConfig | undefined): Term[] {
  if (!cfg) return [];
  const out: Term[] = [];

  for (const f of cfg.features?.features ?? []) {
    if (!f?.name) continue;
    out.push({
      id: `feature-${slug(f.name)}`,
      term: f.name,
      domain: "features",
      definition: `**${f.description ?? humanise(f.name)}**${
        f.category ? ` Part of the ${f.category.replace(/_/g, " ")} family.` : ""
      }`,
      why: f.requires?.length ? `Computed from: ${f.requires.join(", ")}.` : undefined,
      aliases: [f.type].filter((a): a is string => Boolean(a)),
      provenance: "derived",
    });
  }

  for (const [key, value] of Object.entries(cfg.features?.categories ?? {})) {
    const description = typeof value === "string" ? value : value?.description;
    if (!description) continue;
    out.push({
      id: `feature-family-${slug(key)}`,
      term: `${humanise(key)} features`,
      domain: "features",
      definition: `**${description}**`,
      aliases: [key],
      provenance: "derived",
    });
  }

  // Hyperparameter labels, deduped across every runner that declares them.
  const seen = new Set<string>();
  for (const runner of Object.values(cfg.runners ?? {})) {
    for (const [key, hp] of Object.entries(runner?.defaultHyperparameters ?? {})) {
      const id = `hyperparameter-${slug(key)}`;
      if (seen.has(id) || !hp?.label) continue;
      seen.add(id);
      out.push({
        id,
        term: hp.label,
        domain: "ml-training",
        definition: `**A ${hp.group ? hp.group.toLowerCase() : "training"} hyperparameter**, set as \`${key}\`.`,
        aliases: [key],
        provenance: "derived",
      });
    }
  }
  return out;
}

export interface GlossaryData {
  terms: Term[];
  fuse: Fuse<Term>;
  authored: number;
  derived: number;
  isLoading: boolean;
}

export function useGlossaryTerms(): GlossaryData {
  const { data, isLoading } = useQuery({
    queryKey: ["glossary", "model-catalog"],
    queryFn: async (): Promise<CatalogModel[]> => {
      const res = await fetch("/api/model-catalog?includeEmpty=true");
      if (!res.ok) throw new Error(`catalog ${res.status}`);
      const json = (await res.json()) as { models?: CatalogModel[] };
      return json.models ?? [];
    },
    staleTime: 5 * 60_000,
    // The glossary is useful without the catalog; a failed fetch should cost
    // 300 entries, not the page.
    retry: 1,
  });

  const { data: config } = useQuery({
    queryKey: ["glossary", "training-config"],
    queryFn: async (): Promise<TrainingConfig> => {
      const res = await fetch("/api/training/config");
      if (!res.ok) throw new Error(`config ${res.status}`);
      return (await res.json()) as TrainingConfig;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const terms = useMemo(() => {
    // Authored wins, then the catalog, then the configs — most specific first.
    const byId = new Map<string, Term>();
    for (const t of ALL_TERMS) byId.set(t.id, t);
    for (const t of catalogToTerms(data ?? [])) if (!byId.has(t.id)) byId.set(t.id, t);
    for (const t of configToTerms(config)) if (!byId.has(t.id)) byId.set(t.id, t);
    return [...byId.values()].sort((a, b) =>
      a.term.localeCompare(b.term, undefined, { sensitivity: "base" }),
    );
  }, [data, config]);

  // Weighted so a query matches the NAME first and the prose last — searching
  // "sharpe" should surface the Sharpe ratio, not every definition mentioning it.
  const fuse = useMemo(
    () =>
      new Fuse(terms, {
        keys: [
          { name: "term", weight: 10 },
          { name: "aliases", weight: 6 },
          { name: "expansion", weight: 5 },
          { name: "symbol", weight: 3 },
          { name: "definition", weight: 1 },
          { name: "why", weight: 0.5 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [terms],
  );

  const authored = terms.filter((t) => t.provenance !== "derived").length;
  return { terms, fuse, authored, derived: terms.length - authored, isLoading };
}
