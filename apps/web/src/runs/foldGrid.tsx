/**
 * Every scoreboard metric as a readout, the way a system monitor shows CPU
 * or memory: the run's number large, what it means in one line, and a thin
 * trace of how it moved fold by fold. No bars, no baseline to beat; the
 * verdicts and tiles above already do the judging. Reads the run view only.
 */
import { useState } from "react";

import { CYCLE_METRIC_NAMES, type CycleMetricName } from "@shared/cycle/schema";
import type { RunFoldRow } from "@shared/runs/types";
import { Chip } from "@/runs/learning";
import { howComputed } from "@/runs/howComputed";

type Family = "trading" | "prediction" | "price";

interface MetricSpec {
  label: string;
  family: Family;
  /** What the number is, in plain words. */
  meaning: string;
  format: (value: number) => string;
}

const usd = (value: number) => `${value < 0 ? "-" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const ratio = (value: number) => value.toFixed(2);
const fraction = (value: number) => `${(value * 100).toFixed(1)}%`;
const count = (value: number) => Math.round(value).toLocaleString("en-US");
const points = (value: number) => `${value.toFixed(2)} pts`;
const loss = (value: number) => value.toFixed(4);

const SPECS: Record<CycleMetricName, MetricSpec> = {
  net_profit_usd: { label: "Net profit", family: "trading", meaning: "Money made over every test window after costs.", format: usd },
  sharpe_ratio: { label: "Sharpe ratio", family: "trading", meaning: "Return per unit of its own wobble, annualised.", format: ratio },
  sortino_ratio: { label: "Sortino ratio", family: "trading", meaning: "Like Sharpe, but only the down moves count as wobble.", format: ratio },
  calmar_ratio: { label: "Calmar ratio", family: "trading", meaning: "Annual return divided by the worst drawdown.", format: ratio },
  maximum_drawdown_usd: { label: "Worst drawdown", family: "trading", meaning: "The deepest fall from a running high in the equity curve.", format: usd },
  profit_factor: { label: "Profit factor", family: "trading", meaning: "Gross profit divided by gross loss.", format: ratio },
  win_rate: { label: "Win rate", family: "trading", meaning: "Share of closed trades that made money.", format: fraction },
  trade_count: { label: "Closed trades", family: "trading", meaning: "Trades opened and closed across the test windows.", format: count },
  average_trade_usd: { label: "Average trade", family: "trading", meaning: "Net profit divided by the number of trades.", format: usd },
  expectancy_usd: { label: "Expectancy", family: "trading", meaning: "What the next trade is worth on average.", format: usd },
  exposure_fraction: { label: "Time in market", family: "trading", meaning: "Share of test bars with a position on.", format: fraction },
  gross_profit_usd: { label: "Gross profit", family: "trading", meaning: "The winning trades added up, before costs.", format: usd },
  gross_loss_usd: { label: "Gross loss", family: "trading", meaning: "The losing trades added up, before costs.", format: usd },
  total_cost_usd: { label: "Costs paid", family: "trading", meaning: "Commission, exchange fees and slippage charged.", format: usd },
  accuracy: { label: "Accuracy", family: "prediction", meaning: "Share of scored bars whose direction it called right.", format: fraction },
  balanced_accuracy: { label: "Balanced accuracy", family: "prediction", meaning: "Accuracy on up bars and on down bars, averaged.", format: fraction },
  precision: { label: "Precision of up calls", family: "prediction", meaning: "When it said up, how often the bar went up.", format: fraction },
  recall: { label: "Recall of up bars", family: "prediction", meaning: "Of the bars that went up, how many it called up.", format: fraction },
  f1_score: { label: "F1 of up calls", family: "prediction", meaning: "Precision and recall of the up call in one number.", format: ratio },
  macro_f1_score: { label: "Macro F1", family: "prediction", meaning: "F1 of the up call and of the down call, averaged.", format: ratio },
  roc_auc: { label: "ROC AUC", family: "prediction", meaning: "How well its probabilities rank up bars above down bars.", format: (value) => value.toFixed(3) },
  log_loss: { label: "Log loss", family: "prediction", meaning: "How wrong its probabilities are; confident mistakes cost most.", format: loss },
  brier_score: { label: "Brier score", family: "prediction", meaning: "Mean squared gap between its probability and what happened.", format: loss },
  majority_class_accuracy: { label: "Common-direction accuracy", family: "prediction", meaning: "What always calling the more frequent direction would score.", format: fraction },
  buy_and_hold_net_profit_usd: { label: "Buy and hold", family: "trading", meaning: "What one contract held through the test windows would have made.", format: usd },
  price_forecast_mean_absolute_error_points: { label: "Price forecast MAE", family: "price", meaning: "Average size of the price model's miss.", format: points },
  persistence_mean_absolute_error_points: { label: "Copy-the-last-close MAE", family: "price", meaning: "The miss from forecasting no change at all.", format: points },
  price_forecast_skill: { label: "Price forecast skill", family: "price", meaning: "How much better than copying the last close; 0 is no better.", format: (value) => value.toFixed(3) },
  price_forecast_root_mean_square_error_points: { label: "Price forecast RMSE", family: "price", meaning: "The miss with big errors weighing more.", format: points },
  price_forecast_direction_accuracy: { label: "Price forecast sign accuracy", family: "price", meaning: "How often the price model's move had the right sign.", format: fraction },
};

const FAMILY_LABELS: Record<Family, string> = { trading: "Trading", prediction: "Prediction", price: "Price model" };
const TRACE = "#56B4E9";

/** A thin line through the metric's value in each fold, in fold order. */
function Trace({ values }: { values: (number | null)[] }) {
  const known = values.map((value, index) => ({ value, index })).filter((entry): entry is { value: number; index: number } => entry.value !== null && Number.isFinite(entry.value));
  if (known.length < 2) return <div className="h-7" />;
  const width = 120;
  const height = 28;
  const min = Math.min(...known.map((entry) => entry.value));
  const max = Math.max(...known.map((entry) => entry.value));
  const span = max - min || 1;
  const x = (index: number) => 3 + (index / Math.max(1, values.length - 1)) * (width - 6);
  const y = (value: number) => height - 3 - ((value - min) / span) * (height - 6);
  const path = known.map((entry, position) => `${position === 0 ? "M" : "L"}${x(entry.index).toFixed(1)} ${y(entry.value).toFixed(1)}`).join(" ");
  const last = known[known.length - 1]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-full" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke={TRACE} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {known.map((entry) => (
        <circle key={entry.index} cx={x(entry.index)} cy={y(entry.value)} r={1.8} fill={TRACE} />
      ))}
      <circle cx={x(last.index)} cy={y(last.value)} r={2.6} fill="#E69F00" />
    </svg>
  );
}

function Readout({ name, value, folds }: { name: CycleMetricName; value: number | null; folds: RunFoldRow[] }) {
  const spec = SPECS[name];
  const perFold = folds.map((fold) => fold.metrics[name] ?? null);
  return (
    <div className="rounded border border-border bg-card/60 px-2 py-1.5" data-testid={`metric-readout-${name}`} title={howComputed(name, spec.label)}>
      <div className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{spec.label}</div>
      <div className="font-mono text-[18px] font-semibold tabular-nums leading-tight text-foreground">{value === null ? "—" : spec.format(value)}</div>
      <div className="truncate text-[10px] leading-snug text-muted-foreground">{spec.meaning}</div>
      <Trace values={perFold} />
      <div className="flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>fold 1</span>
        <span>{folds.length > 1 ? `fold ${folds.length}` : ""}</span>
      </div>
    </div>
  );
}

/** Every metric the run scored, each a readout with its fold-by-fold trace. */
export function MetricReadouts({ metrics, folds }: { metrics: Record<string, number | null>; folds: RunFoldRow[] }) {
  const [family, setFamily] = useState<Family | "all">("all");
  const present = CYCLE_METRIC_NAMES.filter((name) => (metrics[name] !== null && metrics[name] !== undefined) || folds.some((fold) => fold.metrics[name] != null));
  const families = (["trading", "prediction", "price"] as Family[]).filter((entry) => present.some((name) => SPECS[name].family === entry));
  const shown = present.filter((name) => family === "all" || SPECS[name].family === family);
  return (
    <div className="space-y-2" data-testid="metric-readouts">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] text-muted-foreground">
          Every one of the {present.length} metrics the run scored, as a readout: the run's number, what it means, and the thin line of its value in each fold (orange dot: the latest fold). Hover any readout for exactly how the engine computes it.
        </span>
        <Chip active={family === "all"} onClick={() => setFamily("all")}>All</Chip>
        {families.map((entry) => (
          <Chip key={entry} active={family === entry} onClick={() => setFamily(entry)}>{FAMILY_LABELS[entry]}</Chip>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="rounded-md border border-border bg-card/60 p-3 text-[11px] text-muted-foreground">Metrics land as the first fold finishes.</div>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {shown.map((name) => (
            <Readout key={name} name={name} value={metrics[name] ?? null} folds={folds} />
          ))}
        </div>
      )}
    </div>
  );
}
