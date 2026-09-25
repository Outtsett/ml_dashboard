/**
 * "Inside the model" — the contract between the panel shell and the per-kind
 * views. The shell (`InsidePanel.tsx`) fetches the manifest, the fold's
 * structure and the explained bar (`src/shared/cycle/explain.ts`), draws the
 * inputs column and the output chain, and hands the middle of the flow to the
 * view for the model's `explainKind`:
 *
 *   trees            trees/TreesView            (every tree's path, leaf, running total)
 *   oblivious_trees  trees/ObliviousTreesView   (CatBoost: one question per level)
 *   linear           linear/LinearView          (weight x input waterfall)
 *   neighbors        neighbors/NeighborsView    (the k look-alike training bars)
 *   naive_bayes      naiveBayes/NaiveBayesView  (per-feature evidence)
 *   support_vectors  supportVectors/SupportVectorsView
 *   calibration      calibration/CalibrationView
 *   stacking         stacking/StackingView
 *   neural           neural/NeuralView          (layer activations, attention)
 *
 * Every view: Okabe-Ito colours only (`CYCLE_COLORS`; orange pushes up, blue
 * pushes down, always with a sign and a ▲/▼ glyph, never colour alone),
 * full-word labels, a control the user can step / play / scrub, hover for the
 * exact value, and the view's end value must equal `bar.output.raw` (or its
 * link) — the same number the chart shows.
 */
import type { CycleExplainBar, CycleExplainManifest, CycleExplainRole, CycleExplainStructure, CycleExplainTree } from "@shared/cycle/explain";

export interface InsideKindViewProps {
  manifest: CycleExplainManifest;
  structure: CycleExplainStructure;
  bar: CycleExplainBar;
  role: CycleExplainRole;
  /** Full-word feature names, one per model input (the manifest's display names). */
  featureNames: string[];
  /** Fetch one whole tree for the full-tree view (tree kinds only). */
  loadTree?: (treeIndex: number) => Promise<CycleExplainTree>;
}
