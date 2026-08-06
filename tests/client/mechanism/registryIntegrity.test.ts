import { describe, it, expect } from 'vitest';
import {
  allMechanisms,
  ALL_ARCHETYPES,
} from '@/system/architecture-explorer/mechanism/registry';
import { CATALOG_KEYS } from './catalogKeys.fixture';

const KEYS = new Set(CATALOG_KEYS.map((r) => r.key));

/** Kernels that actually exist under mechanism/compute as of this wave. */
const BUILT_KERNELS = new Set(['kmeans']);

describe('registry integrity', () => {
  it('has the cluster-loop family registered', () => {
    const cluster = allMechanisms().filter((m) => m.archetype === 'cluster-loop');
    expect(cluster.length).toBeGreaterThanOrEqual(10);
  });

  it('every entry names a real archetype', () => {
    for (const m of allMechanisms()) expect(ALL_ARCHETYPES).toContain(m.archetype);
  });

  it('every entry joins to a real catalog key', () => {
    for (const m of allMechanisms()) {
      expect(KEYS.has(m.catalogKey), `unknown catalog key: ${m.catalogKey}`).toBe(true);
    }
  });

  it('every entry cites a non-empty spec path ending in .md', () => {
    for (const m of allMechanisms()) {
      expect(m.specPath.length, `${m.catalogKey} has no citation`).toBeGreaterThan(0);
      expect(m.specPath.endsWith('.md')).toBe(true);
    }
  });

  it('every beat attaches to a stage that exists in the same entry', () => {
    for (const m of allMechanisms()) {
      const stageIds = new Set(m.stages.map((s) => s.id));
      for (const b of m.beats) {
        expect(stageIds.has(b.at), `${m.catalogKey}: beat "${b.id}" -> "${b.at}"`).toBe(
          true,
        );
      }
    }
  });

  it('every entry has 1-3 beats and at least two stages', () => {
    for (const m of allMechanisms()) {
      expect(m.beats.length).toBeGreaterThanOrEqual(1);
      expect(m.beats.length).toBeLessThanOrEqual(3);
      expect(m.stages.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('stage ids and beat ids are unique within an entry', () => {
    for (const m of allMechanisms()) {
      expect(new Set(m.stages.map((s) => s.id)).size).toBe(m.stages.length);
      expect(new Set(m.beats.map((b) => b.id)).size).toBe(m.beats.length);
    }
  });

  it('never claims a kernel that has not been built', () => {
    for (const m of allMechanisms()) {
      if (m.kernelId !== null) {
        expect(
          BUILT_KERNELS.has(m.kernelId),
          `${m.catalogKey} claims kernel "${m.kernelId}" which does not exist`,
        ).toBe(true);
      }
    }
  });

  it('carries a real provenance tier on every entry', () => {
    for (const m of allMechanisms()) {
      expect(['analytic', 'trained-live', 'seeded']).toContain(m.provenance);
    }
  });

  it('only k-means claims the kmeans kernel — no lookalike substitution', () => {
    const withKmeans = allMechanisms()
      .filter((m) => m.kernelId === 'kmeans')
      .map((m) => m.catalogKey);
    expect(withKmeans).toEqual(['k-means-clustering']);
  });
});
