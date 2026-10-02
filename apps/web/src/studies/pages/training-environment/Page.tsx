/**
 * Training environment: everything a multimodal direction run knows while it
 * runs. One run at a time (the control), six sections in the notebook's order.
 * The numbers are the run's record as landed in the lake
 * (packages/ml-engine/src/studies/training_environment/build.py): re-landing while a run is in
 * progress puts its newest events in front of this page, and the live-refresh
 * control re-reads the lake on an interval.
 */

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SelectControl, Stat, StudyNotes, StudyState, TOOLTIP, fmt, fmtInt, fmtTime, useStudyControls,
} from "@/studies/kit";
import { resolvedLabels, skillOverMajority, type BarsBody, type OverviewBody, type TrainingRunRow } from "@shared/studies/training-environment";
import { BlocksSection } from "./BlocksSection";
import { DataSection } from "./DataSection";
import { LearningSection } from "./LearningSection";
import { NetworkSection } from "./NetworkSection";
import { RepresentationSection } from "./RepresentationSection";
import { StreamTable } from "./StreamTable";
import { TokenSection } from "./TokenSection";
import { DEFAULT_CONTROLS, LIVE_OPTIONS, usePart } from "./shared";

function stateOf(run: TrainingRunRow): string {
  if (run.status === "finished") return "finished";
  if (run.status === "running") return `running — epoch ${run.latest_epoch ?? "?"}/${run.epochs_configured}`;
  return "starting";
}

