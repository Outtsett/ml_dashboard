/**
 * AgentButton — W8.e
 *
 * Per-stage thin wrapper that:
 *   1. Assembles a thin context blob (IDs + flags only — never the full
 *      pipeline state) from the MLStudioContext reducer.
 *   2. Calls `useAgentDispatch().dispatch(agentId, context)` to fire the
 *      single-flight POST + SSE subscription.
 *   3. Dispatches `openAgentPanel({ stage, agentId })` so the global
 *      `<AgentReport>` Sheet opens.
 *
 * Mounted per-stage:
 *   - FeaturesStage  → agentId="feature-curator"  stage="features"
 *   - LabelsStage    → agentId="hpo-strategist"   stage="labels"
 *   - TrainStage     → agentId="arch-designer"    stage="train"
 *   - EvaluateStage  → agentId="eval-reviewer"    stage="evaluate"
 *
 * Frontend §8.1: only one agent runs at a time per session — the dispatch hook
 * closes any prior EventSource before opening a new one, so clicking a
 * different stage's button mid-stream is safe.
 */

import { useCallback } from "react";
import { Sparkles, Loader2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils/utils";
import {
  useMLStudio,
  type StageId,
} from "@/ml/MLStudioContext";
import {
  useAgentDispatch,
  type AgentContextBlob,
  type AgentId,
} from "@/deployment/lib/useAgentDispatch";

interface AgentButtonProps {
  agentId: AgentId;
  stage: StageId;
  /** Optional className override for stage-specific layout. */
  className?: string;
  /** Optional label — defaults to "agent: {agentId}". */
  label?: string;
}

/**
 * Build the per-stage context blob from the reducer state. Each stage only
 * sends the IDs and flags the agent actually needs to reason — keeps the
 * payload small and avoids leaking transient preview blobs over the wire.
 */
function buildContextBlob(
  state: ReturnType<typeof useMLStudio>["state"],
  stage: StageId,
): AgentContextBlob {
  const base: AgentContextBlob = {
    symbol: state.symbol,
    timeframe: state.timeframe,
    stage,
  };

  switch (stage) {
    case "data":
      return {
        ...base,
        extras: {
          dateRange: state.dateRange,
          hasPreview: state.dataPreview != null,
        },
      };
    case "features":
      return {
        ...base,
        featurePipelineId: state.featurePipelineId,
        extras: {
          featureCategories: state.featureCategories,
          hasPreview: state.featurePreview != null,
        },
      };
    case "labels":
      return {
        ...base,
        featurePipelineId: state.featurePipelineId,
        labelStrategy: state.labelStrategy,
        extras: {
          labelParams: state.labelParams,
          hasPreview: state.labelPreview != null,
          objectiveConfig: state.objectiveConfig,
        },
      };
    case "train":
      return {
        ...base,
        featurePipelineId: state.featurePipelineId,
        labelStrategy: state.labelStrategy,
        modelType: state.modelType,
        selectedExperimentId: state.selectedExperimentId,
        extras: {
          composition: state.compositionConfig,
          walkForward: state.walkForward,
          objectiveConfig: state.objectiveConfig,
          hyperparameters: state.hyperparameters,
          hasGeneratedPreview: state.generatedPreview != null,
        },
      };
    case "evaluate":
      return {
        ...base,
        featurePipelineId: state.featurePipelineId,
        modelType: state.modelType,
        selectedExperimentIds: state.evalSelection,
        runIdByExperiment: state.runIdByExperiment,
        extras: {
          baselines: state.evalBaselines,
        },
      };
    case "promote":
      return {
        ...base,
        modelType: state.modelType,
        extras: {
          selectedVersionId: state.selectedVersionId,
        },
      };
  }
}

export function AgentButton({ agentId, stage, className, label }: AgentButtonProps) {
  const { state, dispatch } = useMLStudio();
  const agent = useAgentDispatch();

  // Pending if THIS stage's button is the active in-flight run.
  const isThisActive =
    state.agentPanel.stage === stage &&
    state.agentPanel.agentId === agentId &&
    (agent.status === "queued" || agent.status === "running");

  const handleClick = useCallback(() => {
    const ctx = buildContextBlob(state, stage);
    dispatch({ type: "openAgentPanel", stage, agentId });
    // Fire-and-forget; useAgentDispatch tracks state and surfaces errors via
    // the panel itself.
    void agent.dispatch(agentId, ctx).catch(() => {
      // Errors already surface in agent.error / agent.status.
    });
  }, [agent, agentId, dispatch, stage, state]);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleClick}
      className={cn("h-7 text-xs", className)}
      data-testid={`agent-button-${agentId}`}
      title={`Dispatch ${agentId} to analyze the current ${stage} stage`}
    >
      {isThisActive ? (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="mr-1 h-3 w-3" />
      )}
      {label ?? `agent: ${agentId}`}
    </Button>
  );
}
