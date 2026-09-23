/**
 * A grid card: one X variable against price, with the numbers that matter.
 */

import type { KeyboardEvent } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { SERIES_FAMILY_LABELS } from "@shared/series/types";
import type { PanelModel } from "./panels";
import { ScatterPlot, useMeasuredWidth } from "./ScatterPlot";
import { REGRESSION_COLORS, formatProbability, formatValue } from "./scales";

export const PANEL_PLOT_HEIGHT = 150;

interface ScatterPanelProps {
  panel: PanelModel;
  showConfidence: boolean;
  showPrediction: boolean;
  onOpen: (id: string) => void;
}

function Stat({ label, value, title, emphasis = false }: { label: string; value: string; title: string; emphasis?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col" title={title}>
      <span className="text-[9px] leading-tight text-muted-foreground/75">{label}</span>
      <span className={`truncate font-mono text-[11px] tabular-nums ${emphasis ? "text-foreground" : "text-foreground/80"}`}>{value}</span>
    </div>
  );
}

export function ScatterPanel({ panel, showConfidence, showPrediction, onOpen }: ScatterPanelProps) {
  const [measureRef, width] = useMeasuredWidth<HTMLDivElement>();
  const { variable, result, refit, qValue } = panel;
  const open = () => onOpen(variable.id);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      data-testid={`regression-panel-${variable.id}`}
      className="group flex min-w-0 cursor-pointer flex-col rounded-md border border-white/[0.07] bg-white/[0.015] p-2 transition-colors hover:border-[#E69F00]/40 hover:bg-white/[0.03] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E69F00]/60"
    >
      <div className="mb-1 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-foreground/90" title={variable.label}>
            {variable.label}
          </div>
          <div className="truncate text-[9px] text-muted-foreground/70" title={variable.detail}>
            {SERIES_FAMILY_LABELS[variable.family] ?? variable.family} · {variable.source === "bar" ? "from the bars" : variable.detail}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {variable.source === "lake" && variable.values.length > 0 && variable.matchedBars / variable.values.length < 0.5 && (
            <span
              className="inline-flex items-center rounded bg-[#56B4E9]/12 px-1 py-px text-[9px] font-medium text-[#56B4E9]"
              title={`The lake holds this column for ${variable.matchedBars.toLocaleString()} of the ${variable.values.length.toLocaleString()} loaded bars; the fit uses only those.`}
            >
              {Math.round((100 * variable.matchedBars) / variable.values.length)}% of bars
            </span>
          )}
          {variable.forwardLooking && (
            <span className="inline-flex items-center gap-0.5 rounded bg-[#D55E00]/15 px-1 py-px text-[9px] font-medium text-[#F4A582]" title="Computed from bars after this one — using it to explain price is look-ahead leakage.">
              <Clock className="h-2.5 w-2.5" /> leakage
            </span>
          )}
          {result.ok && result.fit.spuriousRegressionSuspected && (
            <span className="inline-flex items-center gap-0.5 rounded bg-[#F0E442]/10 px-1 py-px text-[9px] font-medium text-[#F0E442]" title="R² is larger than the Durbin-Watson statistic: the residuals trend, so both series may simply share a trend (Granger-Newbold spurious regression). Switch to Change or Forward return.">
              <AlertTriangle className="h-2.5 w-2.5" /> spurious?
            </span>
          )}
        </div>
      </div>

      <div ref={measureRef} className="w-full" style={{ height: PANEL_PLOT_HEIGHT }}>
        {result.ok && width > 0 ? (
          <ScatterPlot
            width={width}
            height={PANEL_PLOT_HEIGHT}
            pairs={panel.pairs}
            fit={result.fit}
            refit={refit && refit.ok ? refit.fit : null}
            showConfidence={showConfidence}
            showPrediction={showPrediction}
            compact
            maxBackgroundPoints={700}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3 text-center text-[10px] text-muted-foreground/70">
            {result.ok ? "" : variable.emptyReason ?? result.reason}
          </div>
        )}
      </div>

      {result.ok && (
        <div className="mt-1.5 grid grid-cols-4 items-end gap-x-2 gap-y-1">
          <Stat label="slope" value={formatValue(result.fit.slope)} title={`Change in Y per unit of X. ${Math.round(result.fit.confidenceLevel * 100)}% interval ${formatValue(result.fit.slopeConfidenceInterval[0])} to ${formatValue(result.fit.slopeConfidenceInterval[1])}.`} emphasis />
          <Stat label="R²" value={formatValue(result.fit.rSquared)} title="Share of the variance in Y the line explains." />
          <Stat label="Spearman ρ" value={formatValue(result.fit.spearmanCorrelation)} title="Rank correlation: does Y rise with X at all, straight line or not." />
          <Stat label="n" value={result.fit.n.toLocaleString()} title="Bars in this fit (warm-up and gaps dropped)." />
          <Stat label="p, Newey-West" value={formatProbability(result.fit.slopePValueNeweyWest)} title="Two-sided p-value of the slope, with a standard error robust to autocorrelated residuals." />
          <Stat label="q, false discovery" value={formatProbability(qValue)} title="Benjamini-Hochberg q-value across every variable computed for this view (the text filter only hides panels; it does not change q): the false-discovery rate at which this slope would first count as significant." emphasis={qValue !== null && qValue < 0.05} />
          <Stat label="Durbin-Watson" value={formatValue(result.fit.durbinWatson)} title="Near 2: residuals independent. Near 0: residuals trend together, and ordinary p-values are far too small." />
          <div className="flex min-w-0 flex-col" title="Vertical outliers (diamond): |externally studentized residual| over the Bonferroni cut-off. Influential points (ring): Cook's distance over its cut-off.">
            <span className="text-[9px] leading-tight text-muted-foreground/75">flagged</span>
            <span className="truncate font-mono text-[11px] tabular-nums text-foreground/80">
              <span style={{ color: REGRESSION_COLORS.verticalOutlier }}>◆</span>{result.fit.verticalOutlierCount}{" "}
              <span style={{ color: REGRESSION_COLORS.influential }}>○</span>{result.fit.influentialCount}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
