/**
 * Every scoreboard metric, one small bar chart each, one bar per fold: nothing
 * the run scored is summarised without being seen. Reads the run view's fold
 * rows; nothing here fetches.
 */
import { useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CYCLE_METRIC_NAMES, type CycleMetricName } from "@shared/cycle/schema";
import type { RunFoldRow } from "@shared/runs/types";
import { COIN_FLIP_BRIER_SCORE, COIN_FLIP_LOG_LOSS } from "@shared/runs/verdicts";
import { Chip } from "@/runs/learning";

const AXIS = { fontSize: 9, fill: "hsl(var(--muted-foreground))", fontFamily: "ui-monospace, monospace" } as const;
const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  fontSize: 11,
  fontFamily: "ui-monospace, monospace",
} as const;
const POSITIVE = "#E69F00";
const NEGATIVE = "#0072B2";
const NEUTRAL = "#56B4E9";

type Family = "trading" | "prediction" | "price";

interface MetricSpec {
  label: string;
  family: Family;
  /** The line a value is judged against; `null` draws plain bars in one colour. */
  zero: number | null;
  /** Below the line is the good side (a loss, a cost, a drawdown). */
  lowerIsBetter?: boolean;
  format: (value: number) => string;
}

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const ratio = (value: number) => value.toFixed(2);
const fraction = (value: number) => `${(value * 100).toFixed(1)}%`;
const count = (value: number) => Math.round(value).toLocaleString("en-US");
const points = (value: number) => value.toFixed(2);

const SPECS: Record<CycleMetricName, MetricSpec> = {
  net_profit_usd: { label: "Net profit", family: "trading", zero: 0, format: usd },
  sharpe_ratio: { label: "Sharpe ratio", family: "trading", zero: 0, format: ratio },
  sortino_ratio: { label: "Sortino ratio", family: "trading", zero: 0, format: ratio },
  calmar_ratio: { label: "Calmar ratio", family: "trading", zero: 0, format: ratio },
  maximum_drawdown_usd: { label: "Worst drawdown", family: "trading", zero: null, format: usd },
  profit_factor: { label: "Profit factor", family: "trading", zero: 1, format: ratio },
  win_rate: { label: "Win rate", family: "trading", zero: 0.5, format: fraction },
  trade_count: { label: "Closed trades", family: "trading", zero: null, format: count },
  average_trade_usd: { label: "Average trade", family: "trading", zero: 0, format: usd },
  expectancy_usd: { label: "Expectancy per trade", family: "trading", zero: 0, format: usd },
  exposure_fraction: { label: "Time in market", family: "trading", zero: null, format: fraction },
  gross_profit_usd: { label: "Gross profit", family: "trading", zero: null, format: usd },
  gross_loss_usd: { label: "Gross loss", family: "trading", zero: null, format: usd },
  total_cost_usd: { label: "Costs paid", family: "trading", zero: null, format: usd },
  accuracy: { label: "Accuracy", family: "prediction", zero: 0.5, format: fraction },
  balanced_accuracy: { label: "Balanced accuracy", family: "prediction", zero: 0.5, format: fraction },
  precision: { label: "Precision of up calls", family: "prediction", zero: 0.5, format: fraction },
  recall: { label: "Recall of up bars", family: "prediction", zero: 0.5, format: fraction },
  f1_score: { label: "F1 of up calls", family: "prediction", zero: 0.5, format: ratio },
  macro_f1_score: { label: "Macro F1", family: "prediction", zero: 0.5, format: ratio },
  roc_auc: { label: "ROC AUC", family: "prediction", zero: 0.5, format: (value) => value.toFixed(3) },
  log_loss: { label: "Log loss", family: "prediction", zero: COIN_FLIP_LOG_LOSS, lowerIsBetter: true, format: (value) => value.toFixed(4) },
  brier_score: { label: "Brier score", family: "prediction", zero: COIN_FLIP_BRIER_SCORE, lowerIsBetter: true, format: (value) => value.toFixed(4) },
  majority_class_accuracy: { label: "Always-the-common-direction accuracy", family: "prediction", zero: null, format: fraction },
  buy_and_hold_net_profit_usd: { label: "Buy and hold net profit", family: "trading", zero: 0, format: usd },
  price_forecast_mean_absolute_error_points: { label: "Price forecast MAE", family: "price", zero: null, format: points },
  persistence_mean_absolute_error_points: { label: "Copy-the-last-close MAE", family: "price", zero: null, format: points },
  price_forecast_skill: { label: "Price forecast skill", family: "price", zero: 0, format: (value) => value.toFixed(3) },
  price_forecast_root_mean_square_error_points: { label: "Price forecast RMSE", family: "price", zero: null, format: points },
  price_forecast_direction_accuracy: { label: "Price forecast sign accuracy", family: "price", zero: 0.5, format: fraction },
};

