/**
 * CycleTrades — the closed-trade profit histogram + eight-number summary,
 * and the virtualized trade log table.
 *
 * The histogram's default bin count follows the Freedman–Diaconis rule
 * (2 × IQR ÷ n^(1/3)), clamped to the panel's 5..60 slider range; the
 * eight-number summary comes straight from the selected scoreboard's
 * `tradeDistribution` (computed server-side — never recomputed here).
 */
import { type CSSProperties, useMemo, useState } from "react";
import { List } from "react-window";

import { useCycleStore } from "@/cycle/store";
import { formatCount, formatTime, formatUsd, formatUsdMagnitude } from "@/cycle/format";
import type { CycleDistribution, CycleScoreboard as CycleScoreboardPayload, CycleTrade } from "@shared/cycle/schema";
import { cn } from "@/shared/utils/utils";

type ScopeId = "running" | "final" | `fold-${number}`;
type SideFilter = "all" | "long" | "short" | "winners" | "losers";

const EXIT_REASON_WORDS: Record<NonNullable<CycleTrade["exitReason"]>, string> = {
  holding_period: "holding period ended",
  opposite_signal: "opposite signal",
  stop_loss: "stop loss",
  take_profit: "take profit",
  fold_end: "fold ended",
  stopped: "run stopped",
};

/**
 * The eight numbers plus the count. Each row names its unit: skewness and
 * kurtosis are unitless shape numbers (they were printed as dollars), and a
 * standard deviation is a size, so it carries no sign.
 */
type DistributionUnit = "count" | "usd" | "usd_magnitude" | "unitless";
const DISTRIBUTION_ROWS: { key: keyof CycleDistribution; label: string; unit: DistributionUnit }[] = [
  { key: "count", label: "Count", unit: "count" },
  { key: "mean", label: "Mean", unit: "usd" },
  { key: "median", label: "Median", unit: "usd" },
  { key: "standardDeviation", label: "Standard deviation", unit: "usd_magnitude" },
  { key: "skewness", label: "Skewness", unit: "unitless" },
  { key: "kurtosis", label: "Excess kurtosis", unit: "unitless" },
  { key: "percentile25", label: "25th percentile", unit: "usd" },
  { key: "percentile75", label: "75th percentile", unit: "usd" },
  { key: "minimum", label: "Minimum", unit: "usd" },
  { key: "maximum", label: "Maximum", unit: "usd" },
];

function formatDistributionValue(value: number, unit: DistributionUnit): string {
  if (unit === "count") return formatCount(value);
  if (unit === "usd_magnitude") return formatUsdMagnitude(value);
  if (unit === "unitless") return value.toFixed(2);
  return formatUsd(value);
}

/** Freedman–Diaconis bin count for `values`, clamped to [5, 60]. */
function freedmanDiaconisBinCount(values: number[]): number {
  if (values.length < 2) return 5;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const range = sorted[sorted.length - 1]! - sorted[0]!;
  if (iqr <= 0 || range <= 0) return 5;
  const width = (2 * iqr) / Math.cbrt(values.length);
  if (width <= 0) return 5;
  const count = Math.round(range / width);
  return Math.min(60, Math.max(5, count));
}

function quantile(sorted: number[], p: number): number {
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const fraction = index - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * fraction;
}

interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

function buildHistogram(values: number[], binCount: number): HistogramBin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const width = span / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({ start: min + i * width, end: min + (i + 1) * width, count: 0 }));
  for (const value of values) {
    const raw = Math.floor((value - min) / width);
    const index = Math.min(binCount - 1, Math.max(0, raw));
    bins[index]!.count += 1;
  }
  return bins;
}

function Histogram({ values, binCount }: { values: number[]; binCount: number }) {
  const bins = useMemo(() => buildHistogram(values, binCount), [values, binCount]);
  if (bins.length === 0) {
    return <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No closed trades in this scope yet.</div>;
  }
  const width = 320;
  const height = 140;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const barWidth = width / bins.length;
  const zeroBinIndex = bins.findIndex((b) => b.start <= 0 && 0 < b.end);
  const zeroX = zeroBinIndex >= 0 ? zeroBinIndex * barWidth : bins[0]!.start >= 0 ? 0 : width;

  return (
    <svg width={width} height={height + 16} viewBox={`0 0 ${width} ${height + 16}`} role="img" aria-label="Closed-trade net profit histogram">
      {bins.map((bin, index) => {
        const barHeight = (bin.count / maxCount) * height;
        const midpoint = (bin.start + bin.end) / 2;
        const tone = midpoint >= 0 ? "#E69F00" : "#0072B2";
        return (
          <rect
            key={index}
            data-testid="histogram-bar"
            x={index * barWidth + 0.5}
            y={height - barHeight}
            width={Math.max(0, barWidth - 1)}
            height={barHeight}
            fill={tone}
          />
        );
      })}
      <line x1={zeroX} y1={0} x2={zeroX} y2={height} stroke="currentColor" strokeOpacity={0.4} strokeDasharray="3 2" />
      <text x={zeroX} y={height + 12} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.6}>
        $0
      </text>
    </svg>
  );
}

