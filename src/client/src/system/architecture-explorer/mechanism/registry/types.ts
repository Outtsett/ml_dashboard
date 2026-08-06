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
 */
export type Provenance = 'analytic' | 'trained-live' | 'seeded';

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