const FAMILY_LABELS: Record<Family, string> = { trading: "Trading", prediction: "Prediction", price: "Price model" };

function Mini({ name, folds }: { name: CycleMetricName; folds: RunFoldRow[] }) {
  const spec = SPECS[name];
  const rows = folds.map((fold) => ({ fold: `F${fold.foldIndex + 1}`, value: fold.metrics[name] ?? null }));
  const good = (value: number) => (spec.zero === null ? true : spec.lowerIsBetter ? value <= spec.zero : value >= spec.zero);
  const values = rows.map((row) => row.value).filter((value): value is number => value !== null);
  const summary = values.length === 0 ? "—" : values.length === 1 ? spec.format(values[0]!) : `${spec.format(Math.min(...values))} to ${spec.format(Math.max(...values))}`;
  return (
    <div className="rounded border border-border bg-card/60 p-1.5" data-testid={`fold-metric-${name}`}>
      <div className="flex items-baseline justify-between gap-1">
        <span className="truncate text-[10px] font-semibold text-foreground" title={spec.label}>{spec.label}</span>
        <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">{summary}</span>
      </div>
      <div className="h-20">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
            <XAxis dataKey="fold" tick={AXIS} interval={0} />
            <YAxis
              tick={AXIS}
              width={44}
              tickFormatter={spec.format}
              domain={spec.zero === null || spec.zero === 0 ? ["auto", "auto"] : [(min: number) => Math.min(min, spec.zero! - 0.02), (max: number) => Math.max(max, spec.zero! + 0.02)]}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => spec.format(value)} />
            {spec.zero !== null && <ReferenceLine y={spec.zero} stroke="#808A99" />}
            <Bar dataKey="value" name={spec.label} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={row.fold} fill={spec.zero === null ? NEUTRAL : row.value !== null && good(row.value) ? POSITIVE : NEGATIVE} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Every metric the folds scored, one small chart each. */
export function FoldMetricsGrid({ folds }: { folds: RunFoldRow[] }) {
  const [family, setFamily] = useState<Family | "all">("all");
  const present = CYCLE_METRIC_NAMES.filter((name) => folds.some((fold) => fold.metrics[name] !== null && fold.metrics[name] !== undefined));
  const families = (["trading", "prediction", "price"] as Family[]).filter((entry) => present.some((name) => SPECS[name].family === entry));
  const shown = present.filter((name) => family === "all" || SPECS[name].family === family);
  return (
    <div className="space-y-2" data-testid="fold-metrics-grid">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] text-muted-foreground">
          Every one of the {present.length} metrics the folds scored, one chart each, one bar per fold. Orange is on the good side of the grey line, blue the bad side; sky blue has no line to judge against.
        </span>
        <Chip active={family === "all"} onClick={() => setFamily("all")}>All</Chip>
        {families.map((entry) => (
          <Chip key={entry} active={family === entry} onClick={() => setFamily(entry)}>{FAMILY_LABELS[entry]}</Chip>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="rounded-md border border-border bg-card/60 p-3 text-[11px] text-muted-foreground">Fold results land as each fold finishes.</div>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {shown.map((name) => (
            <Mini key={name} name={name} folds={folds} />
          ))}
        </div>
      )}
    </div>
  );
}
