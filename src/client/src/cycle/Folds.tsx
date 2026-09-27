/**
 * CycleFolds — one row per planned fold (`plan.folds`), joined with that
 * fold's finished scoreboard (`store.folds`, scope "fold") and, for the fold
 * currently under test, the running scoreboard labelled "live".
 */
import { useMemo, type ReactNode } from "react";

import { useCycleStore } from "@/cycle/store";
import { formatCount, formatDate, formatPercent, formatRatio, formatUsd } from "@/cycle/format";
import type { CycleFoldPlan, CycleParameters, CyclePhase, CycleScoreboard } from "@shared/cycle/schema";
import { cn } from "@/shared/utils/utils";

type FoldStatus = "pending" | "tuning" | "training" | "validating" | "testing" | "done";

const STATUS_COLOR: Record<FoldStatus, string> = {
  pending: "#8A8F98",
  tuning: "#CC79A7",
  training: "#56B4E9",
  validating: "#F0E442",
  testing: "#0072B2",
  done: "#009E73",
};

const STATUS_GLYPH: Record<FoldStatus, string> = {
  pending: "○",
  tuning: "◔",
  training: "◑",
  validating: "◑",
  testing: "◕",
  done: "●",
};

function statusForFold(foldIndex: number, hasFinished: boolean, cursorPhase: CyclePhase | null, cursorFoldIndex: number | null): FoldStatus {
  if (hasFinished) return "done";
  if (cursorFoldIndex === foldIndex && cursorPhase && ["tuning", "training", "validating", "testing"].includes(cursorPhase)) {
    return cursorPhase as FoldStatus;
  }
  return "pending";
}

function StatusBadge({ status }: { status: FoldStatus }) {
  return (
    <span data-testid="fold-status" data-status={status} className="inline-flex items-center gap-1 font-medium" style={{ color: STATUS_COLOR[status] }}>
      <span aria-hidden>{STATUS_GLYPH[status]}</span>
      {status}
    </span>
  );
}

function Cell({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <td data-testid={testId} className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[11px] tabular-nums">
      {children}
    </td>
  );
}

const TRADING_METRIC_NAMES = ["accuracy", "f1_score", "roc_auc", "net_profit_usd", "sharpe_ratio", "maximum_drawdown_usd", "trade_count", "win_rate"] as const;

function metricCells(board: CycleScoreboard | null, live: boolean, testIdPrefix: string) {
  if (!board) {
    return TRADING_METRIC_NAMES.map((name) => (
      <Cell key={name} testId={`${testIdPrefix}-${name}`}>
        —
      </Cell>
    ));
  }
  const m = board.metrics;
  const values: Record<(typeof TRADING_METRIC_NAMES)[number], string> = {
    accuracy: formatPercent(m.accuracy ?? null),
    f1_score: formatPercent(m.f1_score ?? null),
    roc_auc: formatRatio(m.roc_auc ?? null),
    net_profit_usd: formatUsd(m.net_profit_usd ?? null),
    sharpe_ratio: formatRatio(m.sharpe_ratio ?? null),
    maximum_drawdown_usd: formatUsd(m.maximum_drawdown_usd ?? null),
    trade_count: formatCount(m.trade_count ?? null),
    win_rate: formatPercent(m.win_rate ?? null),
  };
  return TRADING_METRIC_NAMES.map((name) => (
    <Cell key={name} testId={`${testIdPrefix}-${name}`}>
      {values[name]}
      {live && <span className="ml-1 text-[9px] text-muted-foreground">(live)</span>}
    </Cell>
  ));
}

function FoldRow({
  plan,
  status,
  finished,
  live,
  parameters,
  onFocus,
}: {
  plan: CycleFoldPlan;
  status: FoldStatus;
  finished: CycleScoreboard | null;
  live: CycleScoreboard | null;
  parameters: CycleParameters | null;
  onFocus: () => void;
}) {
  const showLive = !finished && live !== null;
  return (
    <tr data-testid="fold-row" data-fold-index={plan.foldIndex} onClick={onFocus} className="cursor-pointer border-b border-border/20 hover:bg-white/[0.04]">
      <td className="px-2 py-1.5 text-[11px] font-medium">{plan.foldIndex + 1}</td>
      <td className="px-2 py-1.5 text-[11px]">
        <StatusBadge status={status} />
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-[11px] text-muted-foreground">
        {formatDate(plan.trainStart)} – {formatDate(plan.trainEnd)}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-[11px] text-muted-foreground">
        {formatDate(plan.validationStart)} – {formatDate(plan.validationEnd)}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-[11px] text-muted-foreground">
        {formatDate(plan.testStart)} – {formatDate(plan.testEnd)}
      </td>
      <Cell testId="fold-train-bars">{formatCount(plan.trainBarCount)}</Cell>
      <Cell testId="fold-validation-bars">{formatCount(plan.validationBarCount)}</Cell>
      <Cell testId="fold-test-bars">{formatCount(plan.testBarCount)}</Cell>
      <td className="px-2 py-1.5 text-[11px]" data-testid={`fold-${plan.foldIndex}-parameters`}>
        <ParametersChip parameters={parameters} />
      </td>
      {metricCells(finished ?? live, showLive, `fold-${plan.foldIndex}`)}
    </tr>
  );
}

