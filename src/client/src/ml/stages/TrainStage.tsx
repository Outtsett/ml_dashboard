/**
 * TrainStage — Stage 4 of the ML Studio pipeline (W4.c rewrite).
 *
 * Layout (top → bottom):
 *   1. Header
 *   2. ModelCatalogPicker        — pick the catalog/registry entry
 *   3. ArchitectureComposer      — atomic HP form + Generate code button
 *   4. WalkForwardPanel          — folds, purge bars, HPO objective
 *   5. CodePreviewPane           — Monaco editor over generated files
 *   6. GeneratedFileSaver        — Save & train / Save / Save & rename
 *   7. ExperimentLedger          — past + in-flight experiments
 *   8. Legacy <Training embedded /> — live SSE surface (ConfigStrip hidden)
 *
 * Rationale:
 *   - The composer + walk-forward panel + preview own all configuration
 *     state. The legacy <Training> page provides the live training surface
 *     (LiveTrainingView, GroupTabs, ModelBrowser) and reads from the global
 *     TrainingProvider, so we keep mounting it but pass `embedded` to hide
 *     its internal <ConfigStrip>.
 *   - The W4.d <TrainingExperimentBridge> watches the global SSE feed and
 *     patches the ledger row whose `trainingSessionId` matches the active
 *     session.
 */

import { lazy, Suspense, useEffect } from "react";
import { Brain } from "lucide-react";
import { PageLoader } from "@/shared/layout/LoadingSkeletons";
import { useTrainingControl } from "@/training/lib/TrainingContext";
import { useMLStudio } from "../MLStudioContext";
import ModelCatalogPicker from "@/training/ModelCatalogPicker";
import { CodePreviewPane } from "./train/CodePreviewPane";
import { TrainingExperimentBridge } from "./train/TrainingExperimentBridge";
import { ArchitectureComposer } from "./train/ArchitectureComposer";
import { WalkForwardPanel } from "./train/WalkForwardPanel";
import { ExperimentLedger } from "./train/ExperimentLedger";
import { Leaderboard } from "../experiments";
import { GeneratedFileSaver } from "./train/GeneratedFileSaver";

const Training = lazy(() => import("@/training/TrainingPage"));

export function TrainStage() {
  const { state, dispatch } = useMLStudio();
  const training = useTrainingControl();

  // Sync the global training context's completedModelId into pipeline state
  // so the Evaluate stage can pick it up (legacy bridge — the ledger handles
  // experiment-scoped completion, this still serves the standalone path).
  useEffect(() => {
    if (training.completedModelId && training.completedModelId !== state.completedModelId) {
      dispatch({ type: "setCompletedModelId", id: training.completedModelId });
    }
  }, [training.completedModelId, state.completedModelId, dispatch]);

  return (
    <div className="flex flex-col h-full">
      <TrainingExperimentBridge />
      <header className="px-4 pt-4 pb-2 shrink-0">
        <h2 className="text-xl font-display font-bold flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" /> Stage 4 — Train
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
          Pick an architecture, tune its hyperparameters, and generate the runner.
          Each Save & train run captures a row in the experiment ledger so you can
          fork or promote later.
        </p>
      </header>

      <div className="flex-1 min-h-0 overflow-auto px-4 pb-6 space-y-3">
        {/* 1 — Catalog picker */}
        <section className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <header className="mb-2">
            <h3 className="text-sm font-semibold text-foreground">
              Model catalog
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {state.modelType
                ? `Selected: ${state.modelType}`
                : "Pick the architecture to train. WIRED entries train directly; GENERATE entries render a runner from a template."}
            </p>
          </header>
          <ModelCatalogPicker
            selectedModelId={state.modelType || null}
            onSelectModel={(id) => {
              if (id !== state.modelType) {
                dispatch({ type: "setModelType", modelType: id });
                // Reset HPs so the composer reseeds defaults from the new entry.
                dispatch({ type: "setHyperparameters", hyperparameters: {} });
                // Composition resets to atomic and clears any stale preview.
                dispatch({
                  type: "setComposition",
                  config: { kind: "atomic", params: {}, subPicks: [] },
                });
              }
            }}
          />
        </section>

        {/* 2 — Composer */}
        <ArchitectureComposer />

        {/* 3 — Walk-forward + HPO */}
        <WalkForwardPanel />

        {/* 4 — Code preview */}
        <CodePreviewPane
          preview={state.generatedPreview}
          dirty={state.generatedPreview?.dirty ?? false}
          onChange={(path, content) =>
            dispatch({ type: "patchGeneratedFile", path, content })
          }
          onSave={() => {
            // The Save&train path lives on the dedicated saver below. This
            // callback fires from the in-editor "Save & train" button — same
            // semantics: queue an experiment and start training.
            const saveBtn = document.querySelector<HTMLButtonElement>(
              '[data-testid="saver-save-train"]',
            );
            saveBtn?.click();
          }}
          onSaveOnly={() => {
            const saveBtn = document.querySelector<HTMLButtonElement>(
              '[data-testid="saver-save-only"]',
            );
            saveBtn?.click();
          }}
          onRegenerate={() => {
            const genBtn = document.querySelector<HTMLButtonElement>(
              '[data-testid="composer-generate"]',
            );
            genBtn?.click();
          }}
        />

        {/* 5 — Saver controls */}
        <GeneratedFileSaver />

        {/* 6 — Leaderboard, then the full ledger.
             The leaderboard answers "which run is winning and can I trust the
             number"; the table below answers "what were all the runs and their
             exact values". It self-hides until something has completed. */}
        <Leaderboard />
        <ExperimentLedger />

        {/* 7 — Legacy live training surface (no ConfigStrip) */}
        <section className="rounded-lg border border-white/5 bg-white/[0.01] overflow-hidden">
          <header className="px-3 py-2 border-b border-white/5">
            <h3 className="text-sm font-semibold text-foreground">
              Live training surface
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              SSE-streamed metrics, live regime overlays, and post-training
              diagnostics for the active session.
            </p>
          </header>
          <Suspense fallback={<PageLoader />}>
            <Training embedded />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
