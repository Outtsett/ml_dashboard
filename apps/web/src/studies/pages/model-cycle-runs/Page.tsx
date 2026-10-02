/**
 * Model Cycle runs: the notebook's cells as eight tabs. The run list, the
 * all-run comparison and the audit come from one request (part=overview); the
 * chosen recipe's panels come from another (part=run) that also takes the
 * histogram bin count, so dragging the slider re-reads one recipe only. The
 * recipe, the bin count, the tab and every stepper live in the URL.
 */

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { ControlBar, SliderControl, StudyNotes, StudyState, fmtInt, useStudyControls } from "@/studies/kit";
import { EMPTY_OVERVIEW, EMPTY_RUN } from "@shared/studies/model-cycle-runs";
import { AuditTab } from "./AuditTab";
import { CalibrationTab } from "./CalibrationTab";
import { CompareTab } from "./CompareTab";
import { DEFAULTS, shortRecipe, useOverview, useRun, type TabProps } from "./common";
import { MetricsTab } from "./MetricsTab";
import { PredictionsTab } from "./PredictionsTab";
import { RunsTab } from "./RunsTab";
import { TradesTab } from "./TradesTab";
import { TuningTab } from "./TuningTab";

const TABS: Array<{ id: string; label: string; needsRun: boolean; render: (props: TabProps) => ReactNode }> = [
  { id: "runs", label: "Runs", needsRun: false, render: (props) => <RunsTab {...props} /> },
  { id: "predictions", label: "Predictions", needsRun: true, render: (props) => <PredictionsTab {...props} /> },
  { id: "trades", label: "Trades & folds", needsRun: true, render: (props) => <TradesTab {...props} /> },
  { id: "tuning", label: "Tuning & training", needsRun: true, render: (props) => <TuningTab {...props} /> },
  { id: "metrics", label: "Metrics", needsRun: true, render: (props) => <MetricsTab {...props} /> },
  { id: "calibration", label: "Calibration, days & drawdowns", needsRun: true, render: (props) => <CalibrationTab {...props} /> },
  { id: "compare", label: "Compare runs", needsRun: false, render: (props) => <CompareTab {...props} /> },
  { id: "audit", label: "Audit", needsRun: false, render: (props) => <AuditTab {...props} /> },
];

export default function Page() {
  const [controls, set, reset] = useStudyControls(DEFAULTS);
  const overviewQuery = useOverview();
  const overview = overviewQuery.data?.data.overview ?? EMPTY_OVERVIEW;
  const recipe = controls.recipe || overview.defaultRecipe || "";
  const runQuery = useRun(recipe, controls.bins, overviewQuery.data !== undefined);
  const run = runQuery.data?.data.run ?? EMPTY_RUN;
  const active = TABS.find((tab) => tab.id === controls.tab) ?? (TABS[0] as (typeof TABS)[number]);
  const notes = [...new Set([...(overviewQuery.data?.notes ?? []), ...(runQuery.data?.notes ?? [])])];
  const switching = runQuery.isFetching && run.recipe !== null && run.recipe !== recipe;

  return (
    <div className="min-w-0 space-y-3">
      <StudyNotes notes={notes} />
      <ControlBar onReset={reset}>
        <label className="flex min-w-0 flex-1 flex-col gap-1" style={{ minWidth: "18rem" }}>
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Run</span>
          <select
            value={recipe}
            onChange={(event) => set("recipe", event.target.value)}
            className="h-7 min-w-0 rounded border border-neutral-700 bg-neutral-950 px-2 font-mono text-xs text-neutral-200"
            aria-label="Run"
          >
            {recipe === "" && <option value="">No run in the lake</option>}
            {overview.recipes.map((option) => (
              <option key={option.recipe} value={option.recipe}>{`${option.recipe} · ${option.status}`}</option>
            ))}
          </select>
        </label>
        <SliderControl
          label="Histogram bins" value={controls.bins} min={10} max={80} step={5} onChange={(value) => set("bins", value)}
          hint="Bins of the histograms on the Predictions and Trades tabs"
        />
        <span className="flex items-center gap-1 pb-1 text-[11px] text-neutral-500" aria-live="polite">
          {runQuery.isFetching ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> reading {shortRecipe(recipe)}…</>
          ) : run.recipe ? (
            <>showing {fmtInt(run.predictionSummary?.count ?? 0)} bars</>
          ) : null}
        </span>
      </ControlBar>

      <nav className="flex flex-wrap gap-1 border-b border-neutral-800 pb-2" aria-label="Study sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => set("tab", tab.id)}
            aria-pressed={tab.id === active.id}
            className={`rounded px-2 py-1 text-[11px] ${tab.id === active.id ? "bg-neutral-700 text-neutral-50" : "text-neutral-400 hover:bg-neutral-800"}`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <StudyState
        isLoading={overviewQuery.isLoading || (active.needsRun && runQuery.isLoading)}
        error={overviewQuery.error ?? (active.needsRun ? runQuery.error : null)}
      >
        <div className={switching ? "opacity-60" : undefined}>{active.render({ controls, set, overview, run, recipe })}</div>
      </StudyState>
    </div>
  );
}
