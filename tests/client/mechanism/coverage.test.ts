import { describe, it, expect } from 'vitest';
import { CATALOG_KEYS } from './catalogKeys.fixture';
import {
  resolveMechanism,
  unresearched,
  ALL_ARCHETYPES,
} from '@/system/architecture-explorer/mechanism/registry';
import { resolveEngine } from '@/system/architecture-explorer/mechanism/archetypes';

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

  /**
   * The one catalog key with no researched entry, and why.
   *
   * `primitives_cnn+multi_head`'s trainer lives in a sibling repo that is not on
   * this disk, so there is no source to read and nothing to cite. Describing it
   * would be guesswork — the same refusal graph/derive.ts already makes for it.
   * If that repo is ever vendored in, delete this exclusion and the test should
   * still pass.
   */
  const KNOWN_UNRESEARCHED = ['primitives_cnn+multi_head'];

  it('has researched every catalog key except the documented exclusion', () => {
    expect(unresearched(CATALOG_KEYS.map((r) => r.key)).sort()).toEqual(
      [...KNOWN_UNRESEARCHED].sort(),
    );
  });

  it('every researched key resolves to an engine that will animate it', () => {
    for (const row of CATALOG_KEYS) {
      const r = resolveMechanism(row.key);
      if (!r.researched) continue;
      // resolveEngine never returns undefined for a researched spec: bespoke
      // where a kernel reproduces the real algorithm, StageFlow otherwise.
      expect(resolveEngine(r.spec)).toBeTruthy();
      expect(r.spec.stages.length).toBeGreaterThanOrEqual(2);
    }
  });
});