const HEADERS = ["Fold", "Status", "Train span", "Validation span", "Test span", "Train bars", "Validation bars", "Test bars", "Parameters", "Accuracy", "F1", "ROC AUC", "Net profit", "Sharpe", "Max drawdown", "Trades", "Win rate"];

/** How the fold's hyperparameters were chosen; the values are the tooltip. */
function ParametersChip({ parameters }: { parameters: CycleParameters | null }) {
  if (!parameters) return <span className="text-muted-foreground">—</span>;
  const values = Object.entries(parameters.parameters).map(([key, value]) => `${key} = ${String(value)}`).join("\n");
  const text =
    parameters.source === "tuned"
      ? `tuned · trial ${(parameters.bestTrial ?? 0) + 1} of ${parameters.trialCount ?? "?"}`
      : parameters.source === "manual"
        ? "typed for the run"
        : "reviewed defaults";
  return (
    <span
      title={values}
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px]",
        parameters.source === "tuned" ? "border-[#CC79A7]/50 bg-[#CC79A7]/10 text-foreground" : "border-border/50 text-muted-foreground",
      )}
    >
      {text}
      {parameters.pinned.length > 0 ? ` · ${parameters.pinned.length} pinned` : ""}
    </span>
  );
}

export function CycleFolds() {
  const plan = useCycleStore((s) => s.plan);
  const cursor = useCycleStore((s) => s.cursor);
  const folds = useCycleStore((s) => s.folds);
  const parameters = useCycleStore((s) => s.parameters);
  const running = useCycleStore((s) => s.running);
  const final = useCycleStore((s) => s.final);
  const setFocusTimestamp = useCycleStore((s) => s.setFocusTimestamp);

  const foldsByIndex = useMemo(() => {
    const map = new Map<number, CycleScoreboard>();
    for (const board of folds) if (board.foldIndex !== null) map.set(board.foldIndex, board);
    return map;
  }, [folds]);
  const parametersByIndex = useMemo(() => {
    const map = new Map<number, CycleParameters>();
    for (const chosen of parameters) if (chosen.foldIndex !== null) map.set(chosen.foldIndex, chosen);
    return map;
  }, [parameters]);

  if (!plan) {
    return <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">No plan yet — the run has not loaded data.</div>;
  }

  return (
    <div className="h-full min-h-0 overflow-auto p-2">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-card/95">
          <tr className="border-b border-border/40">
            {HEADERS.map((header) => (
              <th key={header} className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {plan.folds.map((foldPlan) => {
            const finished = foldsByIndex.get(foldPlan.foldIndex) ?? null;
            const status = statusForFold(foldPlan.foldIndex, finished !== null, cursor?.phase ?? null, cursor?.foldIndex ?? null);
            const isCurrentTestingFold = !finished && status === "testing";
            const live = isCurrentTestingFold ? running : null;
            return (
              <FoldRow
                key={foldPlan.foldIndex}
                plan={foldPlan}
                status={status}
                finished={finished}
                live={live}
                parameters={parametersByIndex.get(foldPlan.foldIndex) ?? null}
                onFocus={() => setFocusTimestamp(foldPlan.testStart)}
              />
            );
          })}
        </tbody>
        <tfoot>
          <tr data-testid="fold-totals-row" className={cn("border-t-2 border-border/60 font-semibold", !final && "text-muted-foreground")}>
            <td className="px-2 py-1.5 text-[11px]" colSpan={5}>
              Totals
            </td>
            <Cell testId="fold-totals-train-bars">{formatCount(plan.folds.reduce((sum, f) => sum + f.trainBarCount, 0))}</Cell>
            <Cell testId="fold-totals-validation-bars">{formatCount(plan.folds.reduce((sum, f) => sum + f.validationBarCount, 0))}</Cell>
            <Cell testId="fold-totals-test-bars">{formatCount(plan.folds.reduce((sum, f) => sum + f.testBarCount, 0))}</Cell>
            <td className="px-2 py-1.5 text-[11px]" />
            {metricCells(final, false, "fold-totals")}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
