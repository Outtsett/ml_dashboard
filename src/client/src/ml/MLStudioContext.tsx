/**
 * MLStudioContext — Pipeline state scoped to /ml-studio.
 *
 * Owns the linear Data → Features → Labels → Train → Evaluate → Promote flow.
 * Persists to localStorage keyed by (symbol, timeframe) so users can resume
 * mid-pipeline.
 *
 * NOT mounted globally in App.tsx — provider lives at the /ml-studio route
 * boundary so MarketData / Portfolio / etc. never see this state.
 *
 * v2 (W4.c): Adds the experiment ledger + composer state per
 * `docs/plans/2026-05-09-ml-studio-workshop-integration-frontend.md` §2.
 *
 *   - `experiments` ring-buffer (≤50, prepend on add, auto-star on max Sharpe)
 *   - `compositionConfig` for atomic / MoE / stacking / voting / multimodal
 *   - `generatedPreview` mirroring the codegen response (cleared on composition
 *     or sub-pick changes; `dirty` flips on `patchGeneratedFile`)
 *   - `objectiveConfig` for the walk-forward HPO objective
 *   - `evalSelection` / `runIdByExperiment` / `evalCollapsed` for Stage 5
 *   - `registryFilters` / `selectedVersionId` / `drawerMode` for Stage 6
 *   - `agentPanel` for the global side-panel
 *
 * Storage key bumped from `mlstudio:pipeline:` to `mlstudio:pipeline:v2:`.
 * `migrateV1ToV2()` upgrades old payloads on first load and never throws.
 */

import { createContext, useContext, useEffect, useMemo, useReducer, useState } from "react";
import type { ReactNode } from "react";
import {
  useMLStudioPipelineSync,
  type MLStudioPipelineDocument,
} from "@/shared/hooks/useMLStudioPipelineSync";

// ─── Stage definitions ────────────────────────────────────────────────────────

export const STAGE_IDS = [
  "data",
  "features",
  "labels",
  "train",
  "evaluate",
  "promote",
] as const;
export type StageId = (typeof STAGE_IDS)[number];

export const STAGE_LABELS: Record<StageId, string> = {
  data: "Data",
  features: "Features",
  labels: "Labels",
  train: "Train",
  evaluate: "Evaluate",
  promote: "Promote",
};

// ─── Per-stage state shapes ───────────────────────────────────────────────────

export interface DataPreview {
  totalBars: number;
  firstTs: string;
  lastTs: string;
  nullCount: number;
}

export interface FeaturePreview {
  featureCount: number;
  meanAbsCorr: number;
  maxAbsCorr: number;
}

export interface LabelPreview {
  distribution: Record<string, number>;
  classBalanceRatio: number;
}

export type LabelStrategy =
  | "triple_barrier"
  | "next_close_direction"
  | "range_bucket"
  | "structural";

export type Timeframe =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d"
  | "1w";

export interface WalkForwardConfig {
  trainMonths: number;
  testMonths: number;
  stepMonths?: number;
  /** Optional purge bars between train and test windows. */
  purgeBars?: number;
  /** Number of folds to run (when fold-count is the user-facing knob). */
  folds?: number;
  /** Fold size in months — alternative to (trainMonths,testMonths). */
  foldMonths?: number;
}

export interface DateRange {
  start: string;
  end: string;
}

export interface DeploymentSummary {
  id: number;
  checkpointId: number;
  modelType: string;
  symbol: string;
  timeframe: string;
  mode: "paper" | "live";
  status: "running" | "paused" | "failed";
  startedAt: string;
  predictionsEmitted: number;
  paperPnl: number | null;
}

// ─── W4.c additions: experiment ledger + composer + agent panel ──────────────

export type ExperimentStatus =
  | "proposed"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface FoldMetric {
  fold: number;
  sharpe: number | null;
  profitFactor: number | null;
  ece: number | null;
  trainLoss: number | null;
  valLoss: number | null;
  trades: number | null;
}

