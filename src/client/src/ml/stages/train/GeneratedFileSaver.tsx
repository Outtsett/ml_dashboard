/**
 * GeneratedFileSaver — Save & train / Save without training / Save & rename.
 *
 * Per W4 frontend sub-plan §1: invokes POST /api/training/save-generated,
 * dispatches `addExperiment` (status="queued"), and — for the Save & train
 * path — also calls `useTrainingControl().startTraining(...)`.
 *
 * The save endpoint expects the same payload schema as /generate-code plus a
 * required modelId and optional `files` map (Monaco edits). When the user has
 * dirty edits in the preview we round-trip the edited file contents.
 *
 * The W4.d TrainingExperimentBridge picks up the new sessionId emitted by
 * startTraining and patches the queued row → running → done.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Save, Play, Pencil, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { apiRequest } from "@/infrastructure/api/query_client";
import { toast } from "sonner";
import { useTrainingControl } from "@/training/lib/TrainingContext";
import { useTrainableCatalog } from "@/ml/lib/useModelCatalog";
import {
  useMLStudio,
  type ExperimentRecord,
} from "../../MLStudioContext";

// ─── Save endpoint contract (mirror of server schema) ────────────────────────

interface SaveGeneratedResponse {
  savedPaths: string[];
  runnerKey: string;
  templateUsed: string;
  warnings: string[];
}

interface SavePayload {
  catalogId: string;
  modelId: string;
  hyperparameters: Record<string, number | string | boolean>;
  walkForward: {
    trainMonths: number;
    testMonths: number;
    stepMonths: number;
    purgeBars: number;
  } | null;
  labelStrategy: string;
  labelParams: Record<string, number | string | boolean>;
  featurePipeline: string;
  featureCategories: string[];
  symbol: string;
  timeframe: string;
  files?: Record<string, string>;
  registerInRunners?: boolean;
}

// ─── Local helpers ───────────────────────────────────────────────────────────

/**
 * Crockford-base32 ULID-ish ID generator. We don't need full ULID monotonicity
 * here — just a roughly time-sortable, high-entropy id for local rows. The
 * server's ID becomes authoritative once the row is hydrated from
 * model_versions.
 */
function localExperimentId(): string {
  const ts = Date.now().toString(36).padStart(9, "0");
  const rand = Math.random().toString(36).slice(2, 10);
  return `exp_${ts}_${rand}`;
}

function sanitizeModelId(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "model"
  );
}

