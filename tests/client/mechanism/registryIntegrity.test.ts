import { describe, it, expect } from 'vitest';
import {
  allMechanisms,
  ALL_ARCHETYPES,
} from '@/system/architecture-explorer/mechanism/registry';
import { CATALOG_KEYS } from './catalogKeys.fixture';

const KEYS = new Set(CATALOG_KEYS.map((r) => r.key));

/** Kernels that actually exist under mechanism/compute. */
const BUILT_KERNELS = new Set([
  'kmeans', 'gmm', 'dbscan', 'meanshift',
  'agglomerative', 'som', 'copkmeans', 'affinity',
]);

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

  it('every entry cites a real, readable source', () => {
    // Literature entries cite their markdown spec under ALGO_MODELS_ROOT.
    // The WIRED runners have no such spec because they are real code in THIS
    // repo, so they cite the source file that was read instead. Both are
    // citations; neither may be empty.
    for (const m of allMechanisms()) {
      expect(m.specPath.length, `${m.catalogKey} has no citation`).toBeGreaterThan(0);
      expect(
        /\.(md|py|py\.j2|json|ts)$/.test(m.specPath),
        `${m.catalogKey} cites "${m.specPath}", which is not a readable source file`,
      ).toBe(true);
    }
  });

  it('marks how each entry was produced', () => {
    // curated vs extracted carry different confidence; the UI shows the
    // difference, so the data must actually record it.
    for (const m of allMechanisms()) {
      expect(['curated', 'extracted']).toContain(m.curation);
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
      expect(['analytic', 'trained-live', 'seeded', 'schematic']).toContain(
        m.provenance,
      );
    }
  });

  it('claims computed values ONLY where a kernel actually exists', () => {
    // The rule that keeps StageFlow honest: an entry with no kernel animates
    // flow, so it must not advertise analytic / trained-live / seeded values.
    for (const m of allMechanisms()) {
      if (!m.kernelId) {
        expect(
          m.provenance,
          `${m.catalogKey} has no kernel but claims "${m.provenance}"`,
        ).toBe('schematic');
      }
    }
  });

  it('no two models share a clustering kernel — no lookalike substitution', () => {
    // Sharing the cluster-loop archetype is not sharing an algorithm. Each
    // clustering model must name its own kernel, or none at all.
    const claimed = allMechanisms()
      .filter((m) => m.archetype === 'cluster-loop' && m.kernelId)
      .map((m) => m.kernelId!);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('k-means is still the only model claiming the kmeans kernel', () => {
    expect(
      allMechanisms().filter((m) => m.kernelId === 'kmeans').map((m) => m.catalogKey),
    ).toEqual(['k-means-clustering']);
  });
});