export interface ExperimentSummary {
  sharpe: number | null;
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdown: number | null;
  ece: number | null;
  meanTradePnl: number | null;
  foldDispersion: number | null;
  isStarred: boolean;
}

export interface ObjectiveConfig {
  metric:
    | "sharpe_after_costs"
    | "profit_factor"
    | "neg_log_loss"
    | "ece"
    | "win_rate";
  direction: "maximize" | "minimize";
  nTrials: number;
  pruner: "median" | "none";
}

export interface ExperimentRecord {
  id: string; // ulid-ish; client-generated for local rows, server-supplied otherwise
  catalogId: string;
  modelId: string | null;
  runnerKey: string | null;
  hyperparameters: Record<string, number | string | boolean>;
  walkForward: WalkForwardConfig | null;
  objectiveConfig: ObjectiveConfig | null;
  labelStrategy: LabelStrategy;
  labelParams: Record<string, number | string | boolean>;
  featurePipelineId: string | null;
  featureCategories: string[];
  status: ExperimentStatus;
  foldMetrics: FoldMetric[];
  summary: ExperimentSummary | null;
  startedAt: string | null;
  completedAt: string | null;
  trainingSessionId: string | null;
  diagnosticsPath: string | null;
  errorMessage: string | null;
  source: "user" | "agent-proposed" | "ledger-fork" | "server";
}

export interface SubPick {
  slotId: string; // "expert_0", "modality_price.encoder"
  catalogId: string;
  modelId: string | null;
  hyperparameters: Record<string, number | string | boolean>;
  generatedHash: string | null;
}

export interface CompositionConfig {
  kind: "atomic" | "moe" | "stacking" | "voting" | "multimodal";
  params: Record<string, unknown>;
  subPicks: SubPick[];
}

export type GeneratedFileLanguage = "python" | "json";

export interface GeneratedFile {
  path: string;
  content: string;
  language: GeneratedFileLanguage;
}

export interface GeneratedPreview {
  files: GeneratedFile[];
  templateId: string;
  templateVersion: string;
  hash: string;
  warnings: string[];
  generatedAt: string;
  dirty: boolean;
}

export interface RegistryFilters {
  status: string[];
  catalogId: string | null;
  symbol: string | null;
  timeframe: string | null;
}

export interface EvalCollapsedSections {
  matrix: boolean;
  folds: boolean;
  regime: boolean;
  calibration: boolean;
  bootstrap: boolean;
  baseline: boolean;
}

export interface AgentPanelState {
  stage: StageId | null;
  agentId: string | null;
  open: boolean;
}

// ─── Pipeline shape ──────────────────────────────────────────────────────────

export interface MLStudioPipeline {
  // Stage 1 — Data
  symbol: string;
  timeframe: Timeframe;
  dateRange: DateRange | null;
  dataPreview: DataPreview | null;

  // Stage 2 — Features
  featurePipelineId: string | null;
  featureCategories: string[];
  featurePreview: FeaturePreview | null;

  // Stage 3 — Labels
  labelStrategy: LabelStrategy;
  labelParams: Record<string, number | string | boolean>;
  labelPreview: LabelPreview | null;

  // Stage 4 — Train
  modelType: string;
  hyperparameters: Record<string, number | string | boolean>;
  walkForward: WalkForwardConfig | null;
  activeTrainingId: string | null;
  completedModelId: string | null;

  // Stage 4 (W4.c) — Composer / ledger / preview
  experiments: ExperimentRecord[];
  experimentsCursor: string | null;
  compositionConfig: CompositionConfig | null;
  generatedPreview: GeneratedPreview | null;
  selectedExperimentId: string | null;
  objectiveConfig: ObjectiveConfig | null;

  // Stage 5 — Evaluate
  lastBacktestRunId: number | null;
  evalSelection: string[];
  runIdByExperiment: Record<string, number>;
  evalCollapsed: EvalCollapsedSections;
  /** Baseline benchmark IDs to overlay against selected experiments. */
  evalBaselines: string[];

  // Stage 6 — Promote
  promotedCheckpointId: number | null;
  activeDeployment: DeploymentSummary | null;
  registryFilters: RegistryFilters;
  selectedVersionId: number | null;
  drawerMode: "lineage" | "promote" | null;

