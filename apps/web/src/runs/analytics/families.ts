/**
 * Which analytics apply to which kind of model. The run page asks one
 * question — "what family is this run?" — and draws the panels that family
 * owns. A new family is a line here and a panel component, never a new page.
 *
 * Families, from the registry's `kind` (`packages/config/cycle_models/*.json`):
 *   trees          gradient-boosted and random forests: rounds, importance
 *   neural         feedforward / recurrent / convolutional networks: epochs, loss surface
 *   transformers   attention models: epochs, loss surface, attention maps
 *   mixture        mixture of experts: the gate's routing plus the neural panels
 *   multimodal     several input streams: per-stream contribution plus neural panels
 *   probabilistic  statistical / Bayesian / generative models: distributions, calibration
 *   clustering     unsupervised groupings: the force-directed graph of the clusters
 *   agent          reinforcement-learning and planning agents: reward, policy
 *   regime         hidden-Markov regimes + regime Monte Carlo + Kronos + FinBERT into a decision model:
 *                  regime bands, the simulated fan, Kronos' candles, the trade gate, the feature weights
 *   other          anything else: the shared panels only
 */
export type AnalyticsFamily = "trees" | "neural" | "transformers" | "mixture" | "multimodal" | "probabilistic" | "clustering" | "agent" | "regime" | "other";

export const FAMILY_LABELS: Record<AnalyticsFamily, string> = {
  trees: "Gradient-boosted and random trees",
  neural: "Neural network",
  transformers: "Transformer",
  mixture: "Mixture of experts",
  multimodal: "Multimodal",
  probabilistic: "Probabilistic and statistical",
  clustering: "Clustering",
  agent: "Reinforcement-learning agent",
  regime: "Regime Monte Carlo decision stack",
  other: "Model",
};

/** Panels a run page can draw; each family lists the ones that apply, in order. */
export type AnalyticsPanel =
  | "learning_curves"   // every logged step quantity (LearningGrid)
  | "loss_surface"      // the 3D loss landscape (LossSurfacePanel)
  | "search"            // objective by trial and by parameter
  | "readouts"          // every scoreboard metric as a readout
  | "attention"         // attention maps per layer and head (transformers)
  | "gate_routing"      // which expert the gate chose, bar by bar (mixture)
  | "stream_contribution" // what each input stream contributed (multimodal)
  | "cluster_graph"     // force-directed graph of the clusters (clustering)
  | "regime_forecast"   // regime bands, Monte Carlo fan, Kronos candles, trade gate, feature weights (regime)
  | "calibration";      // probability honesty (probabilistic)

const SHARED: AnalyticsPanel[] = ["search", "readouts"];

export const FAMILY_PANELS: Record<AnalyticsFamily, AnalyticsPanel[]> = {
  trees: ["learning_curves", ...SHARED],
  neural: ["learning_curves", "loss_surface", ...SHARED],
  transformers: ["learning_curves", "loss_surface", "attention", ...SHARED],
  mixture: ["learning_curves", "loss_surface", "gate_routing", ...SHARED],
  multimodal: ["learning_curves", "loss_surface", "stream_contribution", ...SHARED],
  probabilistic: ["calibration", ...SHARED],
  clustering: ["cluster_graph", ...SHARED],
  agent: ["learning_curves", ...SHARED],
  regime: ["regime_forecast", "learning_curves", ...SHARED],
  other: ["learning_curves", ...SHARED],
};

/** The family a registry `kind` (and, as a tie-break, the model key) belongs to. */
export function analyticsFamilyOf(kind: string | null | undefined, modelKey: string | null | undefined): AnalyticsFamily {
  const key = (modelKey ?? "").toLowerCase();
  const k = (kind ?? "").toLowerCase();
  if (key.includes("regime_montecarlo") || k.includes("regime simulation")) return "regime";
  if (key.includes("mixture_of_experts") || key.includes("moe")) return "mixture";
  if (key.includes("multimodal") || key.includes("multi_modal")) return "multimodal";
  if (key.includes("transformer") || key.includes("attention") || k.includes("transformer")) return "transformers";
  if (k.includes("clustering") || key.includes("kmeans") || key.includes("gaussian_mixture")) return "clustering";
  if (k.includes("tree") || k.includes("boost") || key.includes("xgboost") || key.includes("lightgbm") || key.includes("catboost") || key.includes("forest")) return "trees";
  if (k.includes("probabilistic") || k.includes("generative classifier") || k.includes("survival") || k.includes("series forecast") || k.includes("linear")) return "probabilistic";
  if (k.includes("agent") || k.includes("planner") || k.includes("world model")) return "agent";
  if (k.includes("network") || k.includes("neural") || k.includes("sequence") || k.includes("siamese") || k.includes("projection")) return "neural";
  return "other";
}
