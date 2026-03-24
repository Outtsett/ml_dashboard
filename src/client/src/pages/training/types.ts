export type Phase = "A" | "B" | "C" | "D" | "E";

export interface PhaseInfo {
  id: Phase;
  name: string;
  description: string;
  models: string[];
}

export const PHASES: PhaseInfo[] = [
  {
    id: "A",
    name: "Self-Supervised",
    description: "MAE, CPC, TS-TCC pre-training",
    models: ["mae", "cpc", "tstcc"],
  },
  {
    id: "B",
    name: "Unsupervised Structure",
    description: "Slot Attention, SOM+GAT, ICA+DCC, HDP-HMM, MoE, Statistical",
    models: ["slot_attention", "som", "gat", "ica", "dcc", "hdp_hmm", "moe", "garch", "kde", "gmm"],
  },
  {
    id: "C",
    name: "Semi-Supervised",
    description: "Label generation, Mean Teacher, FixMatch",
    models: ["labels", "mean_teacher", "fixmatch"],
  },
  {
    id: "D",
    name: "Supervised Fine-tuning",
    description: "Direction, MAML, Neural Processes, Calibration, Reasoning",
    models: ["direction", "bayesian_maml", "neural_process", "calibration", "reasoning"],
  },
  {
    id: "E",
    name: "End-to-End Joint",
    description: "Combined pipeline, walk-forward validation",
    models: ["combined", "walkforward"],
  },
];

export type PhaseStatus = "idle" | "running" | "completed" | "failed";