  // Cross-stage agent panel (W8 owns the rendering)
  agentPanel: AgentPanelState;

  // Navigation
  activeStage: StageId;
}

// ─── Default state ────────────────────────────────────────────────────────────

const DEFAULT_REGISTRY_FILTERS: RegistryFilters = {
  status: ["candidate", "shadow", "paper", "live"],
  catalogId: null,
  symbol: null,
  timeframe: null,
};

const DEFAULT_EVAL_COLLAPSED: EvalCollapsedSections = {
  matrix: false,
  folds: false,
  regime: true,
  calibration: true,
  bootstrap: true,
  baseline: true,
};

const DEFAULT_AGENT_PANEL: AgentPanelState = {
  stage: null,
  agentId: null,
  open: false,
};

const DEFAULT_STATE: MLStudioPipeline = {
  symbol: "MNQ",
  timeframe: "1m",
  dateRange: null,
  dataPreview: null,

  featurePipelineId: null,
  featureCategories: [],
  featurePreview: null,

  labelStrategy: "next_close_direction",
  labelParams: {},
  labelPreview: null,

  modelType: "",
  hyperparameters: {},
  walkForward: null,
  activeTrainingId: null,
  completedModelId: null,

  experiments: [],
  experimentsCursor: null,
  compositionConfig: null,
  generatedPreview: null,
  selectedExperimentId: null,
  objectiveConfig: null,

  lastBacktestRunId: null,
  evalSelection: [],
  runIdByExperiment: {},
  evalCollapsed: DEFAULT_EVAL_COLLAPSED,
  evalBaselines: [],

  promotedCheckpointId: null,
  activeDeployment: null,
  registryFilters: DEFAULT_REGISTRY_FILTERS,
  selectedVersionId: null,
  drawerMode: null,

  agentPanel: DEFAULT_AGENT_PANEL,

  activeStage: "data",
};

// Hard cap on locally-persisted experiments (per frontend plan §2.3 / §5.3).
const EXPERIMENT_LOCAL_CAP = 50;

// ─── Reducer ──────────────────────────────────────────────────────────────────

export type MLStudioAction =
  | { type: "setSymbol"; symbol: string }
  | { type: "setTimeframe"; timeframe: Timeframe }
  | { type: "setDateRange"; dateRange: DateRange | null }
  | { type: "setDataPreview"; preview: DataPreview | null }
  | { type: "setFeaturePipeline"; pipelineId: string | null; categories?: string[] }
  | { type: "setFeaturePreview"; preview: FeaturePreview | null }
  | { type: "setLabelStrategy"; strategy: LabelStrategy; params?: Record<string, number | string | boolean> }
  | { type: "setLabelPreview"; preview: LabelPreview | null }
  | { type: "setModelType"; modelType: string }
  | { type: "setHyperparameters"; hyperparameters: Record<string, number | string | boolean> }
  | { type: "setWalkForward"; walkForward: WalkForwardConfig | null }
  | { type: "setActiveTrainingId"; id: string | null }
  | { type: "setCompletedModelId"; id: string | null }
  | { type: "setLastBacktestRunId"; id: number | null }
  | { type: "setPromotedCheckpointId"; id: number | null }
  | { type: "setActiveDeployment"; deployment: DeploymentSummary | null }
  | { type: "setActiveStage"; stage: StageId }
  | { type: "restorePipeline"; pipeline: MLStudioPipeline }
  // W4.c additions
  | { type: "addExperiment"; record: ExperimentRecord }
  | { type: "updateExperiment"; id: string; patch: Partial<ExperimentRecord> }
  | { type: "removeExperiment"; id: string }
  | { type: "starExperiment"; id: string; starred: boolean }
  | { type: "setSelectedExperiment"; id: string | null }
  | { type: "hydrateExperiments"; records: ExperimentRecord[] }
  | { type: "setComposition"; config: CompositionConfig | null }
  | {
      type: "setSubPick";
      slotId: string;
      catalogId: string;
      hyperparameters: Record<string, number | string | boolean>;
    }
  | { type: "setGeneratedPreview"; preview: GeneratedPreview | null }
  | { type: "patchGeneratedFile"; path: string; content: string }
  | { type: "setEvalSelection"; ids: string[] }
  | { type: "setEvalBaselines"; ids: string[] }
  | { type: "setBacktestRunId"; experimentId: string; runId: number }
  | {
      type: "toggleEvalSection";
      section: keyof EvalCollapsedSections;
      collapsed: boolean;
    }
  | { type: "setRegistryFilters"; filters: Partial<RegistryFilters> }
  | {
      type: "setSelectedVersion";
      versionId: number | null;
      mode?: "lineage" | "promote";
    }
  | { type: "openAgentPanel"; stage: StageId; agentId: string }
  | { type: "closeAgentPanel" }
  | { type: "setObjectiveConfig"; config: ObjectiveConfig | null }
  | { type: "reset" };