function RunsTable({ runs, selected, onSelect }: { runs: readonly TrainingRunRow[]; selected: string | null; onSelect: (name: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[11px] font-mono tnum">
        <thead>
          <tr className="text-neutral-500">
            {["run_name", "status", "timeframe", "resolved_labels", "epochs_seen", "best_direction_accuracy", "majority_baseline_accuracy", "skill", "stream_modified"].map((name) => (
              <th key={name} className="py-0.5 pr-3 text-left font-normal">{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.run_name} className={`cursor-pointer border-t border-neutral-900 text-neutral-200 hover:bg-neutral-900 ${run.run_name === selected ? "bg-neutral-900" : ""}`} onClick={() => onSelect(run.run_name)}>
              <td className="py-0.5 pr-2">{run.run_name === selected ? "▶ " : ""}{run.run_name}</td>
              <td className="pr-2">{run.status}</td>
              <td className="pr-2">{run.symbol} {run.timeframe}</td>
              <td className="pr-2">{fmtInt(resolvedLabels(run))}</td>
              <td className="pr-2">{run.epochs_seen}/{run.epochs_configured}</td>
              <td className="pr-2">{fmt(run.best_direction_accuracy, 4)}</td>
              <td className="pr-2">{fmt(run.majority_baseline_accuracy, 4)}</td>
              <td className="pr-2">{run.skill === null ? "—" : `${run.skill >= 0 ? "▲ +" : "▼ "}${run.skill.toFixed(4)}`}</td>
              <td className="pr-2">{fmtTime(run.stream_modified_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls(DEFAULT_CONTROLS);
  const overviewQuery = usePart<OverviewBody>("overview", controls);
  const barsQuery = usePart<BarsBody>("bars", controls);
  const overview = overviewQuery.data?.data;
  const bars = barsQuery.data?.data.bars ?? [];
  const runs = overview?.runs ?? [];
  const run = runs.find((row) => row.run_name === overview?.run) ?? null;

  const labelBalance = run
    ? [
        { label: "up first (resolved)", count: run.up_label_count, colour: OKABE.orange },
        { label: "down first (resolved)", count: run.down_label_count, colour: OKABE.blue },
        { label: "unresolved", count: run.unresolved_label_count, colour: OKABE.grey },
      ]
    : [];

  return (
    <div className="space-y-3">
      <StudyState isLoading={overviewQuery.isLoading} error={overviewQuery.error}>
        <StudyNotes notes={overviewQuery.data?.notes ?? []} />
        <ControlBar onReset={reset}>
          <SelectControl label="Run" value={overview?.run ?? ""} options={runs.map((row) => ({ value: row.run_name, label: `${row.run_name} (${row.status})` }))} onChange={(value) => { set("run", value); set("firstBar", -1); set("lastBar", -1); set("block", ""); set("statisticFeature", ""); set("termIndex", 0); set("embeddingEpoch", 0); set("layerEpoch", 0); set("activationLayer", ""); set("streamPage", 1); }} />
          <SelectControl label="Live refresh" value={LIVE_OPTIONS.some((option) => option.value === controls.live) ? (controls.live as "off") : "off"} options={LIVE_OPTIONS} onChange={(value) => set("live", value)} hint="Re-read the lake on this interval. A run in progress reaches the lake when its record is re-landed (packages/ml-engine/src/studies/training_environment/build.py)." />
        </ControlBar>

        {!run ? (
          <Section title="No run landed" question="This page reads the record a training run writes to model/data/training_runs/<run>/.">
            <Finding>
              Start one with <code>scripts/train_multimodal_direction.py --timeframe 5m --epochs 15</code> from the quant workspace (or the Model Lens start button), then land its record with{" "}
              <code>E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/training_environment/build.py</code>.
            </Finding>
          </Section>
        ) : (
          <>
            <Section title="The run" question="State, configuration and label balance.">
              <div className="space-y-3">
                <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                  <Stat label="State" value={stateOf(run)} />
                  <Stat label="Symbol / timeframe" value={`${run.symbol} ${run.timeframe}`} />
                  <Stat label="Window / horizon" value={`${run.window_bars} bars → ${run.horizon_bars} ahead`} />
                  <Stat label="Barrier" value={`±${run.barrier_points} points`} />
                  <Stat label="Labelled bars" value={fmtInt(resolvedLabels(run))} hint={`up ${fmtInt(run.up_label_count)} / down ${fmtInt(run.down_label_count)} · ${fmtInt(run.unresolved_label_count)} unresolved`} />
                  <Stat label="Epochs seen" value={`${run.epochs_seen} of ${run.epochs_configured}`} />
                  <Stat label="Batches streamed" value={fmtInt(run.batches_streamed)} hint="every eighth batch" />
                  <Stat
                    label="Direction accuracy vs baseline"
                    value={run.best_direction_accuracy === null ? "—" : `${fmt(run.best_direction_accuracy, 4)} vs ${fmt(run.majority_baseline_accuracy, 4)}`}
                    tone={run.skill !== null && run.skill > 0 ? OKABE.orange : OKABE.blue}
                    hint={run.skill === null ? undefined : `skill ${run.skill >= 0 ? "▲ +" : "▼ "}${run.skill.toFixed(4)}`}
                  />
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="min-w-0">
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={labelBalance} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                        <CartesianGrid {...GRID} horizontal={false} />
                        <XAxis type="number" {...AXIS} />
                        <YAxis type="category" dataKey="label" width={130} {...AXIS} />
                        <Tooltip {...TOOLTIP} formatter={(value: number) => [fmtInt(value), "bars"]} />
                        <Bar dataKey="count" isAnimationActive={false} label={{ position: "right", fontSize: 10, fill: "#d4d4d4", formatter: (value: number) => fmtInt(value) }}>
                          {labelBalance.map((row) => (
                            <Cell key={row.label} fill={row.colour} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <FormulaCard
                    tex={String.raw`N_{\text{labelled}}=N_{\uparrow}+N_{\downarrow}`}
                    caption="A bar is labelled when a barrier is touched inside the horizon."
                    symbols={[
                      { tex: "N_{\\uparrow}", name: "bars whose upper barrier was touched first", value: fmtInt(run.up_label_count) },
                      { tex: "N_{\\downarrow}", name: "bars whose lower barrier was touched first", value: fmtInt(run.down_label_count) },
                      { tex: "N_{\\text{unresolved}}", name: "bars where neither was touched inside the horizon (not trained on)", value: fmtInt(run.unresolved_label_count) },
                      { tex: "N_{\\text{labelled}}", name: "the bars the model learns from", value: fmtInt(resolvedLabels(run)) },
                      { tex: "\\text{skill}", name: "best accuracy minus the majority baseline", value: run.best_direction_accuracy === null || run.majority_baseline_accuracy === null ? "—" : skillOverMajority(run.best_direction_accuracy, run.majority_baseline_accuracy).toFixed(4) },
                    ]}
                  />
                </div>
                {runs.length > 1 && <RunsTable runs={runs} selected={run.run_name} onSelect={(name) => set("run", name)} />}
                <p className="text-[10px] text-neutral-500">
                  Record landed {fmtTime(run.landed_at_ms)} UTC from a {run.snapshot_format ?? "—"} run directory; {fmtInt(run.parameter_count)} parameters, learning rate {run.learning_rate}, batch {run.batch_size}, train fraction {run.train_fraction}, modality dropout {run.modality_dropout}.
                </p>
              </div>
            </Section>

            <DataSection bars={bars} controls={controls} set={set} />
            <BlocksSection catalogue={overview?.blocks ?? []} barCount={bars.length} controls={controls} set={set} />
            <TokenSection norms={overview?.blockNorms ?? []} run={run} />
            <RepresentationSection epochs={overview?.embeddingEpochs ?? []} controls={controls} set={set} />
            <NetworkSection layers={overview?.layers ?? []} controls={controls} set={set} />
            <LearningSection epochs={overview?.epochs ?? []} batches={overview?.batches ?? []} run={run} />
            <StreamTable events={overview?.events ?? []} controls={controls} set={set} />
          </>
        )}
      </StudyState>
    </div>
  );
}
