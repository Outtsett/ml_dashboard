/**
 * Walk-forward out-of-sample results of the quantlab MNQ transformer: the
 * per-fold table and pictures, the fold-level distribution, conviction gating
 * and the break-even calculator. The tables are six and thirty rows, so the
 * server sends all of them and every control recomputes in the browser.
 */

import { ColumnGrid, Finding, Section, Stat, StudyNotes, StudyState, fmt, fmtInt, useStudyControls, useStudyQuery, OKABE } from "@/studies/kit";
import { headlineCounts } from "@shared/studies/quant-oos-results";
import type { OosResultsBody } from "@shared/studies/quant-oos-results";
import { BreakEvenSection } from "./BreakEvenSection";
import { ConvictionSection } from "./ConvictionSection";
import { DistributionSection } from "./DistributionSection";
import { FoldSection } from "./FoldSection";

const DEFAULT_COST_POINTS = 1.40055;
const DEFAULT_INDEX_LEVEL = 19808;

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    costPoints: DEFAULT_COST_POINTS,
    indexLevel: DEFAULT_INDEX_LEVEL,
    foldColumn: "out_of_sample_r_squared",
    distributionMetric: "out_of_sample_r_squared",
    distributionStep: 6,
    perFold: false,
  });
  const query = useStudyQuery<OosResultsBody>("quant-oos-results");
  const body = query.data?.data;
  const folds = body?.folds ?? [];
  const summary = body?.summary ?? null;
  const counts = headlineCounts(folds);
  const loaded = folds.length > 0 && summary !== null;

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!loaded ? (
          <p className="text-xs text-neutral-400">
            No walk-forward results in the lake yet. Land them with{" "}
            <code className="font-mono">Trading/quant/.venv/Scripts/python.exe packages/ml-engine/src/studies/quant_oos_results/build.py</code>, then refresh the derived views.
          </p>
        ) : (
          <>
            <Section
              title="Six folds over MNQ 1-minute bars"
              question={`${summary.first_timestamp.slice(0, 10)} to ${summary.last_timestamp.slice(0, 10)}. Each fold trains a model from scratch and scores it on bars it never saw, with ${summary.purge_windows} windows purged at every boundary.`}
              aside={
                <button type="button" onClick={reset} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200">
                  Reset controls
                </button>
              }
            >
              <div className="space-y-2">
                <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                  <Stat
                    label="Folds with positive out-of-sample R²"
                    value={`${counts.positiveRSquared} / ${counts.foldCount}`}
                    tone={counts.positiveRSquared > 0 ? OKABE.orange : OKABE.blue}
                    hint="R² against predicting zero"
                  />
                  <Stat
                    label="Folds with directional accuracy above 0.50"
                    value={`${counts.accuracyAboveHalf} / ${counts.foldCount}`}
                    tone={counts.accuracyAboveHalf > 0 ? OKABE.orange : OKABE.blue}
                  />
                  <Stat label="Total out-of-sample windows" value={fmtInt(counts.totalWindows)} hint="sum of test_window_count over the folds" />
                  <Stat
                    label="Pooled directional accuracy"
                    value={fmt(summary.pooled_directional_accuracy, 4)}
                    hint={`fold-mean 95% bootstrap interval ${fmt(summary.fold_directional_ci_lower, 4)} to ${fmt(summary.fold_directional_ci_upper, 4)}`}
                  />
                </div>
                <Finding>
                  A model that forecasts nothing would land near R² = 0 and accuracy = 0.50. The line to beat is predicting zero; on this series copying the last return is the weaker baseline.
                  Pooled over {fmtInt(summary.total_test_windows)} windows the out-of-sample R² is {fmt(summary.pooled_out_of_sample_r_squared, 5)} and the information coefficient {fmt(summary.pooled_information_coefficient, 4)}.
                  Fold times are the lake&apos;s futures stamps: Pacific wall-clock time stored as UTC.
                </Finding>
              </div>
            </Section>

            <FoldSection folds={folds} column={controls.foldColumn} onColumn={(value) => set("foldColumn", value)} />

            <DistributionSection
              folds={folds}
              metric={controls.distributionMetric}
              step={controls.distributionStep}
              onMetric={(value) => set("distributionMetric", value)}
              onStep={(value) => set("distributionStep", value)}
            />

            <ConvictionSection conviction={body?.conviction ?? []} byFold={body?.convictionByFold ?? []} perFold={controls.perFold} onPerFold={(value) => set("perFold", value)} />

            <BreakEvenSection
              summary={summary}
              folds={folds}
              foldTargets={body?.foldTargets ?? []}
              pointValueUsd={body?.pointValueUsd ?? 2}
              defaultIndexLevel={DEFAULT_INDEX_LEVEL}
              costPoints={controls.costPoints}
              indexLevel={controls.indexLevel}
              onCostPoints={(value) => set("costPoints", value)}
              onIndexLevel={(value) => set("indexLevel", value)}
            />

            <Section title="E. Every column, seen" question="Each numeric column of the fold table and of the conviction table as its own histogram with its eight numbers. Six folds make coarse histograms; the point is that no column is summarised unseen.">
              <div className="space-y-4">
                <ColumnGrid rows={folds} exclude={["fold_index"]} title="Fold table, one panel per column (6 folds)" />
                <ColumnGrid rows={body?.convictionByFold ?? []} exclude={["fold_index"]} title="Conviction table by fold, one panel per column (30 rows)" />
                <Finding>The panels use the sample (bias-corrected) skewness and kurtosis of the dashboard&apos;s common statistics; section B uses the notebook&apos;s population-moment definition, so its skewness and kurtosis differ slightly at n = 6.</Finding>
              </div>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