function autoStarOnNewMaxSharpe(
  state: MLStudioPipeline,
  patched: ExperimentRecord,
): ExperimentRecord {
  const sharpe = patched.summary?.sharpe;
  if (sharpe == null || patched.summary == null) return patched;
  // Compare against other completed experiments for the same
  // (catalogId, symbol, timeframe) tuple. Symbol/timeframe live on the
  // pipeline root (experiments inherit context at create time).
  const peerMax = state.experiments
    .filter(
      (e) =>
        e.id !== patched.id &&
        e.catalogId === patched.catalogId &&
        e.summary?.sharpe != null,
    )
    .reduce((max, e) => Math.max(max, e.summary!.sharpe!), -Infinity);
  if (sharpe > peerMax) {
    return { ...patched, summary: { ...patched.summary, isStarred: true } };
  }
  return patched;
}

/**
 * Swap the WHOLE pipeline over to a different (symbol, timeframe) pair.
 *
 * The storage key is derived from `state.symbol` / `state.timeframe`, so a
 * transition that changes only those two fields leaves a committed state whose
 * key points at the new pair while the payload still belongs to the old one.
 * The persist effect then writes the old pair's `experiments` (and every other
 * carried-over field) under the new pair's key, destroying whatever was saved
 * there. Doing the swap here — synchronously, inside the reducer — means no
 * such state is ever committed, so the persist effect can never observe one.
 *
 * `loadFromStorage` is a pure read (it never writes), so a React StrictMode
 * double-invocation of the reducer produces an identical result.
 */
function pipelineForPair(symbol: string, timeframe: Timeframe): MLStudioPipeline {
  const persisted = loadFromStorage(symbol, timeframe);
  // Force the requested pair onto the result — a mis-keyed or hand-edited
  // payload must never re-point the pipeline at a different pair.
  return { ...(persisted ?? DEFAULT_STATE), symbol, timeframe };
}

