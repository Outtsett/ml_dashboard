/**
 * RegimeAnalytics — Visual training analytics for regime detection.
 *
 * Decomposed per SRP: config form, model list, results display each live in
 * their own file. This file is the thin composition layer.
 */

import { ScrollArea } from "@/components/ui/scroll-area";
import { Layers } from "lucide-react";
import { useRegimeAnalytics } from "./useRegimeAnalytics";
import { RegimeConfigForm } from "./RegimeConfigForm";
import { RegimeModelList } from "./RegimeModelList";
import { RegimeResults } from "./RegimeResults";

interface RegimeAnalyticsProps {
  compact?: boolean;
}

export default function RegimeAnalytics({ compact = true }: RegimeAnalyticsProps) {
  const {
    isTraining, progress, trainLogs, trainError,
    startTraining, stopTraining, deleteModel,
    config, showAdvanced, setShowAdvanced,
    selectedModel, setSelectedModel,
    showDiagnostics, setShowDiagnostics,
    models, diagnostics, convergenceData, assignmentsData,
  } = useRegimeAnalytics();

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Train Controls */}
        <RegimeConfigForm
          config={config}
          showAdvanced={showAdvanced}
          onToggleAdvanced={() => setShowAdvanced(!showAdvanced)}
          isTraining={isTraining}
          progress={progress}
          trainLogs={trainLogs}
          trainError={trainError}
          onStart={startTraining}
          onStop={stopTraining}
        />

        {/* Trained Models List */}
        <RegimeModelList
          models={models}
          selectedModel={selectedModel}
          onSelectModel={(id) => { setSelectedModel(id); setShowDiagnostics(true); }}
          onDeleteModel={deleteModel}
        />

        {/* Diagnostics Panel */}
        {diagnostics && showDiagnostics && (
          <RegimeResults
            diagnostics={diagnostics}
            convergenceData={convergenceData as Record<string, Array<{ iter: number; log_likelihood: number; delta: number }>> | null}
            assignmentsData={assignmentsData as { rows: Array<{ regime: number; regime_label?: string; split?: string }>; total: number } | null}
            onToggleDiagnostics={() => setShowDiagnostics(!showDiagnostics)}
          />
        )}

        {/* Empty state */}
        {models.length === 0 && !isTraining && (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-20" />
            <p className="text-xs">No regime models yet</p>
            <p className="text-[10px] text-muted-foreground/60">Train one to detect market personalities</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
