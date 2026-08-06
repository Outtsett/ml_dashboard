// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ClusterLoop } from '@/system/architecture-explorer/mechanism/archetypes/ClusterLoop';
import type { MechanismSpec } from '@/system/architecture-explorer/mechanism/registry';
import type { FeatureMatrix } from '@/system/architecture-explorer/mechanism/data/candleGeometry';

// p5 is canvas-bound; the sketch's MATH is proven through the kmeans kernel
// tests, so here we assert only the component's lifecycle contract.
const removeSpy = vi.fn();

vi.mock('p5', () => ({
  default: class {
    remove = removeSpy;
    constructor(sketch: (p: Record<string, unknown>) => void) {
      const stub: Record<string, unknown> = {
        createCanvas: () => ({ parent: () => {} }),
        pixelDensity: () => {},
        resizeCanvas: () => {},
        clear: () => {},
        background: () => {},
        fill: () => {},
        noFill: () => {},
        stroke: () => {},
        noStroke: () => {},
        strokeWeight: () => {},
        circle: () => {},
        triangle: () => {},
        quad: () => {},
        rect: () => {},
        line: () => {},
        text: () => {},
        textSize: () => {},
        textAlign: () => {},
        frameRate: () => {},
        width: 800,
        height: 400,
        LEFT: 0,
        TOP: 0,
      };
      sketch(stub);
      // Emulate p5 invoking setup() once after construction.
      (stub.setup as () => void)();
    }
  },
}));

const SPEC: MechanismSpec = {
  catalogKey: 'k-means-clustering',
  name: 'K-Means Clustering',
  archetype: 'cluster-loop',
  provenance: 'analytic',
  specPath: 'Machine Learning/Unsupervised Learning/Clustering/K-Means Clustering.md',
  analogy: 'Sorting bars into k moods.',
  stages: [
    { id: 'points', role: 'input', label: 'Feature points' },
    { id: 'assign', role: 'transform', label: 'Assign' },
    { id: 'update', role: 'update', label: 'Update' },
  ],
  beats: [{ id: 'hard', at: 'assign', label: 'hard assignment', detail: 'One cluster each.' }],
  repoRunner: null,
  kernelId: 'kmeans',
};

const FEATURES: FeatureMatrix = {
  columns: ['body_norm', 'upper_norm', 'lower_norm', 'range_z', 'return_z', 'volume_z'],
  rows: Array.from({ length: 60 }, (_, i) => ({
    timestamp: 1_700_000_000 + i * 60,
    values: [
      (i % 3) - 1,
      (i % 5) / 5,
      (i % 7) / 7,
      ((i * 13) % 9) / 3 - 1.5,
      ((i * 17) % 11) / 4 - 1.3,
      ((i * 19) % 6) / 2 - 1.5,
    ],
  })),
  warmup: 100,
};

beforeEach(() => removeSpy.mockClear());
afterEach(cleanup);

describe('ClusterLoop', () => {
  /**
   * ONE test owns the async p5 path, deliberately.
   *
   * p5 is behind a lazy `import()`, and the mocked module plus RTL's per-test
   * cleanup make "wait for a second instance in a later test" unreliable — the
   * instance is created for whichever test renders it first. Rather than paper
   * over that with timeouts, the whole lifecycle (construct -> real progress ->
   * teardown) is asserted in a single test, and every other test exercises a
   * synchronous path that never constructs p5 at all.
   */
  it('constructs, reports real kmeans progress, and tears down on unmount', async () => {
    const seen: { iteration: number; metricValue: number; metricLabel: string }[] = [];
    const { unmount } = render(
      <ClusterLoop
        spec={SPEC}
        features={FEATURES}
        playing
        stepSignal={0}
        speed={1}
        activeBeat={null}
        onProgress={(p) =>
          seen.push({
            iteration: p.iteration,
            metricValue: p.metricValue,
            metricLabel: p.metricLabel,
          })
        }
      />,
    );

    // The sketch's own setup() calls onProgress, so this firing is proof an
    // instance genuinely got constructed.
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));

    // The reported values come from the real kmeans trace, not a placeholder.
    expect(seen[0]!.iteration).toBe(0);
    expect(seen[0]!.metricLabel).toBe('inertia');
    expect(seen[0]!.metricValue).toBeGreaterThanOrEqual(0);

    unmount();
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('leaks nothing when unmounted before the lazy p5 import lands', () => {
    const { unmount } = render(
      <ClusterLoop
        spec={SPEC}
        features={FEATURES}
        playing
        stepSignal={0}
        speed={1}
        activeBeat={null}
      />,
    );
    unmount(); // synchronous — the import has not resolved yet
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('renders an empty state rather than a canvas when there are no rows', () => {
    const { container } = render(
      <ClusterLoop
        spec={SPEC}
        features={{ ...FEATURES, rows: [] }}
        playing
        stepSignal={0}
        speed={1}
        activeBeat={null}
      />,
    );
    expect(container.textContent).toMatch(/no complete feature rows/i);
  });

  it('refuses to draw a k-means run for a model with a different kernel', () => {
    const dbscan: MechanismSpec = {
      ...SPEC,
      catalogKey: 'dbscan-density-based-spatial-clustering',
      name: 'DBSCAN',
      kernelId: null,
    };
    const { container } = render(
      <ClusterLoop
        spec={dbscan}
        features={FEATURES}
        playing
        stepSignal={0}
        speed={1}
        activeBeat={null}
      />,
    );
    expect(container.textContent).toMatch(/kernel is not built yet/i);
    expect(container.querySelector('canvas')).toBeNull();
  });
});