function reducer(state: MLStudioPipeline, action: MLStudioAction): MLStudioPipeline {
  switch (action.type) {
    case "restorePipeline":
      // Replace wholesale, but only when the incoming pair still matches the
      // one on screen. The server copy arrives asynchronously, and a user who
      // switched symbol while it was in flight must not have the old pair's
      // experiments dropped on top of the new one.
      if (
        action.pipeline.symbol !== state.symbol ||
        action.pipeline.timeframe !== state.timeframe
      ) {
        return state;
      }
      return action.pipeline;
    case "setSymbol":
      // A pair change replaces the entire pipeline with that pair's persisted
      // state (or a fresh default), never a partial carry-over of the previous
      // pair's experiments / composition / eval / promote state.
      if (action.symbol === state.symbol) return state;
      return pipelineForPair(action.symbol, state.timeframe);
    case "setTimeframe":
      if (action.timeframe === state.timeframe) return state;
      return pipelineForPair(state.symbol, action.timeframe);
    case "setDateRange":
      return { ...state, dateRange: action.dateRange, dataPreview: null };
    case "setDataPreview":
      return { ...state, dataPreview: action.preview };
    case "setFeaturePipeline":
      return {
        ...state,
        featurePipelineId: action.pipelineId,
        featureCategories: action.categories ?? state.featureCategories,
        featurePreview: null,
      };
    case "setFeaturePreview":
      return { ...state, featurePreview: action.preview };
    case "setLabelStrategy":
      return {
        ...state,
        labelStrategy: action.strategy,
        labelParams: action.params ?? state.labelParams,
        labelPreview: null,
      };
    case "setLabelPreview":
      return { ...state, labelPreview: action.preview };
    case "setModelType":
      return { ...state, modelType: action.modelType };
    case "setHyperparameters":
      return { ...state, hyperparameters: action.hyperparameters };
    case "setWalkForward":
      return { ...state, walkForward: action.walkForward };
    case "setActiveTrainingId":
      return { ...state, activeTrainingId: action.id };
    case "setCompletedModelId":
      return { ...state, completedModelId: action.id };
    case "setLastBacktestRunId":
      return { ...state, lastBacktestRunId: action.id };
    case "setPromotedCheckpointId":
      return { ...state, promotedCheckpointId: action.id };
    case "setActiveDeployment":
      return { ...state, activeDeployment: action.deployment };
    case "setActiveStage":
      return { ...state, activeStage: action.stage };

    // ─── W4.c experiment ledger ─────────────────────────────────────────────
    case "addExperiment": {
      const next = [action.record, ...state.experiments];
      const capped =
        next.length > EXPERIMENT_LOCAL_CAP
          ? next.slice(0, EXPERIMENT_LOCAL_CAP)
          : next;
      return { ...state, experiments: capped };
    }
    case "updateExperiment": {
      let mutated = false;
      const merged = state.experiments.map((e) => {
        if (e.id !== action.id) return e;
        mutated = true;
        const patched: ExperimentRecord = { ...e, ...action.patch };
        if (action.patch.summary && e.summary) {
          patched.summary = { ...e.summary, ...action.patch.summary };
        }
        return autoStarOnNewMaxSharpe(state, patched);
      });
      if (!mutated) return state;
      return { ...state, experiments: merged };
    }
    case "removeExperiment": {
      const filtered = state.experiments.filter((e) => e.id !== action.id);
      if (filtered.length === state.experiments.length) return state;
      const selected =
        state.selectedExperimentId === action.id
          ? null
          : state.selectedExperimentId;
      return { ...state, experiments: filtered, selectedExperimentId: selected };
    }
    case "starExperiment": {
      const merged = state.experiments.map((e) => {
        if (e.id !== action.id) return e;
        if (!e.summary) {
          return {
            ...e,
            summary: {
              sharpe: null,
              profitFactor: null,
              winRate: null,
              maxDrawdown: null,
              ece: null,
              meanTradePnl: null,
              foldDispersion: null,
              isStarred: action.starred,
            },
          };
        }
        return { ...e, summary: { ...e.summary, isStarred: action.starred } };
      });
      return { ...state, experiments: merged };
    }
    case "setSelectedExperiment":
      return { ...state, selectedExperimentId: action.id };
    case "hydrateExperiments": {
      // Merge by id; prefer local copy when local.status === "running"
      // (race: server hydrate could clobber live foldMetrics).
      const localById = new Map(state.experiments.map((e) => [e.id, e] as const));
      const incomingIds = new Set<string>();
      const merged: ExperimentRecord[] = [];
      for (const incoming of action.records) {
        incomingIds.add(incoming.id);
        const local = localById.get(incoming.id);
        if (local && local.status === "running") {
          merged.push(local);
        } else if (local) {
          merged.push({ ...local, ...incoming });
        } else {
          merged.push(incoming);
        }
      }
      // Preserve any local rows the server didn't return (e.g. queued/proposed
      // rows the server doesn't know about yet).
      for (const local of state.experiments) {
        if (!incomingIds.has(local.id)) merged.push(local);
      }
      const capped =
        merged.length > EXPERIMENT_LOCAL_CAP
          ? merged.slice(0, EXPERIMENT_LOCAL_CAP)
          : merged;
      return { ...state, experiments: capped };
    }
    case "setComposition":
      return {
        ...state,
        compositionConfig: action.config,
        generatedPreview: null,
      };
    case "setSubPick": {
      const cur = state.compositionConfig;
      if (!cur) return state;
      const idx = cur.subPicks.findIndex((p) => p.slotId === action.slotId);
      const next: SubPick = {
        slotId: action.slotId,
        catalogId: action.catalogId,
        modelId: idx >= 0 ? cur.subPicks[idx]!.modelId : null,
        hyperparameters: action.hyperparameters,
        generatedHash: null,
      };
      const subPicks =
        idx >= 0
          ? cur.subPicks.map((p, i) => (i === idx ? next : p))
          : [...cur.subPicks, next];
      return {
        ...state,
        compositionConfig: { ...cur, subPicks },
        generatedPreview: null,
      };
    }
    case "setGeneratedPreview":
      return { ...state, generatedPreview: action.preview };
    case "patchGeneratedFile": {
      const cur = state.generatedPreview;
      if (!cur) return state;
      let mutated = false;
      const files = cur.files.map((f) => {
        if (f.path !== action.path) return f;
        mutated = true;
        return { ...f, content: action.content };
      });
      if (!mutated) return state;
      return {
        ...state,
        generatedPreview: { ...cur, files, dirty: true },
      };
    }
    case "setEvalSelection":
      return { ...state, evalSelection: action.ids };
    case "setEvalBaselines":
      return { ...state, evalBaselines: action.ids };
    case "setBacktestRunId":
      return {
        ...state,
        runIdByExperiment: {
          ...state.runIdByExperiment,
          [action.experimentId]: action.runId,
        },
      };
    case "toggleEvalSection":
      return {
        ...state,
        evalCollapsed: { ...state.evalCollapsed, [action.section]: action.collapsed },
      };
    case "setRegistryFilters":
      return {
        ...state,
        registryFilters: { ...state.registryFilters, ...action.filters },
      };
    case "setSelectedVersion":
      return {
        ...state,
        selectedVersionId: action.versionId,
        drawerMode: action.versionId == null ? null : (action.mode ?? "lineage"),
      };
    case "openAgentPanel":
      return {
        ...state,
        agentPanel: { stage: action.stage, agentId: action.agentId, open: true },
      };
    case "closeAgentPanel":
      return { ...state, agentPanel: { ...state.agentPanel, open: false } };
    case "setObjectiveConfig":
      return { ...state, objectiveConfig: action.config };

    case "reset":
      // Preserve user-collected experiment history + registry preferences.
      return {
        ...DEFAULT_STATE,
        symbol: state.symbol,
        timeframe: state.timeframe,
        experiments: state.experiments,
        registryFilters: state.registryFilters,
      };
    default:
      return state;
  }
}

