import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "vector-space-explained",
  title: "What PC1, PC2 and HNSW actually are",
  summary:
    "How a 19- or 32-dimensional bar vector gets a 2-D position (spread along a direction, the variance sum, the scree, loadings by block), and how HNSW finds nearest neighbours (a greedy walk over 220 real bars, then measured recall@12 and latency against exact search), on the 4,000 bars of the Lens run multimodal_MNQ_1h.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/vector_space_explained.py",
  related: [{ label: "Model Lens (vector-space panel)", href: "/lens" }],
};
