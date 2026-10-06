/**
 * The run page's charts, one per question. Every one reads the run view as the
 * API serves it and recomputes from its own controls; none fetches.
 */
import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CycleTrial } from "@shared/cycle/schema";
import type { RunCalibrationBin, RunConfusionCell, RunDailyRow, RunEpochPoint, RunFoldRow } from "@shared/runs/types";
import { COIN_FLIP_LOG_LOSS } from "@shared/runs/verdicts";
import { foldColor } from "@/runs/format";

const AXIS = { fontSize: 10, fill: "hsl(var(--muted-foreground))", fontFamily: "ui-monospace, monospace" } as const;
const GRID = "hsl(var(--border))";
const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  fontSize: 11,
  fontFamily: "ui-monospace, monospace",
} as const;
const POSITIVE = "#E69F00";
const NEGATIVE = "#0072B2";

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded border px-2 py-0.5 font-mono text-[11px] ${
        active ? "border-foreground/60 bg-foreground/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ChartFrame({ title, caption, controls, children }: { title: string; caption: string; controls?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-foreground">{title}</div>
          <div className="text-[11px] leading-snug text-muted-foreground">{caption}</div>
        </div>
        {controls && <div className="flex flex-wrap items-center gap-1">{controls}</div>}
      </div>
      <div className="mt-2 h-56">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">{children}</div>;
}

function foldIndexes(rows: ReadonlyArray<{ foldIndex: number | null }>): number[] {
  return [...new Set(rows.map((row) => row.foldIndex ?? 0))].sort((a, b) => a - b);
}

// ─── learning ───────────────────────────────────────────────────────────────

