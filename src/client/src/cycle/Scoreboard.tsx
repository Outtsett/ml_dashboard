/**
 * CycleScoreboard — live metric tiles for the current run, grouped Trading /
 * Classification / Baselines / Price forecast, switchable between the running score, each
 * finished fold's score, and the final score.
 *
 * Tooltips use the native `title` attribute rather than a Radix popover: the
 * definitions are plain sentences, not interactive content, and `title`
 * keeps them trivially readable by screen readers and tests alike.
 */
import { useMemo, useState } from "react";

import { useCycleStore } from "@/cycle/store";
import { formatCount, formatPercent, formatRatio, formatUsd } from "@/cycle/format";
import { METRIC_DEFINITIONS, METRIC_GROUPS, type MetricFormatKind } from "@/cycle/metricDefinitions";
import type { CycleMetricName, CycleScoreboard as CycleScoreboardPayload } from "@shared/cycle/schema";
import { cn } from "@/shared/utils/utils";

type ScopeId = "running" | "final" | `fold-${number}`;

function formatMetric(kind: MetricFormatKind, value: number | null): string {
  switch (kind) {
    case "usd":
      return formatUsd(value);
    case "ratio":
      return formatRatio(value);
    case "percent":
      return formatPercent(value);
    case "count":
      return formatCount(value);
    case "points": {
      const text = formatRatio(value, 2);
      return value === null || !Number.isFinite(value) ? text : `${text} points`;
    }
  }
}

