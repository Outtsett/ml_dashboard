import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "multimodal-model",
  title: "Multimodal MNQ bracket model: every trial against the acceptance gate",
  summary:
    "Nine development trials of the multimodal bracket meta-label model, scored after AMP costs on 2021Q2 to 2025Q2: which of the five gates each passes (none), whether it ranks outcomes at all, which block of inputs adds AUC, the coin-flip bar it must beat, and whether the locked holdout has been opened (it has not).",
  category: "Predictive",
  status: "active-research",
  replaces: "E:/source/repos/ml_dashboard/notebooks/multimodal_model.py",
  related: [
    { label: "Model Cycle runs", href: "/cycle" },
    { label: "ML Studio (launches the runner)", href: "/ml-studio" },
  ],
};
