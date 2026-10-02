/**
 * EvaluateStage — Stage 5 of the ML Studio pipeline (W6.d rewrite).
 *
 * Visual hierarchy (frontend plan §6.1):
 *
 *   ┌─ header  ─────────────────────────────────────────────────────────────┐
 *   │  Stage 5 — Evaluate · [agent: eval-reviewer] · [+ Add registry mdl]   │
 *   ├─ ExperimentSelector (sticky chip row + baseline checkboxes) ─────────┤
 *   ├─ BacktestRunner (per-experiment progress strip) ─────────────────────┤
 *   ├─ ComparisonMatrix (FOCAL — always expanded) ─────────────────────────┤
 *   ├─ Tabs: Folds · Regime · Calibration · Bootstrap CI · Baselines ─────┤
 *   └───────────────────────────────────────────────────────────────────────┘
 *
 * Each tab body is `React.lazy`-loaded so we never instantiate Recharts (or
 * the bootstrap web worker) until the user actually opens that tab. Until the
 * W6.c chart components ship, tab bodies render an "in progress" placeholder.
 */

import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { FlaskConical, Plus, Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { useMLStudio } from "@/ml/MLStudioContext";
import type { ExperimentRecord } from "@/ml/MLStudioContext";
import { ExperimentSelector } from "./evaluate/ExperimentSelector";
import { BacktestRunner } from "./evaluate/BacktestRunner";
import {
  ComparisonMatrix,
  type ComparisonExperiment,
} from "./evaluate/ComparisonMatrix";
import type { MetricLookup } from "./evaluate/thresholds";

// ─── Lazy-loaded W6.c tab bodies ─────────────────────────────────────────────
//
// Folds / Regime / Calibration shipped in W6.c. Bootstrap and Baselines are
// still in flight — their tab content renders an inline placeholder until the
// modules land.

const WalkForwardFoldOverlay = lazy(() =>
  import("./evaluate/WalkForwardFoldOverlay").then((m) => ({
    default: m.WalkForwardFoldOverlay,
  })),
);
const RegimeBreakdown = lazy(() =>
  import("./evaluate/RegimeBreakdown").then((m) => ({ default: m.RegimeBreakdown })),
);
const CalibrationPanel = lazy(() =>
  import("./evaluate/CalibrationPanel").then((m) => ({ default: m.CalibrationPanel })),
);

function PendingW6cPanel({ label }: { label: string }) {
  return (
    <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.02] text-sm text-muted-foreground">
      {label} — shipping with W6.c
    </div>
  );
}

// ─── Mapping helpers ────────────────────────────────────────────────────────

/** Convert an ExperimentRecord summary into the MetricLookup shape ComparisonMatrix expects. */
function toMetricLookup(exp: ExperimentRecord): MetricLookup {
  const s = exp.summary;
  return {
    sharpe: s?.sharpe ?? null,
    profitFactor: s?.profitFactor ?? null,
    winRate: s?.winRate ?? null,
    maxDrawdown: s?.maxDrawdown ?? null,
    ece: s?.ece ?? null,
    meanTradePnl: s?.meanTradePnl ?? null,
  };
}

function toComparisonExperiment(exp: ExperimentRecord): ComparisonExperiment {
  return {
    id: exp.id,
    label: exp.id.slice(0, 8),
    catalogId: exp.catalogId ?? null,
    metrics: toMetricLookup(exp),
  };
}

/** Project per-fold metrics into the WalkForwardFoldOverlay shape (Sharpe series). */
function toFoldOverlayExperiment(exp: ExperimentRecord) {
  return {
    id: exp.id,
    label: exp.id.slice(0, 8),
    series: exp.foldMetrics.map((f) => ({
      fold: f.fold,
      mean: f.sharpe,
      ciLower: null,
      ciUpper: null,
    })),
  };
}

function toRegimeBreakdownExperiment(
  exp: ExperimentRecord,
  runIdByExperiment: Record<string, number>,
) {
  return {
    id: exp.id,
    label: exp.id.slice(0, 8),
    runId: runIdByExperiment[exp.id] ?? null,
  };
}