/** A 60x18 inline SVG sparkline — no charting library, just a normalized polyline. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 60;
  const height = 18;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = values[values.length - 1]!;
  const first = values[0]!;
  const tone = last >= first ? "#E69F00" : "#0072B2";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden>
      <polyline points={points} fill="none" stroke={tone} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type ComparisonTone = "up" | "down" | "even";

function comparisonLine(
  name: CycleMetricName,
  metrics: Record<string, number | null>,
): { text: string; tone: ComparisonTone } | null {
  if (name === "price_forecast_skill") {
    // Skill is already relative to the no-change forecast: 1 − MAE ÷ no-change MAE.
    const skill = metrics.price_forecast_skill;
    if (skill == null || !Number.isFinite(skill)) return null;
    const percent = Math.abs(skill * 100).toFixed(1);
    if (percent === "0.0") return { text: "= no better than no-change", tone: "even" };
    return skill > 0
      ? { text: `▲ beats no-change by ${percent}%`, tone: "up" }
      : { text: `▼ worse than no-change by ${percent}%`, tone: "down" };
  }
  if (name === "accuracy") {
    const value = metrics.accuracy;
    const baseline = metrics.majority_class_accuracy;
    if (value == null || baseline == null) return null;
    const diffPoints = (value - baseline) * 100;
    const tone = diffPoints >= 0 ? "up" : "down";
    return { text: `${tone === "up" ? "▲" : "▼"} ${Math.abs(diffPoints).toFixed(1)} points ${tone === "up" ? "above" : "below"} always-predict-majority`, tone };
  }
  if (name === "net_profit_usd") {
    const value = metrics.net_profit_usd;
    const baseline = metrics.buy_and_hold_net_profit_usd;
    if (value == null || baseline == null) return null;
    const diff = value - baseline;
    const tone = diff >= 0 ? "up" : "down";
    // A distance, so no sign: "▼ $2,962.40 below", never "▼ +$2,962.40 below".
    const distance = formatUsd(Math.abs(diff)).replace(/^\+/, "");
    return { text: `${tone === "up" ? "▲" : "▼"} ${distance} ${tone === "up" ? "above" : "below"} buy-and-hold`, tone };
  }
  return null;
}

function Tile({ name, scoreboard, history }: { name: CycleMetricName; scoreboard: CycleScoreboardPayload | null; history: number[] }) {
  const definition = METRIC_DEFINITIONS[name];
  const value = scoreboard ? (scoreboard.metrics[name] ?? null) : null;
  const isNull = value === null || value === undefined;
  const isMoney = definition.formatKind === "usd";
  // Only profit-like money (higher is better) carries a sign and the profit /
  // loss colours. A drawdown or a cost is a size: shown unsigned and neutral,
  // never as an orange "+$3,641.80" that reads like a gain.
  const isProfitLike = isMoney && definition.better === "higher";
  const rawFormatted = formatMetric(definition.formatKind, value ?? null);
  const formatted = isMoney && !isProfitLike ? rawFormatted.replace(/^\+/, "") : rawFormatted;
  const sign = isProfitLike && !isNull ? (value! > 0 ? "up" : value! < 0 ? "down" : null) : null;
  const comparison = scoreboard ? comparisonLine(name, scoreboard.metrics) : null;
  const betterText =
    definition.better === "higher" ? "Higher is better." : definition.better === "lower" ? "Lower is better." : "Closer to zero is better.";
  const tooltip = isNull
    ? `${definition.label} is undefined: ${definition.nullReason}.`
    : `${definition.definition} Formula: ${definition.formula}. Unit: ${definition.unit}. ${betterText}`;

  return (
    <div
      data-testid={`metric-tile-${name}`}
      title={tooltip}
      className="flex flex-col gap-1 rounded-md border border-border/40 bg-card/40 px-2.5 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{definition.label}</span>
        <Sparkline values={history} />
      </div>
      <div className="flex items-baseline gap-1">
        <span
          data-testid={`metric-value-${name}`}
          className={cn(
            "font-mono text-sm tabular-nums",
            isNull && "text-muted-foreground",
            sign === "up" && "text-(--color-data-pos)",
            sign === "down" && "text-(--color-data-neg)",
          )}
        >
          {formatted}
        </span>
      </div>
      {comparison && (
        <span
          data-testid={`metric-comparison-${name}`}
          className={cn(
            "text-[10px] font-medium",
            comparison.tone === "up" && "text-(--color-data-pos)",
            comparison.tone === "down" && "text-(--color-data-neg)",
            comparison.tone === "even" && "text-muted-foreground",
          )}
        >
          {comparison.text}
        </span>
      )}
    </div>
  );
}

export function CycleScoreboard() {
  const running = useCycleStore((s) => s.running);
  const final = useCycleStore((s) => s.final);
  const folds = useCycleStore((s) => s.folds);
  const history = useCycleStore((s) => s.history);

  // Follows the data (Final once it exists, Running before) until the user
  // picks a scope. Deciding once at mount stuck on Running after a reload,
  // because the snapshot with the final scoreboard arrives after the mount.
  const [chosenScope, setScope] = useState<ScopeId | null>(null);
  const scope: ScopeId = chosenScope ?? (final ? "final" : "running");

  const selected: CycleScoreboardPayload | null = useMemo(() => {
    if (scope === "running") return running;
    if (scope === "final") return final;
    const foldIndex = Number(scope.slice("fold-".length));
    return folds.find((f) => f.foldIndex === foldIndex) ?? null;
  }, [scope, running, final, folds]);

  const historyByMetric = useMemo(() => {
    const byName = new Map<CycleMetricName, number[]>();
    for (const group of METRIC_GROUPS) {
      for (const name of group.metrics) {
        const series: number[] = [];
        for (const sample of history) {
          const value = sample.metrics[name];
          if (typeof value === "number" && Number.isFinite(value)) series.push(value);
        }
        byName.set(name, series);
      }
    }
    return byName;
  }, [history]);

  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="scoreboard-scope-running"
          onClick={() => setScope("running")}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            scope === "running" ? "border-primary bg-primary/15 text-foreground" : "border-border/50 text-muted-foreground",
          )}
        >
          Running
        </button>
        {folds
          .filter((fold): fold is typeof fold & { foldIndex: number } => fold.foldIndex !== null)
          .map((fold) => (
            <button
              key={fold.foldIndex}
              type="button"
              data-testid={`scoreboard-scope-fold-${fold.foldIndex}`}
              onClick={() => setScope(`fold-${fold.foldIndex}`)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                scope === `fold-${fold.foldIndex}` ? "border-primary bg-primary/15 text-foreground" : "border-border/50 text-muted-foreground",
              )}
            >
              Fold {fold.foldIndex + 1}
            </button>
          ))}
        <button
          type="button"
          data-testid="scoreboard-scope-final"
          onClick={() => setScope("final")}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            scope === "final" ? "border-primary bg-primary/15 text-foreground" : "border-border/50 text-muted-foreground",
          )}
        >
          Final
        </button>
      </div>

      {selected ? (
        <div data-testid="scoreboard-coverage" className="text-[11px] text-muted-foreground">
          {formatCount(selected.barsEvaluated)} bars evaluated / {formatCount(selected.barsScored)} bars scored
          {selected.notes.length > 0 && <span> — {selected.notes.join("; ")}</span>}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">No scoreboard yet for this scope.</div>
      )}

      {METRIC_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{group.title}</h3>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {group.metrics.map((name) => (
              <Tile key={name} name={name} scoreboard={selected} history={historyByMetric.get(name) ?? []} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