// ─── Stage gating ─────────────────────────────────────────────────────────────

export interface StageGate {
  ready: boolean;
  reason: string | null;
}

export function gateForStage(stage: StageId, p: MLStudioPipeline): StageGate {
  switch (stage) {
    case "data":
      return { ready: true, reason: null };
    case "features":
      return p.dataPreview
        ? { ready: true, reason: null }
        : { ready: false, reason: "Run data preview first" };
    case "labels":
      return p.featurePipelineId
        ? { ready: true, reason: null }
        : { ready: false, reason: "Pick a feature pipeline first" };
    case "train":
      return p.labelPreview
        ? { ready: true, reason: null }
        : { ready: false, reason: "Preview labels first" };
    case "evaluate":
      return p.experiments.some((e) => e.status === "done") ||
        p.completedModelId ||
        p.promotedCheckpointId
        ? { ready: true, reason: null }
        : { ready: false, reason: "Train at least one experiment to completion first" };
    case "promote":
      return p.lastBacktestRunId || Object.keys(p.runIdByExperiment).length > 0
        ? { ready: true, reason: null }
        : { ready: false, reason: "Run a backtest in Stage 5 first" };
    default:
      return { ready: true, reason: null };
  }
}

/**
 * Used by the StageStepper to decide whether to render a check-mark.
 * Train is "complete" once any experiment finishes successfully OR a legacy
 * `completedModelId` is set (for backwards compat with sessions that never
 * went through the new ledger).
 */
