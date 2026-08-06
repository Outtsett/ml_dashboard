/**
 * LiveTrainingDashboard — Config-driven, model-adaptive training metrics grid.
 *
 * Reads metric-descriptions.json to determine which metrics to display and in
 * what order. Each metric renders as a MetricPanel (chart + description).
 * Fully adaptive: new model types just need a config entry — no UI changes.
 *
 * Layout modes:
 *   - "detailed" (default): MetricPanels with description sidebars, vertical stack
 *   - "compact": Small charts in a 2-3 column grid, no descriptions
 *   - "split": Top half = IterationMetrics + TransitionMatrix, bottom = metric panels
 */
import { useMemo, useState, type ReactNode } from "react";
import { useTrainingControl, useTrainingLive } from "@/training/lib/TrainingContext";
import { useMetricDescriptions } from "@/infrastructure/lib/useMetricDescriptions";
import { MetricPanel } from "./MetricPanel";
import { IterationMetrics } from "./IterationMetrics";
import { TransitionMatrixHeatmap } from "./TransitionMatrixHeatmap";
import { LayoutGrid, List, Columns } from "lucide-react";

type LayoutMode = "detailed" | "compact" | "split";

export function LiveTrainingDashboard() {
  const { isTraining, completedModelId, config: _config, progress, phase, selectedModelType } = useTrainingControl();
  const { iterationHistory, overlayData, diagnostics, elapsedSec } = useTrainingLive();
  const [layout, setLayout] = useState<LayoutMode>("detailed");

  const modelType = selectedModelType || "primitives-discovery";
  const { descriptions, metricOrder } = useMetricDescriptions(modelType);

  // Build per-metric time series from iterationHistory
  const metricSeries = useMemo(() => {
    const series: Record<string, Array<{ iteration: number; value: number }>> = {};

    for (const key of metricOrder) {
      series[key] = [];
    }

    for (const entry of (iterationHistory ?? [])) {
      for (const key of metricOrder) {
        const val = entry.metrics[key] ?? entry.metrics[camelToSnake(key)];
        if (val != null) {
          series[key]?.push({ iteration: entry.iteration, value: val });
        }
      }
    }

    return series;
  }, [iterationHistory, metricOrder]);

  // Which metrics have data?
  const activeMetrics = metricOrder.filter(k => (metricSeries[k]?.length ?? 0) > 0);

  if (!isTraining && !completedModelId) return null;

  // Overlay data for transition matrix
  const diag = diagnostics as Record<string, unknown> | null;
  const overlay = overlayData?.payload as Record<string, unknown> | undefined;
  const hasTransitionMatrix = !!(overlay?.transition_matrix ?? diag?.transition_matrix);

  return (
    <div className="h-full border border-white/5 rounded-xl overflow-hidden bg-black/20 flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-blue-400 font-medium uppercase tracking-wider">
            Live Training
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/40">
            {descriptions[activeMetrics[0] ?? ""]?.title ? `${activeMetrics.length} metrics` : "waiting..."}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <LayoutButton
            active={layout === "detailed"}
            onClick={() => setLayout("detailed")}
            icon={<List className="h-3 w-3" />}
            title="Detailed (chart + description)"
          />
          <LayoutButton
            active={layout === "compact"}
            onClick={() => setLayout("compact")}
            icon={<LayoutGrid className="h-3 w-3" />}
            title="Compact grid"
          />
          <LayoutButton
            active={layout === "split"}
            onClick={() => setLayout("split")}
            icon={<Columns className="h-3 w-3" />}
            title="Split view"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {layout === "detailed" && (
          <DetailedLayout
            activeMetrics={activeMetrics}
            metricSeries={metricSeries}
            descriptions={descriptions}
            isTraining={isTraining}
          />
        )}
        {layout === "compact" && (
          <CompactLayout
            activeMetrics={activeMetrics}
            metricSeries={metricSeries}
            descriptions={descriptions}
            isTraining={isTraining}
            iterationHistory={iterationHistory ?? []}
            progress={progress ?? 0}
            phase={phase ?? ""}
            elapsedSec={elapsedSec ?? 0}
          />
        )}
        {layout === "split" && (
          <SplitLayout
            activeMetrics={activeMetrics}
            metricSeries={metricSeries}
            descriptions={descriptions}
            isTraining={isTraining}
            iterationHistory={iterationHistory ?? []}
            progress={progress ?? 0}
            phase={phase ?? ""}
            elapsedSec={elapsedSec ?? 0}
            hasTransitionMatrix={hasTransitionMatrix}
            overlay={overlay}
            diag={diag}
          />
        )}
      </div>
    </div>
  );
}

