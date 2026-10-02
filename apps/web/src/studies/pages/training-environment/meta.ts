import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "training-environment",
  title: "Training environment: what a run knows while it runs",
  summary:
    "The record a multimodal direction run leaves behind: the bars it trained on, every modality block as the numbers the model receives (nine statistics each), the token being assembled, the representation epoch by epoch, every layer's output and gradient, and the learning curves against the majority-class baseline.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/training_environment.py",
  related: [
    { label: "Model Lens (live training environment)", href: "/lens" },
    { label: "Model Cycle", href: "/cycle" },
  ],
};