export function isStageComplete(stage: StageId, p: MLStudioPipeline): boolean {
  switch (stage) {
    case "data":
      return p.dataPreview != null;
    case "features":
      return p.featurePreview != null;
    case "labels":
      return p.labelPreview != null;
    case "train":
      return (
        p.experiments.some((e) => e.status === "done") || p.completedModelId != null
      );
    case "evaluate":
      return (
        p.lastBacktestRunId != null ||
        Object.keys(p.runIdByExperiment).length > 0
      );
    case "promote":
      return p.activeDeployment != null;
    default:
      return false;
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_PREFIX_V1 = "mlstudio:pipeline:";
const STORAGE_PREFIX_V2 = "mlstudio:pipeline:v2:";

function storageKeyV1(symbol: string, timeframe: string): string {
  return `${STORAGE_PREFIX_V1}${symbol}:${timeframe}`;
}

function storageKeyV2(symbol: string, timeframe: string): string {
  return `${STORAGE_PREFIX_V2}${symbol}:${timeframe}`;
}

/**
 * Promote a v1 payload into a v2 payload. Never throws — always falls back to
 * `DEFAULT_STATE` for anything malformed. Drops `generatedPreview` (never
 * restore previews — they're recomputed from current composer state).
 */
export function migrateV1ToV2(parsed: unknown): MLStudioPipeline {
  if (!parsed || typeof parsed !== "object") return DEFAULT_STATE;
  const p = parsed as Record<string, unknown>;
  const symbol = typeof p.symbol === "string" ? p.symbol : DEFAULT_STATE.symbol;
  const timeframe =
    typeof p.timeframe === "string"
      ? (p.timeframe as Timeframe)
      : DEFAULT_STATE.timeframe;
  const experiments = Array.isArray(p.experiments)
    ? (p.experiments as ExperimentRecord[])
    : [];
  const evalSelection = Array.isArray(p.evalSelection)
    ? (p.evalSelection as string[])
    : [];
  const runIdByExperiment =
    p.runIdByExperiment && typeof p.runIdByExperiment === "object"
      ? (p.runIdByExperiment as Record<string, number>)
      : {};
  const registryFilters: RegistryFilters = {
    status: ["candidate", "shadow", "paper", "live"],
    catalogId: null,
    symbol,
    timeframe,
  };

  return {
    ...DEFAULT_STATE,
    ...(p as Partial<MLStudioPipeline>),
    symbol,
    timeframe,
    experiments,
    experimentsCursor: null,
    compositionConfig:
      (p.compositionConfig as CompositionConfig | null | undefined) ?? null,
    generatedPreview: null,
    selectedExperimentId: null,
    objectiveConfig: null,
    evalSelection,
    runIdByExperiment,
    evalCollapsed: DEFAULT_EVAL_COLLAPSED,
    evalBaselines: Array.isArray(p.evalBaselines) ? (p.evalBaselines as string[]) : [],
    registryFilters,
    selectedVersionId: null,
    drawerMode: null,
    agentPanel: DEFAULT_AGENT_PANEL,
    activeStage:
      (p.activeStage as StageId | undefined) ?? DEFAULT_STATE.activeStage,
  };
}

function loadFromStorage(symbol: string, timeframe: Timeframe): MLStudioPipeline | null {
  if (typeof window === "undefined") return null;
  try {
    const v2Raw = window.localStorage.getItem(storageKeyV2(symbol, timeframe));
    if (v2Raw) {
      const parsed = JSON.parse(v2Raw) as MLStudioPipeline;
      if (typeof parsed.symbol !== "string" || typeof parsed.timeframe !== "string") {
        return null;
      }
      return { ...DEFAULT_STATE, ...parsed };
    }
    const v1Raw = window.localStorage.getItem(storageKeyV1(symbol, timeframe));
    if (!v1Raw) return null;
    const parsed = JSON.parse(v1Raw) as unknown;
    return migrateV1ToV2(parsed);
  } catch {
    return null;
  }
}

function saveToStorage(state: MLStudioPipeline): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKeyV2(state.symbol, state.timeframe),
      JSON.stringify(state),
    );
  } catch {
    // Quota / disabled — silent fail is acceptable, state stays in memory
  }
}

