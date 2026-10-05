/**
 * apps/api/tests/catalogLifecycle.test.ts
 *
 * The lifecycle join crosses four id spaces (spec id, runner key, legacy model
 * type, artifact directory). Each hop is pinned here against fixtures, because
 * every one of them fails SILENTLY when it breaks: a card just reads "0 runs".
 */

import { describe, it, expect, vi } from 'vitest';

// `lifecycle.ts` imports the SQLite handle at module scope; the pure join under
// test never touches it.
vi.mock('../infrastructure/database/db', () => ({ db: {} }));

import {
  buildCatalogLifecycle,
  type LifecycleInputs,
} from '../ml/lifecycle';

const base = (over: Partial<LifecycleInputs>): LifecycleInputs => ({
  specs: [],
  trainable: {},
  runners: {},
  sessions: [],
  versions: [],
  deployments: [],
  isLensReady: () => false,
  ...over,
});

const session = (modelType: string, status: string, startedAtMilliseconds: number, versionedModelId: string | null = null) => ({
  modelType,
  status,
  startedAtMilliseconds,
  versionedModelId,
});

describe('catalog lifecycle join', () => {
  it('separates an unwritten stub, a written spec, and a trainable one', () => {
    const { lifecycle } = buildCatalogLifecycle(
      base({
        specs: [
          { id: 'stub', hasContent: false },
          { id: 'essay', hasContent: true },
          { id: 'lstm', hasContent: true },
        ],
        trainable: {
          essay: { runnerSource: 'browse-only' },
          lstm: { runnerSource: 'generate' },
        },
      }),
    );
    expect(lifecycle['stub']?.stage).toBe('unwritten');
    expect(lifecycle['essay']?.stage).toBe('spec');
    expect(lifecycle['essay']?.trainableKey).toBeNull();
    expect(lifecycle['lstm']?.stage).toBe('trainable');
    expect(lifecycle['lstm']?.trainableKey).toBe('lstm');
  });

  it('deep-links a spec to its WIRED runner key rather than to the template entry', () => {
    const { lifecycle } = buildCatalogLifecycle(
      base({
        specs: [{ id: 'xgboost-spec', hasContent: true }],
        trainable: {
          'xgboost-spec': { runnerSource: 'generate' },
          'xgboost+direction_classifier': { runnerSource: 'wired', catalogId: 'xgboost-spec' },
        },
      }),
    );
    expect(lifecycle['xgboost-spec']?.runnerSource).toBe('wired');
    expect(lifecycle['xgboost-spec']?.trainableKey).toBe('xgboost+direction_classifier');
  });

  it('attaches sessions written under a runner\'s legacy model type', () => {
    const result = buildCatalogLifecycle(
      base({
        specs: [{ id: 'xgboost-spec', hasContent: true }],
        runners: { 'xgboost+direction_classifier': { catalogId: 'xgboost-spec', legacyId: 'xgb_classifier' } },
        sessions: [
          session('xgb_classifier', 'failed', 100),
          session('xgboost+direction_classifier', 'failed', 300),
          session('hdp-hmm', 'completed', 200),
        ],
      }),
    );
    const xgb = result.lifecycle['xgboost-spec'];
    expect(xgb?.sessionCount).toBe(2);
    expect(xgb?.lastSessionAtMilliseconds).toBe(300);
    // A removed model's sessions belong to no spec, and are counted as such.
    expect(result.unattachedSessionCount).toBe(1);
    expect(result.sessionCount).toBe(3);
  });

  it('does not call a spec trained on the strength of failed sessions alone', () => {
    const { lifecycle } = buildCatalogLifecycle(
      base({
        specs: [{ id: 's', hasContent: true }],
        trainable: { s: { runnerSource: 'generate' } },
        runners: { 's+direction_classifier': { catalogId: 's' } },
        sessions: [session('s+direction_classifier', 'failed', 1), session('s+direction_classifier', 'stopped', 2)],
      }),
    );
    expect(lifecycle['s']?.stage).toBe('trainable');
    expect(lifecycle['s']?.sessionCount).toBe(2);
    expect(lifecycle['s']?.completedSessionCount).toBe(0);
  });

  it('climbs trained -> lens_ready -> deployed, naming the newest lens artifact', () => {
    const inputs = base({
      specs: [{ id: 's', hasContent: true }],
      runners: { 's+direction_classifier': { catalogId: 's' } },
      sessions: [
        session('s+direction_classifier', 'completed', 10, 'MNQ_1m_old'),
        session('s+direction_classifier', 'completed', 20, 'MNQ_1m_new'),
        session('s+direction_classifier', 'completed', 30, 'MNQ_1m_no_lens'),
      ],
    });

    expect(buildCatalogLifecycle(inputs).lifecycle['s']?.stage).toBe('trained');

    const withLens = { ...inputs, isLensReady: (id: string) => id !== 'MNQ_1m_no_lens' };
    const lens = buildCatalogLifecycle(withLens).lifecycle['s'];
    expect(lens?.stage).toBe('lens_ready');
    expect(lens?.lensModelId).toBe('MNQ_1m_new');

    const deployed = buildCatalogLifecycle({
      ...withLens,
      versions: [{ versionId: 7, catalogId: 's', runnerKey: 's+direction_classifier' }],
      deployments: [
        { versionId: 7, status: 'running' },
        { versionId: 7, status: 'stopped' },
      ],
    }).lifecycle['s'];
    expect(deployed?.stage).toBe('deployed');
    expect(deployed?.runningDeploymentCount).toBe(1);
    expect(deployed?.versionCount).toBe(1);
  });
});
