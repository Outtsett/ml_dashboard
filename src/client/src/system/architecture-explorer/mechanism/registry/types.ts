/**
 * Contract types for the mechanism registry.
 *
 * A MechanismSpec is a RESEARCHED account of how one catalog model actually
 * processes information, read from its markdown spec under ALGO_MODELS_ROOT and
 * cited by `specPath`. It is deliberately NOT derived from this repo's runner:
 * for 48 of the 140 catalog entries the runner is the generic pytorch_mlp
 * template, and conflating the two is the exact confusion this module exists to
 * remove. `repoRunner` carries that divergence explicitly.
 */

/** The 17 animated mechanisms. One p5 engine each. */
export type ArchetypeId =
  | 'feedforward-stack'
  | 'adversarial-duel'
  | 'encode-bottleneck-decode'
  | 'iterative-denoise'
  | 'attention-match'
  | 'autoregressive'
  | 'tree-route'
  | 'convex-fit'
  | 'cluster-loop'
  | 'projection-embed'
  | 'contrastive-pair'
  | 'graph-message-pass'
  | 'teacher-student'
  | 'ensemble-route'
  | 'symbolic-hybrid'
  | 'agent-environment'
  | 'density-boundary';

export const ALL_ARCHETYPES: readonly ArchetypeId[] = [
  'feedforward-stack',
  'adversarial-duel',
  'encode-bottleneck-decode',
  'iterative-denoise',
  'attention-match',
  'autoregressive',
  'tree-route',
  'convex-fit',
  'cluster-loop',
  'projection-embed',
  'contrastive-pair',
  'graph-message-pass',
  'teacher-student',
  'ensemble-route',
  'symbolic-hybrid',
  'agent-environment',
  'density-boundary',
] as const;

/**
 * Where this panel's numbers come from. Stated on screen, always.
 *   analytic     - math fully determined; the result is genuinely correct.
 *   trained-live - really optimized in-browser on real bars; step + loss shown.
 *   seeded       - real arithmetic, untrained weights; output is NOT a prediction.
 *   schematic    - NO values are computed. The animation shows this model's real
 *                  information flow - its actual stages, loops and branches, read
 *                  from the cited spec - but every number on screen would be
 *                  invented, so none is shown. The motion is the claim; nothing
 *                  more is asserted.
 */
export type Provenance = 'analytic' | 'trained-live' | 'seeded' | 'schematic';

/**
 * Archetypes whose ENGINE computes real arithmetic even without a per-model
 * kernel — so their entries must not claim `schematic`.
 *
 * attention-match runs a genuine softmax(QK^T/sqrt(d_k))V over the real bar
 * window with SEEDED projections: real arithmetic, unlearned weights — the
 * `seeded` tier. tree-route grows a REAL CART on the real rows (exhaustive
 * split search, Gini reduction, real thresholds), which is fully determined by
 * the data — the `analytic` tier. encode-bottleneck-decode and projection-embed
 * both run an exact PCA (Jacobi eigendecomposition of the real covariance
 * matrix); projecting onto the top k components is the provably optimal linear
 * bottleneck, so those are `analytic` too. Saying "no values are computed"
 * on a panel that is visibly computing them is the same class of error as a
 * lookalike animation, so this list is enforced by test.
 */
export const COMPUTING_ARCHETYPES: readonly ArchetypeId[] = [
  'attention-match',
  'tree-route',
  'encode-bottleneck-decode',
  'projection-embed',
];

export type StageRole =
  | 'input'
  | 'transform'
  | 'latent'
  | 'score'
  | 'loss'
  | 'update'
  | 'output';

export interface MechanismStage {
  id: string;
  /** Real stage name from the spec, e.g. "Class-conditional BatchNorm". */
  label: string;
  /** Compact real config line. Omitted rather than invented. */
  detail?: string;
  role: StageRole;
}

export interface MechanismBeat {
  id: string;
  /** What distinguishes THIS model from its archetype siblings. */
  label: string;
  /** Stage id this beat attaches to. Must match a stage in the same spec. */
  at: string;
  /** One sentence, sourced from the spec. */
  detail: string;
}

export interface RepoRunner {
  /** The template that would actually render if this spec were trained here. */
  templateId: string;
  /** Plain statement of the divergence, shown in the banner. */
  note: string;
}

export interface MechanismSpec {
  /** Catalog key from GET /api/model-catalog/trainable - the join key. */
  catalogKey: string;
  name: string;
  archetype: ArchetypeId;
  provenance: Provenance;
  /** Path relative to ALGO_MODELS_ROOT. The citation. Never empty. */
  specPath: string;
  /** One-line trading-grounded "Think of it as ..." summary. */
  analogy: string;
  stages: MechanismStage[];
  /** 1-3 distinguishing beats. */
  beats: MechanismBeat[];
  /** Null when the repo would genuinely train this architecture. */
  repoRunner: RepoRunner | null;
  /**
   * How this entry was produced. Surfaced in the UI, because the two carry
   * different confidence and pretending otherwise would be the same class of
   * lie as a lookalike animation.
   *
   *   curated   - a human read the cited spec end to end and wrote the stages
   *               and beats deliberately.
   *   extracted - stages and beats were lifted mechanically from the cited
   *               spec's own Principles / Algorithm sections. Faithful to the
   *               source, but not reviewed line by line.
   */
  curation: 'curated' | 'extracted';
  /**
   * The compute kernel that genuinely reproduces THIS model's mechanism, or
   * null when it is not built yet.
   *
   * Sharing an archetype does NOT mean sharing a kernel. DBSCAN, Mean Shift and
   * Affinity Propagation all animate as cluster-loops, but none of them is
   * centroid assign/update — running k-means under their name would be the
   * lookalike substitution this whole module refuses to make. A null kernelId
   * renders a stated "engine pending", never another model's algorithm.
   */
  kernelId: string | null;
}

export type MechanismResolution =
  | { researched: true; spec: MechanismSpec }
  | { researched: false; reason: string };