function suggestModelId(catalogId: string, existing: ExperimentRecord[]): string {
  const base = sanitizeModelId(catalogId);
  const taken = new Set(
    existing
      .map((e) => e.modelId)
      .filter((id): id is string => typeof id === "string"),
  );
  let n = 1;
  while (taken.has(`${base}_v${n}`)) n += 1;
  return `${base}_v${n}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GeneratedFileSaver() {
  const { state, dispatch } = useMLStudio();
  const training = useTrainingControl();
  const { data: catalog } = useTrainableCatalog();

  const preview = state.generatedPreview;
  const entry = state.modelType ? catalog?.[state.modelType] : null;

  const initialModelId = useMemo(
    () => suggestModelId(state.modelType || "model", state.experiments),
    [state.modelType, state.experiments],
  );

  const [modelIdInput, setModelIdInput] = useState(initialModelId);
  const [renameOpen, setRenameOpen] = useState(false);
  const [pendingTrainAfterSave, setPendingTrainAfterSave] = useState(false);

  // Re-seed the model id when modelType changes.
  useEffect(() => {
    setModelIdInput(initialModelId);
  }, [initialModelId]);

  const buildPayload = (modelId: string): SavePayload => {
    const featurePipeline =
      entry?.featurePipeline ?? state.featurePipelineId ?? "ohlcv_basic";
    const filesMap: Record<string, string> | undefined =
      preview && preview.dirty
        ? Object.fromEntries(preview.files.map((f) => [f.path, f.content]))
        : undefined;
    return {
      catalogId: state.modelType,
      modelId,
      hyperparameters: state.hyperparameters,
      walkForward: state.walkForward
        ? {
            trainMonths: state.walkForward.trainMonths,
            testMonths: state.walkForward.testMonths,
            stepMonths: state.walkForward.stepMonths ?? state.walkForward.testMonths,
            purgeBars: state.walkForward.purgeBars ?? 0,
          }
        : null,
      labelStrategy: state.labelStrategy,
      labelParams: state.labelParams,
      featurePipeline,
      featureCategories: state.featureCategories,
      symbol: state.symbol,
      timeframe: state.timeframe,
      files: filesMap,
      registerInRunners: true,
    };
  };

  const saveMut = useMutation<
    { result: SaveGeneratedResponse; modelId: string },
    Error,
    { modelId: string }
  >({
    mutationFn: async ({ modelId }) => {
      const payload = buildPayload(modelId);
      const res = await apiRequest("POST", "/api/training/save-generated", payload);
      const result = (await res.json()) as SaveGeneratedResponse;
      return { result, modelId };
    },
    onSuccess: ({ result, modelId }) => {
      // 1. Insert a queued ledger row.
      const id = localExperimentId();
      const record: ExperimentRecord = {
        id,
        catalogId: state.modelType,
        modelId,
        runnerKey: result.runnerKey,
        hyperparameters: { ...state.hyperparameters },
        walkForward: state.walkForward,
        objectiveConfig: state.objectiveConfig,
        labelStrategy: state.labelStrategy,
        labelParams: { ...state.labelParams },
        featurePipelineId:
          entry?.featurePipeline ?? state.featurePipelineId ?? null,
        featureCategories: [...state.featureCategories],
        status: "queued",
        foldMetrics: [],
        summary: null,
        startedAt: null,
        completedAt: null,
        trainingSessionId: null,
        diagnosticsPath: null,
        errorMessage: null,
        source: "user",
      };
      dispatch({ type: "addExperiment", record });
      dispatch({ type: "setSelectedExperiment", id });

      const warningSuffix =
        result.warnings.length > 0
          ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"})`
          : "";
      toast.success(`Saved ${result.savedPaths.length} file(s)${warningSuffix}`);

      // 2. If Save & train, kick off training. The W4.d bridge will match the
      //    new sessionId to this row's trainingSessionId once we patch it from
      //    a follow-up updateExperiment.
      if (pendingTrainAfterSave) {
        setPendingTrainAfterSave(false);
        training
          .startTraining({
            modelType: result.runnerKey,
            symbol: state.symbol,
            timeframe: state.timeframe,
            hyperparameters: state.hyperparameters,
            // The set saved in Stage 3, when one was saved for this timeframe.
            labelSetId:
              state.labelSet && state.labelSet.timeframe === state.timeframe
                ? state.labelSet.id
                : undefined,
            walkForward: state.walkForward
              ? {
                  trainMonths: state.walkForward.trainMonths,
                  testMonths: state.walkForward.testMonths,
                  stepMonths:
                    state.walkForward.stepMonths ?? state.walkForward.testMonths,
                }
              : undefined,
          })
          .catch((err: Error) => {
            toast.error(`Training failed to start: ${err.message}`);
            dispatch({
              type: "updateExperiment",
              id,
              patch: { status: "failed", errorMessage: err.message },
            });
          });
      }
    },
    onError: (err) => {
      setPendingTrainAfterSave(false);
      toast.error(`Save failed: ${err.message}`);
    },
  });

  // Wire up the new training sessionId to the most-recent queued ledger row.
  // The bridge keys off trainingSessionId, so we patch it as soon as the
  // session id is known. Idempotent: only patches the matching queued row.
  useEffect(() => {
    if (!training.sessionId) return;
    const queued = state.experiments.find(
      (e) => e.status === "queued" && e.trainingSessionId == null && e.source === "user",
    );
    if (!queued) return;
    dispatch({
      type: "updateExperiment",
      id: queued.id,
      patch: { trainingSessionId: training.sessionId },
    });
  }, [training.sessionId, state.experiments, dispatch]);

  const canSave = !!preview && !!entry && !saveMut.isPending;

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-xs font-medium text-foreground">Save generated files</span>
        <span className="text-[10px] text-muted-foreground">
          Writes to{" "}
          <code className="font-mono text-foreground">
            src/ml/{sanitizeModelId(modelIdInput)}/
          </code>{" "}
          and (optionally) starts training.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRenameOpen(true)}
          disabled={!canSave}
          data-testid="saver-rename"
        >
          <Pencil className="h-3.5 w-3.5" />
          Save & rename
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setPendingTrainAfterSave(false);
            saveMut.mutate({ modelId: sanitizeModelId(modelIdInput) });
          }}
          disabled={!canSave}
          data-testid="saver-save-only"
        >
          {saveMut.isPending && !pendingTrainAfterSave ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save without training
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setPendingTrainAfterSave(true);
            saveMut.mutate({ modelId: sanitizeModelId(modelIdInput) });
          }}
          disabled={!canSave || training.isTraining || training.isPending}
          data-testid="saver-save-train"
        >
          {saveMut.isPending && pendingTrainAfterSave ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Save & train
        </Button>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save with custom model ID</DialogTitle>
            <DialogDescription>
              The directory name and registry key. Lowercase letters, digits and underscores only.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="rename-model-id">Model ID</Label>
            <Input
              id="rename-model-id"
              value={modelIdInput}
              onChange={(e) => setModelIdInput(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setRenameOpen(false);
                setPendingTrainAfterSave(false);
                saveMut.mutate({ modelId: sanitizeModelId(modelIdInput) });
              }}
              disabled={!modelIdInput.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
