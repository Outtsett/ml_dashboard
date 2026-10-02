/**
 * Label-set lifecycle — where each set stands, derived from what exists.
 *
 * Think of it as: the clerk who walks a label set's paperwork through the
 * building, the same clerk `apps/api/ml/lifecycle.ts` employs for models.
 * The request is in the ledger (SQLite `generated_labels`), the rows are in
 * the warehouse (the lake), the catalog card is the serving view
 * (`derived_labels`), the consumers are in the training ledger
 * (`training_sessions.label_set_id`), and freshness is the source bars'
 * coverage against the fingerprint recorded at generation.
 *
 * SRP: `buildLabelLifecycle` is pure (tested against fixtures);
 * `getLabelLifecycle` only gathers its inputs.
 */
import {
  LABEL_SERVING_VIEW,
  type LabelLifecycleResponse,
  type LabelLifecycleStage,
  type LabelSetLifecycle,
  type LabelSourceFingerprint,
  type LabelValidationReport,
} from '@shared/labels/contract';
import { servedRecipes } from '../../database/lake';
import { readJsonLines } from '../../lake/objects';
import { getLabelSets, sessionCountsByLabelSet } from './labelRepository';
import { LABEL_MANIFEST_PATH } from './labelSetStore';
import { resolveLabelSource } from './labelSource';

// ─── Inputs (narrow on purpose — ISP) ───────────────────────────────────────

export interface LifecycleSetRow {
  id: number;
  recipe: string | null;
  generatorType: string;
  symbol: string;
  timeframeMinutes: number;
  status: string;
  stage: string;
  sampleCount: number;
  labelDistribution: string | null;
  parquetPath: string | null;
  validation: string | null;
  maxHorizonBars: number | null;
  purgeBars: number | null;
  embargoBars: number | null;
  landedAt: Date | number | null;
  retiredAt: Date | number | null;
  staleDetectedAt: Date | number | null;
  staleReason: string | null;
  sourceFingerprint: string | null;
  updatedAt: Date | number | null;
}

export interface LabelLifecycleInputs {
  sets: LifecycleSetRow[];
  /** Training sessions that reference each set, keyed by set id. */
  sessionCountBySet: Map<number, number>;
  /** Recipes the serving DuckDB currently exposes through `derived_labels`. */
  servedRecipes: Set<string>;
  /** Recipes with a line in `meta/ingest_manifests/labels.jsonl` — the registry every process reads. */
  manifestedRecipes: Set<string>;
  /** Current source coverage end per `${symbol}|${timeframeMinutes}`, epoch ms; absent when unprobed. */
  sourceCoverageEnd: Map<string, number>;
}

