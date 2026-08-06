import { describe, it, expect } from 'vitest';
import { CATALOG_KEYS } from './catalogKeys.fixture';
import {
  resolveMechanism,
  unresearched,
  ALL_ARCHETYPES,
} from '@/system/architecture-explorer/mechanism/registry';

describe('mechanism registry coverage', () => {
  it('returns a decision for every catalog key — never blank', () => {
    for (const row of CATALOG_KEYS) {
      const r = resolveMechanism(row.key);
      if (r.researched) {
        expect(ALL_ARCHETYPES).toContain(r.spec.archetype);
      } else {
        // An unresearched key MUST carry a human reason. This is the rule that
        // stops a blank canvas from ever shipping.
        expect(r.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('never substitutes another model for an unresearched key', () => {
    const r = resolveMechanism('__definitely_not_a_real_catalog_key__');
    expect(r.researched).toBe(false);
  });

  it('unresearched() lists exactly the keys with no entry', () => {
    const keys = CATALOG_KEYS.map((r) => r.key);
    const missing = unresearched(keys);
    for (const k of missing) expect(resolveMechanism(k).researched).toBe(false);
    for (const k of keys.filter((k) => !missing.includes(k))) {
      expect(resolveMechanism(k).researched).toBe(true);
    }
  });

  // Flips from skip to active in Wave 5, when research is complete.
  it.skip('has researched every catalog key', () => {
    expect(unresearched(CATALOG_KEYS.map((r) => r.key))).toEqual([]);
  });
});
