/**
 * MLOps — getting a model into production and keeping it honest there.
 *
 * SRP: Data only. Merged by `../index.ts`.
 *
 * Training lives in `ml-training.ts`. This file is everything after the run
 * finishes: registry, deployment, serving, monitoring, and the failure modes
 * that only appear once real traffic is hitting the model.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  {
    id: "model-registry",
    term: "model registry",
    domain: "mlops",
    definition:
      "The versioned catalogue of trained models — each with its metrics, its training data version, its config, and a lifecycle stage.",
    why: "The artifact alone is not enough. Without the data version and the config, a model is a binary nobody can reproduce or defend.",
    see: ["model-versioning", "checkpoint", "experiment-tracking"],
  },
  {
    id: "model-versioning",
    term: "model versioning",
    domain: "mlops",
    definition:
      "Identifying exactly which model produced a prediction. **Three things have to be pinned**: code, data and configuration — pinning only the weights reproduces nothing.",
    see: ["model-registry", "reproducibility", "data-versioning"],
  },
  {
    id: "model-lineage",
    term: "model lineage",
    domain: "mlops",
    definition:
      "The chain from raw data through features and training run to the deployed artifact and the predictions it made.",
    why: "What lets you answer *which trades came from the model with the bug* rather than *all of them, probably*.",
    see: ["lineage", "model-registry", "audit-trail"],
  },
  {
    id: "model-card",
    term: "model card",
    domain: "mlops",
    definition:
      "A short document stating what a model is for, what data it saw, how it was evaluated, and **where it is known not to work**.",
    why: "The last part is the useful part, and the part that gets left out.",
    see: ["model-registry", "regime-conditioned-backtest"],
  },
  {
    id: "training-pipeline",
    term: "training pipeline",
    domain: "mlops",
    definition:
      "The automated path from raw data to a registered model — ingest, features, split, train, evaluate, register.",
    why: "If it only runs from a notebook on one machine, it is not a pipeline and the model cannot be retrained without the person who built it.",
    see: ["pipeline", "reproducibility", "retraining-trigger"],
  },
  {
    id: "ci-cd-ml",
    term: "CI/CD for ML",
    domain: "mlops",
    definition:
      "Continuous integration extended past code tests to **data tests and model tests** — schema checks, a training smoke run, and a performance gate before promotion.",
    see: ["training-pipeline", "validation-rule", "promotion-gate"],
  },
  {
    id: "promotion-gate",
    term: "promotion gate",
    domain: "mlops",
    definition:
      "The rule a candidate must clear to advance a stage — beat the incumbent out-of-sample, pass the leakage checks, stay inside a latency budget.",
    why: "Written and automated, or it becomes *the number looked good on the day someone asked*.",
    see: ["champion-challenger", "ci-cd-ml", "in-sample"],
  },
  {
    id: "champion-challenger",
    term: "champion / challenger",
    domain: "mlops",
    definition:
      "The live model is the champion; candidates run alongside as challengers and only take over on a pre-agreed criterion.",
    see: ["shadow-deployment", "ab-test", "promotion-gate"],
  },
  {
    id: "shadow-deployment",
    term: "shadow deployment",
    domain: "mlops",
    definition:
      "Running a new model on live traffic and **logging its output without acting on it**. Reveals latency, feature-pipeline breakage and distribution surprises at zero risk.",
    why: "Catches training/serving skew, which no offline test can.",
    see: ["training-serving-skew", "champion-challenger", "canary"],
  },
  {
    id: "canary",
    term: "canary release",
    domain: "mlops",
    definition:
      "Sending a small share of traffic to the new version and widening only if the metrics hold.",
    see: ["shadow-deployment", "rollback", "ab-test"],
  },
  {
    id: "ab-test",
    term: "A/B test",
    domain: "mlops",
    definition:
      "Splitting traffic between variants and comparing outcomes. **Randomisation is what makes the comparison causal.**",
    why: "In trading, the two arms share one market: they are not independent, and the effective sample is far smaller than the trade count.",
    see: ["canary", "overlapping-samples", "significance"],
  },
  {
    id: "rollback",
    term: "rollback",
    domain: "mlops",
    definition:
      "Reverting to the previous model version quickly and without a rebuild. **The capability that makes deploying safe**, and it must be rehearsed.",
    see: ["canary", "model-registry", "kill-switch"],
  },
  {
    id: "batch-vs-online-inference",
    term: "batch vs online inference",
    domain: "mlops",
    definition:
      "**Batch** precomputes predictions on a schedule and serves them from a table; **online** computes per request. Batch is simpler and cannot react to anything since the last run.",
    see: ["inference", "latency-budget", "feature-store"],
  },
  {
    id: "latency-budget",
    term: "latency budget",
    domain: "mlops",
    definition:
      "The total time allowed from event to action, split across feature computation, inference and order transmission.",
    why: "Feature computation usually dominates, not the model. Optimising the network first is the common mistake.",
    see: ["latency", "batch-vs-online-inference", "inference"],
  },
  {
    id: "model-monitoring",
    term: "model monitoring",
    domain: "mlops",
    definition:
      "Watching a live model for input drift, prediction drift and — when labels eventually arrive — real performance decay.",
    why: "Prediction drift shows up immediately; performance decay only after the label horizon. **The gap between them is your blind window.**",
    see: ["drift-detection", "label-latency", "observability"],
  },
  {
    id: "label-latency",
    term: "label latency",
    domain: "mlops",
    definition:
      "How long after a prediction its true outcome is known. **Until then the model cannot be scored**, only watched for drift.",
    why: "A 20-day label horizon means 20 days of flying on proxies before you learn anything.",
    see: ["model-monitoring", "label-horizon", "drift-detection"],
  },
  {
    id: "retraining-trigger",
    term: "retraining trigger",
    domain: "mlops",
    definition:
      "What causes a retrain — a schedule, a drift threshold, or a performance breach. **Scheduled is predictable; triggered is responsive; both are defensible, drifting into neither is not.**",
    see: ["model-monitoring", "drift-detection", "training-pipeline"],
  },
  {
    id: "feedback-loop",
    term: "feedback loop",
    domain: "mlops",
    definition:
      "The model's own actions changing the data it later trains on. **Trading is inherently one** — your fills move prices and your selection decides what you observe.",
    why: "Creates a self-confirming model: it only sees outcomes for the trades it chose to take.",
    see: ["selection-bias", "reward-hacking", "market-impact"],
  },
  {
    id: "audit-trail",
    term: "audit trail",
    domain: "mlops",
    definition:
      "An immutable record of every prediction with the model version, inputs and timestamp that produced it.",
    why: "Required to reconstruct why a decision was taken, and the only defence when a regulator or a risk committee asks.",
    see: ["model-lineage", "reproducibility", "observability"],
  },
  {
    id: "containerisation",
    term: "containerisation",
    aliases: ["docker", "image", "reproducible environment"],
    domain: "mlops",
    definition:
      "Packaging the model with its exact dependencies so it runs identically anywhere.",
    why: "Pin versions. An unpinned image rebuilt six months later is a different environment wearing the same tag.",
    see: ["reproducibility", "ci-cd-ml"],
  },
  {
    id: "config-management",
    term: "configuration management",
    domain: "mlops",
    definition:
      "Keeping hyperparameters, paths, thresholds and feature lists in versioned config rather than scattered through code.",
    why: "Makes a run describable by a single artifact — which is what makes it repeatable.",
    see: ["reproducibility", "experiment-tracking", "hyperparameter"],
  },
  {
    id: "secret-management",
    term: "secret management",
    domain: "mlops",
    definition:
      "Keeping credentials out of code and out of version control — environment variables, a vault, or a managed secret store.",
    why: "A key committed once is compromised even after the commit is removed; history keeps it.",
    see: ["containerisation", "config-management"],
  },
  {
    id: "resource-quota",
    term: "resource quota & cost",
    domain: "mlops",
    definition:
      "The compute, memory and spend a job is allowed. **GPU hours and query bytes are the usual runaways**, and both are easy to burn silently.",
    see: ["gpu", "observability"],
  },
];
