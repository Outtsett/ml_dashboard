/**
 * Registry merge + resolution.
 *
 * Resolution is TOTAL: every key returns either a researched spec or a stated
 * reason. A sibling model's animation is never substituted for a key we have
 * not researched - the same refusal graph/catalog.ts already makes for
 * templateId 'tree'.
 */

import type { MechanismSpec, MechanismResolution } from './types';
import { CLUSTER_LOOP } from './clusterLoop';
import { WIRED } from './wired';
import { ADVERSARIAL_DUEL_EXTRACTED } from './adversarialDuelExtracted';
import { AGENT_ENVIRONMENT_EXTRACTED } from './agentEnvironmentExtracted';
import { ATTENTION_MATCH_EXTRACTED } from './attentionMatchExtracted';
import { AUTOREGRESSIVE_EXTRACTED } from './autoregressiveExtracted';
import { CONTRASTIVE_PAIR_EXTRACTED } from './contrastivePairExtracted';
import { CONVEX_FIT_EXTRACTED } from './convexFitExtracted';
import { DENSITY_BOUNDARY_EXTRACTED } from './densityBoundaryExtracted';
import { ENCODE_BOTTLENECK_DECODE_EXTRACTED } from './encodeBottleneckDecodeExtracted';
import { ENSEMBLE_ROUTE_EXTRACTED } from './ensembleRouteExtracted';
import { FEEDFORWARD_STACK_EXTRACTED } from './feedforwardStackExtracted';
import { GRAPH_MESSAGE_PASS_EXTRACTED } from './graphMessagePassExtracted';
import { ITERATIVE_DENOISE_EXTRACTED } from './iterativeDenoiseExtracted';
import { PROJECTION_EMBED_EXTRACTED } from './projectionEmbedExtracted';
import { SYMBOLIC_HYBRID_EXTRACTED } from './symbolicHybridExtracted';
import { TEACHER_STUDENT_EXTRACTED } from './teacherStudentExtracted';
import { TREE_ROUTE_EXTRACTED } from './treeRouteExtracted';

export * from './types';

/** Every researched family module contributes its array here. */
const FAMILIES: readonly MechanismSpec[][] = [
  CLUSTER_LOOP,
  WIRED,
  ADVERSARIAL_DUEL_EXTRACTED,
  AGENT_ENVIRONMENT_EXTRACTED,
  ATTENTION_MATCH_EXTRACTED,
  AUTOREGRESSIVE_EXTRACTED,
  CONTRASTIVE_PAIR_EXTRACTED,
  CONVEX_FIT_EXTRACTED,
  DENSITY_BOUNDARY_EXTRACTED,
  ENCODE_BOTTLENECK_DECODE_EXTRACTED,
  ENSEMBLE_ROUTE_EXTRACTED,
  FEEDFORWARD_STACK_EXTRACTED,
  GRAPH_MESSAGE_PASS_EXTRACTED,
  ITERATIVE_DENOISE_EXTRACTED,
  PROJECTION_EMBED_EXTRACTED,
  SYMBOLIC_HYBRID_EXTRACTED,
  TEACHER_STUDENT_EXTRACTED,
  TREE_ROUTE_EXTRACTED,
];

function buildIndex(): Map<string, MechanismSpec> {
  const index = new Map<string, MechanismSpec>();
  for (const family of FAMILIES) {
    for (const spec of family) {
      const existing = index.get(spec.catalogKey);
      if (existing) {
        throw new Error(
          `Duplicate mechanism entry for "${spec.catalogKey}": ` +
            `${existing.archetype} and ${spec.archetype}. Each catalog key ` +
            `belongs to exactly one archetype.`,
        );
      }
      index.set(spec.catalogKey, spec);
    }
  }
  return index;
}

const INDEX = buildIndex();

export function resolveMechanism(catalogKey: string): MechanismResolution {
  const spec = INDEX.get(catalogKey);
  if (spec) return { researched: true, spec };
  return {
    researched: false,
    reason:
      'Not yet researched. This model has no mechanism entry, so no animation ' +
      'is shown — a related model’s animation is never substituted for it.',
  };
}

/** Catalog keys with no researched entry. Wave 5 drives this to empty. */
export function unresearched(catalogKeys: readonly string[]): string[] {
  return catalogKeys.filter((k) => !INDEX.has(k));
}

/** Every researched spec, for pickers and integrity tests. */
export function allMechanisms(): MechanismSpec[] {
  return [...INDEX.values()];
}