export function LossChart({ epochs }: { epochs: RunEpochPoint[] }) {
  const roles = [...new Set(epochs.map((point) => point.modelRole))];
  const [role, setRole] = useState<"direction" | "price">("direction");
  const [fold, setFold] = useState<number | "all">("all");
  const [showTrain, setShowTrain] = useState(true);
  const activeRole = roles.includes(role) ? role : roles[0] ?? "direction";
  const ofRole = epochs.filter((point) => point.modelRole === activeRole);
  const folds = foldIndexes(ofRole);
  const shownFolds = fold === "all" || !folds.includes(fold) ? folds : [fold];

  // one row per step, one pair of columns per fold
  const bySteps = new Map<number, Record<string, number | null>>();
  for (const point of ofRole) {
    if (!shownFolds.includes(point.foldIndex)) continue;
    const row = bySteps.get(point.step) ?? { step: point.step };
    row[`validation_${point.foldIndex}`] = point.validationLoss;
    row[`train_${point.foldIndex}`] = point.trainLoss;
    bySteps.set(point.step, row);
  }
  const rows = [...bySteps.values()].sort((a, b) => (a.step ?? 0) - (b.step ?? 0));

  return (
    <ChartFrame
      title="Loss by training step"
      caption={
        activeRole === "direction"
          ? "Solid: validation loss. Dashed: training loss. One colour per fold. The grey line is a coin flip (0.693): validation has to get under it."
          : "Price model. Solid: validation error. Dashed: training error, both on the volatility-scaled move. One colour per fold."
      }
      controls={
        <>
          {roles.length > 1 && roles.map((entry) => (
            <Chip key={entry} active={activeRole === entry} onClick={() => setRole(entry)}>
              {entry === "direction" ? "Direction model" : "Price model"}
            </Chip>
          ))}
          <Chip active={fold === "all"} onClick={() => setFold("all")}>All folds</Chip>
          {folds.map((index) => (
            <Chip key={index} active={fold === index} onClick={() => setFold(index)}>Fold {index + 1}</Chip>
          ))}
          <Chip active={showTrain} onClick={() => setShowTrain(!showTrain)}>Training line</Chip>
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty>No training steps reported yet.</Empty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
            <XAxis dataKey="step" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} />
            <YAxis tick={AXIS} domain={["auto", "auto"]} width={48} tickFormatter={(value: number) => value.toFixed(3)} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(step) => `step ${step}`} formatter={(value: number) => value.toFixed(4)} />
            {activeRole === "direction" && <ReferenceLine y={COIN_FLIP_LOG_LOSS} stroke="#808A99" strokeDasharray="6 3" />}
            {shownFolds.map((index) => (
              <Line key={`v${index}`} dataKey={`validation_${index}`} name={`fold ${index + 1} validation`} stroke={foldColor(index)} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            ))}
            {showTrain && shownFolds.map((index) => (
              <Line key={`t${index}`} dataKey={`train_${index}`} name={`fold ${index + 1} training`} stroke={foldColor(index)} strokeWidth={1.25} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

// ─── prediction ─────────────────────────────────────────────────────────────

export function CalibrationChart({ bins }: { bins: RunCalibrationBin[] }) {
  const filled = bins.filter((bin) => bin.scoredBarCount > 0 && bin.meanProbabilityUp !== null && bin.observedUpFraction !== null);
  const rows = filled.map((bin) => ({ predicted: bin.meanProbabilityUp!, observed: bin.observedUpFraction!, bars: bin.scoredBarCount }));
  return (
    <ChartFrame
      title="Calibration: when it says 60%, is it up 60% of the time?"
      caption={`Each point is one probability bucket that holds bars (${filled.length} of ${bins.length}). On the grey diagonal the probability is honest; a flat row of points means the probability says nothing.`}
    >
      {rows.length === 0 ? (
        <Empty>Calibration lands when the first fold finishes.</Empty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
            <XAxis dataKey="predicted" type="number" domain={[0, 1]} tick={AXIS} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} />
            <YAxis type="number" domain={[0, 1]} tick={AXIS} width={40} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, _name: string, item: { payload?: { bars?: number } }) =>
                `${(value * 100).toFixed(1)}% across ${(item.payload?.bars ?? 0).toLocaleString("en-US")} bars`
              }
              labelFormatter={(value: number) => `predicted ${(value * 100).toFixed(1)}%`}
            />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="#808A99" strokeDasharray="6 3" />
            <Line dataKey="observed" name="observed up" stroke={POSITIVE} strokeWidth={2} dot={{ r: 4, fill: POSITIVE }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

export function ConfusionGrid({ cells }: { cells: RunConfusionCell[] }) {
  const directions = ["up", "down"];
  const find = (actual: string, predicted: string) => cells.find((cell) => cell.actualDirection === actual && cell.predictedDirection === predicted);
  const total = cells.reduce((sum, cell) => sum + cell.barCount, 0);
  return (
    <div className="rounded-md border border-border bg-card/60 p-3">
      <div className="text-[12px] font-semibold text-foreground">What it called against what happened</div>
      <div className="text-[11px] leading-snug text-muted-foreground">
        Rows: what the market did. Columns: what the model called. A model with skill fills the two outlined cells; an empty column means it never makes that call.
      </div>
      {total === 0 ? (
        <div className="mt-3 text-[11px] text-muted-foreground">The table lands when the first fold finishes.</div>
      ) : (
        <div className="mt-3 grid grid-cols-[auto_1fr_1fr] gap-1 font-mono text-[11px]">
          <div />
          {directions.map((predicted) => (
            <div key={predicted} className="text-center text-muted-foreground">called {predicted}</div>
          ))}
          {directions.map((actual) => (
            <div key={actual} className="contents">
              <div className="flex items-center pr-2 text-muted-foreground">went {actual}</div>
              {directions.map((predicted) => {
                const cell = find(actual, predicted);
                const share = total > 0 ? (cell?.barCount ?? 0) / total : 0;
                const right = actual === predicted;
                return (
                  <div
                    key={predicted}
                    className="rounded px-2 py-3 text-center"
                    style={{ backgroundColor: `rgba(86, 180, 233, ${0.06 + share * 0.7})`, outline: right ? "1px solid #E69F00" : "none" }}
                  >
                    <div className="text-sm font-semibold tabular-nums text-foreground">{(cell?.barCount ?? 0).toLocaleString("en-US")}</div>
                    <div className="text-[10px] text-muted-foreground">{(share * 100).toFixed(1)}% of bars</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── trading ────────────────────────────────────────────────────────────────

export function EquityChart({ daily }: { daily: RunDailyRow[] }) {
  const [mode, setMode] = useState<"cumulative" | "daily">("cumulative");
  const rows = daily.map((row) => ({ day: row.sessionDay, cumulative: row.cumulativeNetProfitUsd, daily: row.netProfitUsd, trades: row.tradeCount }));
  return (
    <ChartFrame
      title="Net profit by session day, after costs"
      caption={
        mode === "cumulative"
          ? "The running total in USD across every test window. Above the zero line it is ahead."
          : "Each session day's own result in USD. Orange bars are up days, blue bars are down days."
      }
      controls={
        <>
          <Chip active={mode === "cumulative"} onClick={() => setMode("cumulative")}>Running total</Chip>
          <Chip active={mode === "daily"} onClick={() => setMode("daily")}>Each day</Chip>
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty>Daily results land when the first fold finishes.</Empty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          {mode === "cumulative" ? (
            <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
              <XAxis dataKey="day" tick={AXIS} minTickGap={40} />
              <YAxis tick={AXIS} width={56} tickFormatter={(value: number) => `$${Math.round(value).toLocaleString("en-US")}`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => `$${Math.round(value).toLocaleString("en-US")}`} />
              <ReferenceLine y={0} stroke="#808A99" />
              <Line dataKey="cumulative" name="running net profit" stroke={POSITIVE} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          ) : (
            <BarChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
              <XAxis dataKey="day" tick={AXIS} minTickGap={40} />
              <YAxis tick={AXIS} width={56} tickFormatter={(value: number) => `$${Math.round(value).toLocaleString("en-US")}`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => `$${Math.round(value).toLocaleString("en-US")}`} />
              <ReferenceLine y={0} stroke="#808A99" />
              <Bar dataKey="daily" name="day net profit" isAnimationActive={false}>
                {rows.map((row) => (
                  <Cell key={row.day} fill={(row.daily ?? 0) >= 0 ? POSITIVE : NEGATIVE} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

// ─── tuning ─────────────────────────────────────────────────────────────────

export function TrialsChart({ trials }: { trials: CycleTrial[] }) {
  const complete = trials.filter((trial) => trial.state === "complete" && trial.objectiveValue !== null);
  const folds = foldIndexes(complete.map((trial) => ({ foldIndex: trial.foldIndex ?? 0 })));
  const [fold, setFold] = useState<number>(0);
  const activeFold = folds.includes(fold) ? fold : folds[0] ?? 0;
  const objective = complete[0]?.objectiveName ?? "sharpe_ratio";
  const lowerIsBetter = objective === "log_loss";
  let best: number | null = null;
  const rows = complete
    .filter((trial) => (trial.foldIndex ?? 0) === activeFold)
    .sort((a, b) => a.trial - b.trial)
    .map((trial) => {
      const value = trial.objectiveValue as number;
      best = best === null ? value : lowerIsBetter ? Math.min(best, value) : Math.max(best, value);
      return { trial: trial.trial + 1, value, best };
    });
  return (
    <ChartFrame
      title={`Search objective by trial (${objective.replace(/_/g, " ")})`}
      caption={`Each dot is one setting the search tried on this fold's own training window. The line is the best found so far: flat means later trials found nothing better. ${lowerIsBetter ? "Lower" : "Higher"} is better.`}
      controls={folds.map((index) => (
        <Chip key={index} active={activeFold === index} onClick={() => setFold(index)}>Fold {index + 1}</Chip>
      ))}
    >
      {rows.length === 0 ? (
        <Empty>No completed trials. A run on reviewed defaults does not search.</Empty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
            <XAxis dataKey="trial" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} allowDecimals={false} />
            <YAxis tick={AXIS} width={48} tickFormatter={(value: number) => value.toFixed(2)} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(trial) => `trial ${trial}`} formatter={(value: number) => value.toFixed(3)} />
            {objective === "sharpe_ratio" && <ReferenceLine y={0} stroke="#808A99" />}
            <Line dataKey="best" name="best so far" type="stepAfter" stroke={POSITIVE} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Scatter dataKey="value" name="trial" fill={foldColor(1)} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

// ─── folds ──────────────────────────────────────────────────────────────────

const FOLD_METRICS: Array<{ name: string; label: string; zero: number; format: (value: number) => string }> = [
  { name: "net_profit_usd", label: "Net profit", zero: 0, format: (value) => `$${Math.round(value).toLocaleString("en-US")}` },
  { name: "sharpe_ratio", label: "Sharpe ratio", zero: 0, format: (value) => value.toFixed(2) },
  { name: "accuracy", label: "Accuracy", zero: 0.5, format: (value) => `${(value * 100).toFixed(1)}%` },
  { name: "roc_auc", label: "ROC AUC", zero: 0.5, format: (value) => value.toFixed(3) },
];

export function FoldsChart({ folds }: { folds: RunFoldRow[] }) {
  const [metric, setMetric] = useState("net_profit_usd");
  const spec = FOLD_METRICS.find((entry) => entry.name === metric) ?? FOLD_METRICS[0]!;
  const rows = folds.map((fold) => ({ fold: `Fold ${fold.foldIndex + 1}`, value: fold.metrics[spec.name] ?? null }));
  return (
    <ChartFrame
      title={`${spec.label} in each test window`}
      caption={`One bar per fold, each a separate stretch of bars the model never trained on. Orange is above ${spec.format(spec.zero)}, blue is below. Bars of mixed colour mean the result depends on the window.`}
      controls={FOLD_METRICS.map((entry) => (
        <Chip key={entry.name} active={metric === entry.name} onClick={() => setMetric(entry.name)}>{entry.label}</Chip>
      ))}
    >
      {rows.length === 0 ? (
        <Empty>Fold results land as each fold finishes.</Empty>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
            <XAxis dataKey="fold" tick={AXIS} />
            <YAxis tick={AXIS} width={56} tickFormatter={spec.format} domain={spec.zero === 0 ? ["auto", "auto"] : [(min: number) => Math.min(min, spec.zero - 0.02), (max: number) => Math.max(max, spec.zero + 0.02)]} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number) => spec.format(value)} />
            <ReferenceLine y={spec.zero} stroke="#808A99" />
            <Bar dataKey="value" name={spec.label} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell key={row.fold} fill={(row.value ?? spec.zero) >= spec.zero ? POSITIVE : NEGATIVE} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
