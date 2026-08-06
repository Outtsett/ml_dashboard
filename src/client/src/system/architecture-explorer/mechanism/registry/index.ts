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

export * from './types';

/** Every researched family module contributes its array here. */
const FAMILIES: readonly MechanismSpec[][] = [CLUSTER_LOOP];

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