function DistributionPanel({ distribution }: { distribution: CycleDistribution }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
      {DISTRIBUTION_ROWS.map((row) => {
        const value = distribution[row.key];
        const text = value === null ? "—" : formatDistributionValue(value, row.unit);
        return (
          <div key={row.key} className="flex items-center justify-between gap-2" data-testid={`trade-distribution-${row.key}`}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-mono tabular-nums">{text}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function SideBadge({ side }: { side: CycleTrade["side"] }) {
  return side === "long" ? (
    <span className="font-semibold" style={{ color: "#E69F00" }}>
      ▲ Long
    </span>
  ) : (
    <span className="font-semibold" style={{ color: "#0072B2" }}>
      ▼ Short
    </span>
  );
}

interface RowProps {
  trades: CycleTrade[];
  onRowClick: (trade: CycleTrade) => void;
}

function TradeRow({ index, style, trades, onRowClick }: { index: number; style: CSSProperties } & RowProps) {
  const trade = trades[index];
  if (!trade) return null;
  const net = trade.netProfitUsd;
  return (
    <div
      style={style}
      data-testid="trade-row"
      data-trade-number={trade.tradeNumber}
      onClick={() => onRowClick(trade)}
      className="flex cursor-pointer items-center gap-2 border-b border-border/20 px-2 font-mono text-[11px] tabular-nums hover:bg-white/[0.04]"
    >
      <span className="w-14 shrink-0 text-muted-foreground">#{trade.tradeNumber}</span>
      <span className="w-12 shrink-0 text-muted-foreground">Fold {trade.foldIndex + 1}</span>
      <span className="w-16 shrink-0">
        <SideBadge side={trade.side} />
      </span>
      <span className="w-32 shrink-0 truncate">{formatTime(trade.entryTimestamp)}</span>
      <span className="w-16 shrink-0 text-right">{trade.entryPrice.toFixed(2)}</span>
      <span className="w-32 shrink-0 truncate">{trade.exitTimestamp ? formatTime(trade.exitTimestamp) : "open"}</span>
      <span className="w-16 shrink-0 text-right">{trade.exitPrice !== null ? trade.exitPrice.toFixed(2) : "—"}</span>
      <span className="w-10 shrink-0 text-right">{trade.barsHeld}</span>
      <span className="w-14 shrink-0 text-right">{(trade.probabilityUpAtEntry * 100).toFixed(1)}%</span>
      <span className="w-20 shrink-0 text-right">{formatUsd(trade.grossProfitUsd)}</span>
      <span className="w-16 shrink-0 text-right">{formatUsdMagnitude(trade.costUsd)}</span>
      <span
        className={cn("w-20 shrink-0 text-right font-semibold", net !== null && (net >= 0 ? "text-(--color-data-pos)" : "text-(--color-data-neg)"))}
      >
        {formatUsd(net)}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {trade.status === "open" ? "open" : trade.exitReason ? EXIT_REASON_WORDS[trade.exitReason] : "—"}
      </span>
    </div>
  );
}

const TABLE_ROW_HEIGHT = 24;
/** Sum of the fixed column widths below plus room for the exit reason. */
const TABLE_MINIMUM_WIDTH = 1000;

/** Column titles, same widths as `TradeRow`. */
function TradeHeader() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      <span className="w-14 shrink-0">Number</span>
      <span className="w-12 shrink-0">Fold</span>
      <span className="w-16 shrink-0">Side</span>
      <span className="w-32 shrink-0">Entry time</span>
      <span className="w-16 shrink-0 text-right">Entry price</span>
      <span className="w-32 shrink-0">Exit time</span>
      <span className="w-16 shrink-0 text-right">Exit price</span>
      <span className="w-10 shrink-0 text-right">Bars</span>
      <span className="w-14 shrink-0 text-right">P(up)</span>
      <span className="w-20 shrink-0 text-right">Gross</span>
      <span className="w-16 shrink-0 text-right">Cost</span>
      <span className="w-20 shrink-0 text-right">Net</span>
      <span className="min-w-0 flex-1">Exit reason</span>
    </div>
  );
}

export function CycleTrades() {
  const trades = useCycleStore((s) => s.trades);
  const running = useCycleStore((s) => s.running);
  const final = useCycleStore((s) => s.final);
  const folds = useCycleStore((s) => s.folds);
  const setFocusTimestamp = useCycleStore((s) => s.setFocusTimestamp);

  // Follows the data until the user picks a scope (see Scoreboard).
  const [chosenScope, setScope] = useState<ScopeId | null>(null);
  const scope: ScopeId = chosenScope ?? (final ? "final" : "running");
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [binCount, setBinCount] = useState<number | null>(null);

  const scoreboard: CycleScoreboardPayload | null = useMemo(() => {
    if (scope === "running") return running;
    if (scope === "final") return final;
    const foldIndex = Number(scope.slice("fold-".length));
    return folds.find((f) => f.foldIndex === foldIndex) ?? null;
  }, [scope, running, final, folds]);

  const scopedClosedTrades = useMemo(() => {
    const closed = trades.filter((t) => t.status === "closed" && t.netProfitUsd !== null);
    if (scope === "running" || scope === "final") return closed;
    const foldIndex = Number(scope.slice("fold-".length));
    return closed.filter((t) => t.foldIndex === foldIndex);
  }, [trades, scope]);

  const profitValues = useMemo(() => scopedClosedTrades.map((t) => t.netProfitUsd!), [scopedClosedTrades]);
  const defaultBinCount = useMemo(() => freedmanDiaconisBinCount(profitValues), [profitValues]);
  const effectiveBinCount = binCount ?? defaultBinCount;

  const filteredTrades = useMemo(() => {
    let rows = trades;
    if (sideFilter === "long") rows = rows.filter((t) => t.side === "long");
    else if (sideFilter === "short") rows = rows.filter((t) => t.side === "short");
    else if (sideFilter === "winners") rows = rows.filter((t) => t.netProfitUsd !== null && t.netProfitUsd > 0);
    else if (sideFilter === "losers") rows = rows.filter((t) => t.netProfitUsd !== null && t.netProfitUsd < 0);
    return [...rows].sort((a, b) => b.tradeNumber - a.tradeNumber);
  }, [trades, sideFilter]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["running", "final"] as const).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`trades-scope-${id}`}
            onClick={() => setScope(id)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              scope === id ? "border-primary bg-primary/15 text-foreground" : "border-border/50 text-muted-foreground",
            )}
          >
            {id === "running" ? "Running" : "Final"}
          </button>
        ))}
        {folds
          .filter((fold): fold is typeof fold & { foldIndex: number } => fold.foldIndex !== null)
          .map((fold) => (
            <button
              key={fold.foldIndex}
              type="button"
              data-testid={`trades-scope-fold-${fold.foldIndex}`}
              onClick={() => setScope(`fold-${fold.foldIndex}`)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                scope === `fold-${fold.foldIndex}` ? "border-primary bg-primary/15 text-foreground" : "border-border/50 text-muted-foreground",
              )}
            >
              Fold {fold.foldIndex + 1}
            </button>
          ))}
      </div>

      <div className="@container">
      <div className="flex flex-col gap-2 @xl:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Closed-trade net profit</span>
            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              Bins
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={effectiveBinCount}
                onChange={(event) => setBinCount(Number(event.target.value))}
                data-testid="histogram-bin-slider"
                className="w-24"
              />
              <span data-testid="histogram-bin-count" className="tabular-nums">
                {effectiveBinCount}
              </span>
            </label>
          </div>
          <Histogram values={profitValues} binCount={effectiveBinCount} />
        </div>
        <div className="shrink-0 @xl:w-56">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Eight-number summary</span>
          {scoreboard ? (
            <DistributionPanel distribution={scoreboard.tradeDistribution} />
          ) : (
            <div className="text-[11px] text-muted-foreground">No scoreboard yet for this scope.</div>
          )}
        </div>
      </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Trade log</span>
          <div className="flex flex-wrap gap-1">
            {(["all", "long", "short", "winners", "losers"] as const).map((id) => (
              <button
                key={id}
                type="button"
                data-testid={`trades-filter-${id}`}
                onClick={() => setSideFilter(id)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                  sideFilter === id ? "border-primary bg-primary/15 text-foreground" : "border-border/50 text-muted-foreground",
                )}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground">Times as stored in the lake (futures bars are Pacific wall-clock time).</div>
        {/* Horizontal scroll lives on this wrapper so the header and the
            virtual rows move together; the rows scroll vertically inside. */}
        <div className="min-h-0 flex-1 overflow-x-auto">
          <div className="flex h-full flex-col" style={{ minWidth: TABLE_MINIMUM_WIDTH }}>
            <TradeHeader />
            <div className="min-h-0 flex-1">
              {filteredTrades.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No trades match this filter yet.</div>
              ) : (
                <List<RowProps>
                  rowCount={filteredTrades.length}
                  rowHeight={TABLE_ROW_HEIGHT}
                  rowComponent={TradeRow}
                  rowProps={{ trades: filteredTrades, onRowClick: (trade) => setFocusTimestamp(trade.entryTimestamp) }}
                  overscanCount={20}
                  defaultHeight={280}
                  style={{ height: "100%" }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