function millis(value: Date | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.getTime() : Number(value);
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ─── The derivation ─────────────────────────────────────────────────────────

export function buildLabelLifecycle(inputs: LabelLifecycleInputs): LabelLifecycleResponse {
  const lifecycle: Record<number, LabelSetLifecycle> = {};

  for (const row of inputs.sets) {
    const validation = parseJson<LabelValidationReport>(row.validation);
    const fingerprint = parseJson<LabelSourceFingerprint>(row.sourceFingerprint);
    const distribution = parseJson<Record<string, number>>(row.labelDistribution) ?? {};
    const sessions = inputs.sessionCountBySet.get(row.id) ?? 0;

    const generated = row.sampleCount > 0 && row.status === 'completed';
    const validated = validation?.passed === true;
    const landed = validated && Boolean(row.parquetPath) && millis(row.landedAt) !== null;
    // Cataloged when the recipe is in the manifest (the registry) or already
    // served by this process; a landing from another process is cataloged the
    // moment its manifest line exists, not only after this process refreshes.
    const cataloged = landed && row.recipe !== null &&
      (inputs.servedRecipes.has(row.recipe) || inputs.manifestedRecipes.has(row.recipe));
    const consumed = sessions > 0;

    let staleReason: string | null = row.staleReason;
    if (!staleReason && fingerprint) {
      const coverageEnd = inputs.sourceCoverageEnd.get(`${row.symbol}|${row.timeframeMinutes}`);
      if (coverageEnd !== undefined && coverageEnd > fingerprint.coverageEndTimestamp) {
        staleReason = `source bars now reach ${new Date(coverageEnd).toISOString()}, the set was generated with bars to ${new Date(fingerprint.coverageEndTimestamp).toISOString()}`;
      }
    }

    const reached: LabelLifecycleStage[] = ['specified'];
    if (generated) reached.push('generated');
    if (validated) reached.push('validated');
    if (landed) reached.push('landed');
    if (cataloged) reached.push('cataloged');
    if (consumed) reached.push('consumed');

    let stage: LabelLifecycleStage = reached[reached.length - 1]!;
    if (staleReason) stage = 'stale';
    if (millis(row.retiredAt) !== null) stage = 'retired';

    lifecycle[row.id] = {
      labelSetId: row.id,
      recipe: row.recipe,
      stage,
      reached,
      generatorType: row.generatorType,
      symbol: row.symbol,
      timeframeMinutes: row.timeframeMinutes,
      rowCount: row.sampleCount,
      labelDistribution: distribution,
      validationPassed: validation ? validation.passed : null,
      parquetPath: row.parquetPath,
      servingView: cataloged ? LABEL_SERVING_VIEW : null,
      consumedBySessionCount: sessions,
      maxHorizonBars: row.maxHorizonBars,
      purgeBars: row.purgeBars,
      embargoBars: row.embargoBars,
      staleReason,
      lastEventAtMilliseconds: millis(row.updatedAt),
    };
  }

  return {
    lifecycle,
    servedRecipes: [...inputs.servedRecipes].sort(),
    setCount: inputs.sets.length,
  };
}

// ─── Gathering ──────────────────────────────────────────────────────────────

export async function getLabelLifecycle(options: { probeSources?: boolean } = {}): Promise<LabelLifecycleResponse> {
  const rows = await getLabelSets({ limit: 1000 });
  const sets: LifecycleSetRow[] = rows.map((row) => ({
    id: row.id,
    recipe: row.recipe ?? null,
    generatorType: row.generatorType,
    symbol: row.symbol,
    timeframeMinutes: row.timeframeMinutes ?? 1,
    status: row.status,
    stage: row.stage ?? 'specified',
    sampleCount: row.sampleCount ?? 0,
    labelDistribution: row.labelDistribution ?? null,
    parquetPath: row.parquetPath ?? null,
    validation: row.validation ?? null,
    maxHorizonBars: row.maxHorizonBars ?? null,
    purgeBars: row.purgeBars ?? null,
    embargoBars: row.embargoBars ?? null,
    landedAt: row.landedAt ?? null,
    retiredAt: row.retiredAt ?? null,
    staleDetectedAt: row.staleDetectedAt ?? null,
    staleReason: row.staleReason ?? null,
    sourceFingerprint: row.sourceFingerprint ?? null,
    updatedAt: row.updatedAt ?? null,
  }));

  const sourceCoverageEnd = new Map<string, number>();
  if (options.probeSources ?? true) {
    // One probe per (symbol, timeframe); `resolveLabelSource` caches for five
    // minutes, so this is cheap on the second call.
    const pairs = new Set(sets.filter((s) => s.parquetPath).map((s) => `${s.symbol}|${s.timeframeMinutes}`));
    for (const pair of pairs) {
      const [symbol, minutes] = pair.split('|');
      try {
        const source = await resolveLabelSource(symbol!, Number(minutes));
        sourceCoverageEnd.set(pair, source.coverageEnd);
      } catch {
        // An unreachable source says nothing about staleness; leave it unprobed.
      }
    }
  }

  return buildLabelLifecycle({
    sets,
    sessionCountBySet: await sessionCountsByLabelSet(),
    servedRecipes: new Set(servedRecipes(LABEL_SERVING_VIEW)),
    manifestedRecipes: await manifestedLabelRecipes(),
    sourceCoverageEnd,
  });
}

let manifestCache: { at: number; recipes: Set<string> } | null = null;

/** Recipes listed in the labels manifest, cached for 30 s. */
async function manifestedLabelRecipes(): Promise<Set<string>> {
  if (manifestCache && Date.now() - manifestCache.at < 30_000) return manifestCache.recipes;
  try {
    const lines = await readJsonLines<{ recipe?: unknown }>(LABEL_MANIFEST_PATH);
    const recipes = new Set(lines.map((line) => line.recipe).filter((r): r is string => typeof r === 'string'));
    manifestCache = { at: Date.now(), recipes };
    return recipes;
  } catch {
    return manifestCache?.recipes ?? new Set();
  }
}
