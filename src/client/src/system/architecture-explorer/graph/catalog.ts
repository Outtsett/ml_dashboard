/**
 * Catalog → graph resolution.
 *
 * The architecture picker lists the REAL model catalog (the unified registry +
 * markdown-spec merge served by `GET /api/model-catalog/trainable`), not a
 * hardcoded shortlist. But derive.ts can only draw the architectures it
 * actually implements against real source, so every catalog entry is resolved
 * to one of two honest states:
 *
 *   - `graphable`   → a derive.ts id whose derivation genuinely models THIS
 *                     entry's architecture
 *   - not graphable → surfaced in the picker, disabled, with the concrete
 *                     reason. We never render an empty canvas and never
 *                     substitute a lookalike graph for an unimplemented model.
 *
 * Resolution order, strictest first:
 *   1. the entry key's algorithm half (`transformer_seq+direction` → the id
 *      derive.ts already supports verbatim)
 *   2. the entry's `templateId` — the Jinja2 template under
 *      src/templates/architectures/ that generates its runner. That mapping is
 *      exact, not a guess: derive.ts's pytorch_* / transformer_seq /
 *      temporal_fusion_transformer derivations were written FROM those
 *      templates, so the drawn graph is the graph that template emits.
 *
 * The one deliberate refusal is `templateId: 'tree'`. That template backs
 * XGBoost, LightGBM and CatBoost alike, but derive.ts's `xgboost` derivation
 * reads `src/ml/xgb_classifier/main.py` specifically (hist boosting, its exact
 * tree count and depth math). Drawing it for a LightGBM spec would be a
 * plausible-looking lie, so `tree` only resolves when the entry is genuinely
 * XGBoost.
 */

import { SUPPORTED_ALGORITHMS } from './derive';

/** Minimum shape this module needs from a `/api/model-catalog/trainable` row. */
export interface CatalogEntryLike {
  name?: string;
  templateId?: string | null;
  family?: string;
  category?: string;
  subcategory?: string;
  runnerSource?: string;
  tags?: string[];
}

export type GraphSupport =
  | { graphable: true; algorithmId: string; via: 'id' | 'template' }
  | { graphable: false; reason: string };

const SUPPORTED = new Set(SUPPORTED_ALGORITHMS);

/**
 * templateId → derive.ts id, for templates whose emitted architecture derive.ts
 * models directly. `tree` is intentionally absent (see the header).
 */
const TEMPLATE_TO_ALGORITHM: Record<string, string> = {
  transformer_seq: 'transformer_seq',
  temporal_fusion_transformer: 'temporal_fusion_transformer',
  pytorch_mlp: 'pytorch_mlp',
  pytorch_cnn: 'pytorch_cnn',
  pytorch_autoencoder: 'pytorch_autoencoder',
  pytorch_vae: 'pytorch_vae',
};

/** Human reasons for the templates we can see but deliberately won't draw. */
const TEMPLATE_REFUSALS: Record<string, string> = {
  tree: 'tree-ensemble template — only XGBoost has a source-derived graph',
  sklearn: 'sklearn estimator — no layer graph to derive (fit/predict, not a network)',
  gmm: 'Gaussian mixture — component model, not a layer graph',
  hmm: 'hidden Markov model — state machine, not a layer graph',
  composite_moe: 'composite mixture-of-experts — graph depends on chosen sub-models',
  composite_stacking: 'composite stacking — graph depends on chosen sub-models',
  composite_voting: 'composite voting — graph depends on chosen sub-models',
  composite_multimodal: 'composite multimodal — graph depends on chosen sub-models',
  rl_dqn: 'RL policy network — no derivation written yet',
  rl_ppo: 'RL policy network — no derivation written yet',
  rl_a2c: 'RL policy network — no derivation written yet',
};

function isXgboost(key: string, entry: CatalogEntryLike): boolean {
  const hay = [key, entry.name ?? '', entry.family ?? '', ...(entry.tags ?? [])]
    .join(' ')
    .toLowerCase();
  return /\bxgboost\b|\bxgb\b/.test(hay);
}

/**
 * Resolve one catalog entry to a derive.ts algorithm id, or explain why not.
 *
 * `key` is the catalog/registry key (may be composite: `alg+task`).
 */
export function resolveGraphSupport(key: string, entry: CatalogEntryLike): GraphSupport {
  // 1. The key's algorithm half — the ids derive.ts owns outright.
  const algHalf = key.split('+')[0] ?? key;
  if (SUPPORTED.has(algHalf)) {
    return { graphable: true, algorithmId: algHalf, via: 'id' };
  }
  if (SUPPORTED.has(key)) {
    return { graphable: true, algorithmId: key, via: 'id' };
  }

  const template = entry.templateId ?? null;

  // 2. The template that generates this entry's runner.
  if (template) {
    const mapped = TEMPLATE_TO_ALGORITHM[template];
    if (mapped && SUPPORTED.has(mapped)) {
      return { graphable: true, algorithmId: mapped, via: 'template' };
    }
    if (template === 'tree') {
      if (isXgboost(key, entry) && SUPPORTED.has('xgboost')) {
        return { graphable: true, algorithmId: 'xgboost', via: 'template' };
      }
      return { graphable: false, reason: TEMPLATE_REFUSALS.tree! };
    }
    const refusal = TEMPLATE_REFUSALS[template];
    if (refusal) return { graphable: false, reason: refusal };
    return { graphable: false, reason: `template "${template}" has no source-derived graph yet` };
  }

  return {
    graphable: false,
    reason:
      entry.runnerSource === 'browse-only'
        ? 'browse-only catalog spec — no runner template, so no architecture to derive'
        : 'no template match — nothing to derive a graph from',
  };
}

/** One picker row: a real catalog entry plus its honest graph state. */
export interface CatalogGraphOption {
  /** Catalog/registry key — the picker's value. */
  key: string;
  label: string;
  /** The catalog's own category. Null when the entry carries none — the UI
   *  omits it rather than inventing a bucket for it. */
  category: string | null;
  support: GraphSupport;
}

/**
 * Build the picker's option list from the real catalog response.
 * Graphable entries sort first (alphabetically), then the rest — every entry is
 * kept so the picker shows the true catalog surface, not a filtered illusion.
 */
export function buildCatalogOptions(
  catalog: Record<string, CatalogEntryLike> | undefined,
): CatalogGraphOption[] {
  if (!catalog) return [];
  const rows: CatalogGraphOption[] = Object.entries(catalog).map(([key, entry]) => ({
    key,
    label: entry.name ?? key,
    category: entry.category ?? null,
    support: resolveGraphSupport(key, entry),
  }));
  return rows.sort((a, b) => {
    if (a.support.graphable !== b.support.graphable) return a.support.graphable ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Fallback options when the catalog API is unreachable — the raw derive.ts ids,
 * all of which are graphable by definition. Keeps the page useful offline
 * without pretending the catalog loaded.
 */
export function fallbackOptions(): CatalogGraphOption[] {
  return SUPPORTED_ALGORITHMS.map((id) => ({
    key: id,
    label: id,
    category: 'derived',
    support: { graphable: true, algorithmId: id, via: 'id' } as GraphSupport,
  }));
}