function toCalibrationExperiment(exp: ExperimentRecord) {
  return {
    id: exp.id,
    label: exp.id.slice(0, 8),
    diagnosticsPath: exp.diagnosticsPath,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

type TabValue = "folds" | "regime" | "calibration" | "bootstrap" | "baselines";

const TabFallback = (
  <div className="flex h-72 items-center justify-center text-xs text-muted-foreground">
    Loading…
  </div>
);

export function EvaluateStage() {
  const { state, dispatch } = useMLStudio();
  const [activeTab, setActiveTab] = useState<TabValue>("folds");

  const selectedExperiments = useMemo(() => {
    const byId = new Map(state.experiments.map((e) => [e.id, e] as const));
    return state.evalSelection
      .map((id) => byId.get(id))
      .filter((e): e is ExperimentRecord => Boolean(e));
  }, [state.evalSelection, state.experiments]);

  const comparisonExperiments = useMemo(
    () => selectedExperiments.map(toComparisonExperiment),
    [selectedExperiments],
  );

  const foldOverlayExperiments = useMemo(
    () => selectedExperiments.map(toFoldOverlayExperiment),
    [selectedExperiments],
  );

  const regimeExperiments = useMemo(
    () =>
      selectedExperiments.map((e) =>
        toRegimeBreakdownExperiment(e, state.runIdByExperiment),
      ),
    [selectedExperiments, state.runIdByExperiment],
  );

  const calibrationExperiments = useMemo(
    () => selectedExperiments.map(toCalibrationExperiment),
    [selectedExperiments],
  );

  const handleAgentDispatch = useCallback(() => {
    dispatch({
      type: "openAgentPanel",
      stage: "evaluate",
      agentId: "eval-reviewer",
    });
  }, [dispatch]);

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-white/5 px-4 pb-2 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display flex items-center gap-2 text-xl font-bold">
            <FlaskConical className="h-4 w-4 text-primary" />
            Stage 5 — Evaluate
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleAgentDispatch}
            data-testid="agent-eval-reviewer"
          >
            <Sparkles className="mr-1 h-3 w-3" />
            agent: eval-reviewer
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-xs text-muted-foreground"
            disabled
            title="Use the + pick popover in the chip row"
          >
            <Plus className="mr-1 h-3 w-3" />
            Add registry mdl
          </Button>
        </div>
        <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
          Compare experiments side-by-side on cost-adjusted Sharpe, profit factor,
          calibration, and regime conditional performance. Each tab below loads
          one chart at a time so the page stays scannable.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <ExperimentSelector />
        <BacktestRunner />

        <section className="px-6 py-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground/90">
            Comparison matrix
          </h3>
          <ComparisonMatrix
            experiments={comparisonExperiments}
            baselineLabel="baseline"
          />
        </section>

        <section className="px-6 pb-6">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as TabValue)}
          >
            <TabsList>
              <TabsTrigger value="folds">Folds</TabsTrigger>
              <TabsTrigger value="regime">Regime</TabsTrigger>
              <TabsTrigger value="calibration">Calibration</TabsTrigger>
              <TabsTrigger value="bootstrap">Bootstrap CI</TabsTrigger>
              <TabsTrigger value="baselines">Baselines</TabsTrigger>
            </TabsList>

            <TabsContent value="folds" className="mt-4">
              {activeTab === "folds" ? (
                <Suspense fallback={TabFallback}>
                  <WalkForwardFoldOverlay
                    experiments={foldOverlayExperiments}
                    metricLabel="Sharpe"
                  />
                </Suspense>
              ) : null}
            </TabsContent>
            <TabsContent value="regime" className="mt-4">
              {activeTab === "regime" ? (
                <Suspense fallback={TabFallback}>
                  <RegimeBreakdown experiments={regimeExperiments} metric="sharpe" />
                </Suspense>
              ) : null}
            </TabsContent>
            <TabsContent value="calibration" className="mt-4">
              {activeTab === "calibration" ? (
                <Suspense fallback={TabFallback}>
                  <CalibrationPanel experiments={calibrationExperiments} />
                </Suspense>
              ) : null}
            </TabsContent>
            <TabsContent value="bootstrap" className="mt-4">
              {activeTab === "bootstrap" ? (
                <PendingW6cPanel label="Block-bootstrap CI" />
              ) : null}
            </TabsContent>
            <TabsContent value="baselines" className="mt-4">
              {activeTab === "baselines" ? (
                <PendingW6cPanel label="Baseline comparison" />
              ) : null}
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}
