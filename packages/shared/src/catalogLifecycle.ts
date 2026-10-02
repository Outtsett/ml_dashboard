/**
 * Catalog lifecycle — where each catalog spec stands, from a page of markdown
 * to a running deployment.
 *
 * A catalog card used to show only what the spec says about itself. This is the
 * other half: what has actually been DONE with it. One contract, produced by
 * `apps/api/ml/lifecycle.ts` and drawn by the catalog's status strip.
 */

/**
 * The furthest rung a spec has reached. Ordered — each implies the ones before.
 *
 *   unwritten   a 0-byte placeholder: a name, nothing else
 *   spec        written, but no runner exists and no template can render one
 *   trainable   ML Studio can train it (a wired runner, or a template to generate one)
 *   trained     at least one training session completed
 *   lens_ready  a trained artifact on disk carries a built Model Lens record
 *   deployed    a registered version has a deployment that is running
 */
export type LifecycleStage =
  | 'unwritten'
  | 'spec'
  | 'trainable'
  | 'trained'
  | 'lens_ready'
  | 'deployed';

export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  'unwritten',
  'spec',
  'trainable',
  'trained',
  'lens_ready',
  'deployed',
];

export interface CatalogLifecycle {
  stage: LifecycleStage;
  /** How ML Studio would run it; null when it cannot. */
  runnerSource: 'wired' | 'generate' | null;
  /**
   * Codegen template ML Studio renders for this spec. Null when a wired runner
   * trains it, or when nothing can. Several specs share one template, so this is
   * what gets TRAINED — not necessarily the architecture the spec describes.
   */
  templateId: string | null;
  /** The ML Studio model key that trains this spec — the deep-link target. */
  trainableKey: string | null;
  /** Every runner key whose sessions count toward this spec. */
  runnerKeys: string[];
  sessionCount: number;
  completedSessionCount: number;
  /** Epoch milliseconds of the newest session, or null when there are none. */
  lastSessionAtMilliseconds: number | null;
  /** `data/models/<id>` directory of the newest lens-ready artifact. */
  lensModelId: string | null;
  versionCount: number;
  runningDeploymentCount: number;
}

export interface CatalogLifecycleResponse {
  /** Keyed by catalog spec id. A spec with nothing beyond `spec` is still listed. */
  lifecycle: Record<string, CatalogLifecycle>;
  /**
   * Sessions whose model type matches no runner and no runner alias — mostly
   * models removed from this repo (`hdp-hmm`, `cnn-transformer`). Reported so
   * the per-spec counts are never mistaken for the whole ledger.
   */
  unattachedSessionCount: number;
  sessionCount: number;
}