// ── Layout variants ─────────────────────────────────────────────────────────

interface LayoutProps {
  activeMetrics: string[];
  metricSeries: Record<string, Array<{ iteration: number; value: number }>>;
  descriptions: Record<string, import("@/infrastructure/lib/useMetricDescriptions").MetricDescription>;
  isTraining: boolean;
}

function DetailedLayout({ activeMetrics, metricSeries, descriptions, isTraining }: LayoutProps) {
  if (activeMetrics.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground/40">
        <p className="text-xs font-mono">Waiting for training metrics...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-white/5">
      {activeMetrics.map(key => (
        <div key={key} className="h-44">
          <MetricPanel
            metricKey={key}
            desc={descriptions[key]!}
            data={metricSeries[key] ?? []}
            isTraining={isTraining}
            showDescription={true}
          />
        </div>
      ))}
    </div>
  );
}

function CompactLayout({
  activeMetrics,
  metricSeries,
  descriptions,
  isTraining,
  iterationHistory,
  progress,
  phase,
  elapsedSec,
}: LayoutProps & {
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;
  progress: number;
  phase: string;
  elapsedSec: number;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 h-full min-h-0">
      {/* Iteration metrics card always first */}
      <div className="border-r border-b border-white/5 h-44">
        <IterationMetrics
          isTraining={isTraining}
          progress={progress}
          phase={phase}
          iterationHistory={iterationHistory}
          elapsedSec={elapsedSec}
        />
      </div>
      {activeMetrics.map(key => (
        <div key={key} className="border-r border-b border-white/5 h-44">
          <MetricPanel
            metricKey={key}
            desc={descriptions[key]!}
            data={metricSeries[key] ?? []}
            isTraining={isTraining}
            compact={true}
          />
        </div>
      ))}
    </div>
  );
}

function SplitLayout({
  activeMetrics,
  metricSeries,
  descriptions,
  isTraining,
  iterationHistory,
  progress,
  phase,
  elapsedSec,
  hasTransitionMatrix,
  overlay,
  diag,
}: LayoutProps & {
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;
  progress: number;
  phase: string;
  elapsedSec: number;
  hasTransitionMatrix: boolean;
  overlay: Record<string, unknown> | undefined;
  diag: Record<string, unknown> | null;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Top: iteration metrics + transition matrix */}
      <div className="grid grid-cols-2 h-52 shrink-0 border-b border-white/5">
        <div className="border-r border-white/5">
          <IterationMetrics
            isTraining={isTraining}
            progress={progress}
            phase={phase}
            iterationHistory={iterationHistory}
            elapsedSec={elapsedSec}
          />
        </div>
        <div>
          {hasTransitionMatrix ? (
            <TransitionMatrixHeatmap
              matrix={(overlay?.transition_matrix ?? diag?.transition_matrix) as number[][] | null ?? null}
              nRegimes={typeof (overlay?.n_regimes ?? diag?.n_regimes) === "number"
                ? (overlay?.n_regimes ?? diag?.n_regimes) as number : 0}
              regimeLabels={overlay?.labels as Record<string, string> | undefined}
              regimeColors={overlay?.colors as Record<string, string> | undefined}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground/30">
              <p className="text-[10px] font-mono">Transition matrix pending...</p>
            </div>
          )}
        </div>
      </div>
      {/* Bottom: metric panels scrollable */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {activeMetrics.map(key => (
          <div key={key} className="h-40">
            <MetricPanel
              metricKey={key}
              desc={descriptions[key]!}
              data={metricSeries[key] ?? []}
              isTraining={isTraining}
              showDescription={true}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function LayoutButton({ active, onClick, icon, title }: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors ${
        active
          ? "bg-white/10 text-blue-400"
          : "text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-white/5"
      }`}
    >
      {icon}
    </button>
  );
}

/** Convert camelCase to snake_case for metric key lookup. */
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`);
}

export { ConvergenceChart } from "./ConvergenceChart";
export { RegimeCountTracker } from "./RegimeCountTracker";
export { TransitionMatrixHeatmap } from "./TransitionMatrixHeatmap";
export { IterationMetrics } from "./IterationMetrics";
export { MetricPanel } from "./MetricPanel";
