/**
 * The Model Cycle "Metrics" tab: the run's in-depth metric tables, built by
 * src/ml/cycle/report.py from the run's own record and read from the lake
 * (`useCycleReport`).
 *
 * Think of it as the run's tear sheet. The two big tables put every model
 * metric and every trading metric down the side with the whole run and each fold
 * across, so a fold that carried or sank the run shows at a glance; the rest
 * look at one scope at a time (picked above them): calibration and the
 * confusion matrix, accuracy by how sure the model was, trades by side / exit
 * reason / entry confidence, the eight-number spread of every quantity, the
 * deepest drawdowns and each session day. Hover any number for what it is,
 * how it is computed, what it rests on and — when it is undefined — why.
 */
import { useState, type ReactNode } from "react";

import { isCycleActive, useCycleStore } from "@/cycle/store";
import { cn } from "@/shared/utils/utils";

import { foldLabel } from "./format";
import {
  CalibrationTable,
  ConfusionTable,
  DailyTable,
  DistributionTable,
  DrawdownTable,
  MetricMatrix,
  SESSION_NOTE,
  SegmentTable,
  type Scope,
} from "./tables";
import { useCycleReport } from "./useReport";

const CONFIDENCE_METRICS = ["scored_bar_count", "accuracy", "balanced_accuracy", "log_loss", "brier_score", "actual_up_fraction"] as const;
const TRADE_SEGMENT_METRICS = [
  "trade_count", "win_rate", "profit_factor", "payoff_ratio", "expectancy_usd", "average_trade_usd", "trade_net_profit_usd",
  "largest_win_usd", "largest_loss_usd", "average_bars_held", "total_cost_usd",
] as const;
const TRADE_SEGMENTS = [
  { kind: "side", label: "Side" },
  { kind: "exit_reason", label: "Exit reason" },
  { kind: "entry_confidence", label: "Entry confidence" },
] as const;

function Section({ title, note, children, testId }: { title: string; note?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-1 rounded-md border border-white/10 bg-card/40 p-2" data-testid={testId}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-300">{title}</h3>
      {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}

function Toggle<T extends string | number | null>({ options, value, onChange, label, testId }: {
  options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void; label: string; testId: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1" data-testid={testId}>
      <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded border px-2 py-0.5 text-[11px]",
            option.value === value ? "border-[#56B4E9] bg-[#56B4E9]/15 text-neutral-100" : "border-white/10 text-neutral-400 hover:text-neutral-200",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function CycleReportPanel() {
  const modelId = useCycleStore((state) => state.modelId);
  const status = useCycleStore((state) => state.status);
  const foldsScored = useCycleStore((state) => state.folds.length);
  const live = isCycleActive(status);
  const query = useCycleReport(modelId, `${status}:${foldsScored}`, live);
  const [foldIndex, setFoldIndex] = useState<number | null>(null);
  const [segmentKind, setSegmentKind] = useState<string>("side");

  if (!modelId) return <p className="p-3 text-[12px] text-muted-foreground">Open a run or press Play: the metric tables are built from a run's record.</p>;
  if (query.isLoading) return <p className="p-3 text-[12px] text-muted-foreground">Reading the metric tables from the lake…</p>;
  if (query.isError) return <p className="p-3 text-[12px] text-[#D55E00]">The metric tables could not be read: {String(query.error)}</p>;
  const report = query.data;
  if (!report) {
    return (
      <p className="p-3 text-[12px] text-muted-foreground" data-testid="report-empty">
        {live ? "The metric tables land with the record at the end of the first fold." : "This run has no metric tables in the lake yet."}
      </p>
    );
  }

  const folds = [...new Set(report.tradingMetrics.filter((row) => row.scope === "fold").map((row) => row.foldIndex as number))].sort((a, b) => a - b);
  const current: number | null = foldIndex !== null && folds.includes(foldIndex) ? foldIndex : null;
  const scope: Scope = current === null ? { scope: "run", foldIndex: null } : { scope: "fold", foldIndex: current };
  const scopeOptions = [{ value: null as number | null, label: "Run" }, ...folds.map((fold) => ({ value: fold as number | null, label: foldLabel(fold) }))];

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-auto pb-4" data-testid="cycle-report">
      <p className="text-[10px] text-muted-foreground">
        Built from the run&apos;s own record ({report.modelId}); the thirty scoreboard numbers are the engine&apos;s exactly.
        Hover any number for its definition, formula, sample and, when it shows “—”, why it is undefined.
        {live && " Live: refreshed at every fold end."}
      </p>

      <Section title="Model metrics" note="Classification, probability quality, calibration, baselines and the price forecast — the whole run and every fold." testId="report-model-section">
        <MetricMatrix rows={report.modelMetrics} testId="report-model" />
      </Section>

      <Section title="Trading metrics" note="Returns, risk-adjusted ratios, drawdowns, trades, exposure, costs and buy and hold — the whole run and every fold." testId="report-trading-section">
        <MetricMatrix rows={report.tradingMetrics} testId="report-trading" />
      </Section>

      <div className="sticky top-0 z-20 rounded-md border border-white/10 bg-card/95 px-2 py-1.5">
        <Toggle label="Scope of the tables below" options={scopeOptions} value={current} onChange={setFoldIndex} testId="report-scope" />
      </div>

      <Section title={`Calls and calibration · ${foldLabel(current)}`} note="How the scored bars were called, and whether a P(up) of 0.7 went up 70% of the time.">
        <div className="flex flex-wrap items-start gap-4">
          <ConfusionTable cells={report.confusionMatrix} scope={scope} />
          <div className="min-w-[24rem] flex-1"><CalibrationTable bins={report.calibrationBins} scope={scope} /></div>
        </div>
      </Section>

      <Section title={`Accuracy by confidence · ${foldLabel(current)}`} note="Scored bars grouped by how far P(up) sat from 0.5: a model that knows when it knows is more accurate further out.">
        <SegmentTable rows={report.modelMetrics} scope={scope} kind="confidence" names={CONFIDENCE_METRICS} testId="report-confidence" />
      </Section>

      <Section title={`Trades by segment · ${foldLabel(current)}`}>
        <Toggle
          label="Split by"
          options={TRADE_SEGMENTS.map((segment) => ({ value: segment.kind as string, label: segment.label }))}
          value={segmentKind}
          onChange={setSegmentKind}
          testId="report-segment-kind"
        />
        <SegmentTable rows={report.tradingMetrics} scope={scope} kind={segmentKind} names={TRADE_SEGMENT_METRICS} testId="report-segments" />
      </Section>

      <Section title={`Distributions · ${foldLabel(current)}`} note="The eight numbers of every per-trade, per-bar and per-day quantity, with its shape.">
        <DistributionTable rows={report.distributions} scope={scope} />
      </Section>

      <Section title={`Drawdowns · ${foldLabel(current)}`}>
        <DrawdownTable rows={report.drawdowns} scope={scope} />
      </Section>

      <Section title="Session days · run" note={SESSION_NOTE}>
        <DailyTable rows={report.dailyResults} />
      </Section>
    </div>
  );
}