// ─── Context + Provider ───────────────────────────────────────────────────────

interface MLStudioContextValue {
  state: MLStudioPipeline;
  dispatch: React.Dispatch<MLStudioAction>;
  gates: Record<StageId, StageGate>;
}

const MLStudioContext = createContext<MLStudioContextValue | null>(null);

interface MLStudioProviderProps {
  children: ReactNode;
  /**
   * The pair to open on. ML Studio follows the dashboard-wide selection (see
   * `StudioSelectionSync`), so the page passes that pair here and the first
   * render is already the right pipeline rather than MNQ 1m followed by a swap.
   * Read once, at mount.
   */
  initialPair?: { symbol: string; timeframe: Timeframe };
}

export function MLStudioProvider({ children, initialPair }: MLStudioProviderProps) {
  // A lazy initializer, not a memo: the seed is read exactly once by design.
  const [initial] = useState(() =>
    pipelineForPair(
      initialPair?.symbol ?? DEFAULT_STATE.symbol,
      initialPair?.timeframe ?? DEFAULT_STATE.timeframe,
    ),
  );
  const [state, dispatch] = useReducer(reducer, initial);

  // Server-side copy of this pair's pipeline. localStorage stays the instant
  // first paint; this is what makes the Workshop resume on a second machine or
  // after cleared site data, which localStorage alone cannot do.
  const pipelineSync = useMLStudioPipelineSync(state.symbol, state.timeframe);
  const { pull: pullPipeline, push: pushPipeline } = pipelineSync;

  // Pull once per pair. The local seed has already painted; the server copy
  // replaces it if one exists.
  useEffect(() => {
    let cancelled = false;
    void pullPipeline().then((snapshot) => {
      if (cancelled || !snapshot) return;
      const restored = snapshot.pipelineState as unknown as MLStudioPipeline;
      if (!restored || typeof restored !== "object") return;
      dispatch({ type: "restorePipeline", pipeline: restored });
    });
    return () => {
      cancelled = true;
    };
  }, [pullPipeline]);

  // Persist on every change. Safe against cross-pair clobbering because the
  // reducer swaps symbol/timeframe and payload together (see `pipelineForPair`),
  // so every committed state's key matches its own contents.
  useEffect(() => {
    saveToStorage(state);
    // Debounced inside the hook, and identical consecutive payloads are
    // dropped, so reducer churn does not become a write per keystroke.
    pushPipeline(state as unknown as MLStudioPipelineDocument);
  }, [state, pushPipeline]);

  const gates = useMemo(
    () =>
      STAGE_IDS.reduce((acc, id) => {
        acc[id] = gateForStage(id, state);
        return acc;
      }, {} as Record<StageId, StageGate>),
    [state],
  );

  const value = useMemo(() => ({ state, dispatch, gates }), [state, gates]);

  return <MLStudioContext.Provider value={value}>{children}</MLStudioContext.Provider>;
}

export function useMLStudio(): MLStudioContextValue {
  const ctx = useContext(MLStudioContext);
  if (!ctx) {
    throw new Error("useMLStudio must be used inside <MLStudioProvider>");
  }
  return ctx;
}

// ─── Test-only exports ───────────────────────────────────────────────────────
//
// Named with the __INTERNAL_FOR_TESTS__ prefix so production callers can't
// accidentally depend on them — only the vitest unit suite imports this.

export const __INTERNAL_FOR_TESTS__ = {
  DEFAULT_STATE,
  reducer,
  EXPERIMENT_LOCAL_CAP,
  storageKeyV1,
  storageKeyV2,
};
