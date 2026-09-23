/**
 * One variable, opened up: the full scatter with every point hoverable, the
 * formula with its symbols defined, the statistics with what each one means,
 * the residuals through time and in distribution, the mean of Y across the
 * fifths of X, and the individual bars the fit calls outliers.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Clock, AlertTriangle } from "lucide-react";
import { eightNumberSummary } from "@shared/lens/stats";
import { SERIES_FAMILY_LABELS } from "@shared/series/types";
import type { OhlcvData } from "@/market/components/types";
import type { PanelModel, PanelSettings } from "./panels";
import { predictorAxisLabel, responseAxisLabel } from "./panels";
import { ScatterPlot, useMeasuredWidth } from "./ScatterPlot";
import { Formula } from "./Formula";
import { BucketMeans, EightNumberTable, ResidualHistogram, ResidualTimeline } from "./Diagnostics";
import { REGRESSION_COLORS, formatProbability, formatTimestamp, formatValue, type StampClock } from "./scales";

interface DetailViewProps {
  panel: PanelModel;
  bars: ReadonlyArray<OhlcvData>;
  /** The clock the bar timestamps are stamped in, so times print with the right label. */
  clock: StampClock;
  settings: PanelSettings;
  showConfidence: boolean;
  showPrediction: boolean;
  onBack: () => void;
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-white/[0.07] bg-white/[0.015] p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">{title}</h3>
      {note && <p className="mb-2 mt-0.5 text-[10px] leading-snug text-muted-foreground/80">{note}</p>}
      {children}
    </section>
  );
}

export function DetailView({ panel, bars, clock, settings, showConfidence, showPrediction, onBack }: DetailViewProps) {
  const { variable, pairs, result, refit, buckets, qValue } = panel;
  const [measureRef, width] = useMeasuredWidth<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Opened from a scrolled grid, the view would otherwise start mid-page.
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "start" });
  }, [variable.id]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [clip, setClip] = useState(false);
  const fit = result.ok ? result.fit : null;
  const [probeX, setProbeX] = useState(fit ? fit.meanX : 0);
  useEffect(() => {
    if (fit) setProbeX(fit.meanX);
  }, [fit]);

  const yLabel = responseAxisLabel(settings);
  const xLabel = predictorAxisLabel(variable.label, settings.mode);
  const active = hovered ?? selected;

  const outliers: number[] = [];
  if (fit) {
    for (let index = 0; index < fit.n; index += 1) {
      if (fit.verticalOutlier[index] || fit.influential[index]) outliers.push(index);
    }
    outliers.sort((left, right) => Math.abs(fit.studentizedExternal[right] as number) - Math.abs(fit.studentizedExternal[left] as number));
    outliers.splice(25);
  }
  const summaries = fit ? { x: eightNumberSummary(pairs.x), y: eightNumberSummary(pairs.y) } : null;

  const header = (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={onBack}
        className="mt-0.5 inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[11px] text-muted-foreground hover:border-white/25 hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> All variables
      </button>
      <div className="min-w-0">
        <h2 className="truncate text-[14px] font-semibold text-foreground">{variable.label}</h2>
        <p className="text-[10px] text-muted-foreground">
          {SERIES_FAMILY_LABELS[variable.family] ?? variable.family} · {variable.source === "bar" ? `from the bars — ${variable.detail}` : `lake ${variable.detail}`}
          {variable.source === "lake" && ` · ${variable.matchedBars.toLocaleString()} of ${bars.length.toLocaleString()} bars matched`}
          {pairs.skippedAcrossGaps > 0 && ` · ${pairs.skippedAcrossGaps.toLocaleString()} pairs left out because they span a gap in the data`}
        </p>
      </div>
    </div>
  );

  if (!fit) {
    return (
      <div ref={rootRef} className="space-y-3">
        {header}
        <p className="text-[12px] text-muted-foreground">{variable.emptyReason ?? (result.ok ? "" : result.reason)}</p>
      </div>
    );
  }

  const activeTooltip =
    active !== null
      ? {
          time: bars[pairs.barIndex[active] as number]?.timestamp,
          x: pairs.x[active] as number,
          y: pairs.y[active] as number,
          fitted: fit.fitted[active] as number,
          residual: fit.residuals[active] as number,
          studentized: fit.studentizedExternal[active] as number,
          leverage: fit.leverage[active] as number,
          cook: fit.cookDistance[active] as number,
          vertical: fit.verticalOutlier[active] === 1,
          influential: fit.influential[active] === 1,
        }
      : null;

  const refitFit = refit && refit.ok ? refit.fit : null;
  const statRows: Array<[string, string, string]> = [
    ["slope b", `${formatValue(fit.slope)} ± ${formatValue(fit.slopeStandardError)}`, "Change in Y per unit of X, ± its ordinary standard error."],
    [`${Math.round(fit.confidenceLevel * 100)}% interval for b`, `${formatValue(fit.slopeConfidenceInterval[0])} to ${formatValue(fit.slopeConfidenceInterval[1])}`, "b ± t·SE(b). Excludes 0 ⇔ p below the matching level (ordinary errors)."],
    ["intercept a", `${formatValue(fit.intercept)} ± ${formatValue(fit.interceptStandardError)}`, "Fitted Y at X = 0."],
    ["t, p (ordinary)", `${formatValue(fit.slopeTStatistic)}, ${formatProbability(fit.slopePValue)}`, "Assumes independent residuals. Too optimistic when Durbin-Watson is far below 2."],
    ["t, p (Newey-West)", `${formatValue(fit.slopeTStatisticNeweyWest)}, ${formatProbability(fit.slopePValueNeweyWest)}`, `Standard error robust to autocorrelation (Bartlett weights, lag ${fit.neweyWestLag}). The honest p for bars.`],
    ["q, false discovery rate", formatProbability(qValue), "Benjamini-Hochberg across every variable computed for this view — the text filter hides panels but does not change q. The false-discovery rate at which this slope first counts."],
    ["R², adjusted R²", `${formatValue(fit.rSquared)}, ${formatValue(fit.adjustedRSquared)}`, "Share of Y's variance the line explains."],
    ["Pearson r, Spearman ρ", `${formatValue(fit.pearsonCorrelation)}, ${formatValue(fit.spearmanCorrelation)}`, "Straight-line and rank correlation. ρ far from r: the relationship is curved or driven by a few points."],
    ["Durbin-Watson, lag-1 ρ", `${formatValue(fit.durbinWatson)}, ${formatValue(fit.residualLagOneAutocorrelation)}`, "2 and 0 when neighbouring residuals are unrelated. Near 0 and 1: they trend."],
    ["residual standard error s", formatValue(fit.residualStandardError), "Typical vertical miss of the line."],
    ["outlier cut-off |t|", formatValue(fit.verticalOutlierCutoff), `Bonferroni over ${fit.n.toLocaleString()} bars at family α 5%, Student t with n − 3 degrees of freedom.`],
    ["Cook's distance cut-off", formatValue(fit.cookCutoff), settings.cookCutoff === "one" ? "1: only points that move the fit by a full confidence region." : "4 / n: the common screen for influence."],
  ];
  if (refitFit) {
    statRows.push([
      "slope without flagged bars",
      `${formatValue(refitFit.slope)} (R² ${formatValue(refitFit.rSquared)})`,
      `Refit on ${refitFit.n.toLocaleString()} bars after removing ${(fit.n - refitFit.n).toLocaleString()} flagged ones. A big change means a handful of bars made the line.`,
    ]);
  }

  return (
    <div ref={rootRef} className="space-y-3">
      {header}

      {(fit.spuriousRegressionSuspected || variable.forwardLooking || (settings.mode === "level" && variable.containsClose)) && (
        <div className="space-y-1 rounded-md border border-[#F0E442]/25 bg-[#F0E442]/[0.05] p-2 text-[11px] text-foreground/85">
          {variable.forwardLooking && (
            <p className="flex gap-1.5"><Clock className="mt-0.5 h-3 w-3 shrink-0 text-[#F4A582]" /> This column is computed from bars after the one it sits on. Any fit against price is look-ahead leakage, not an edge.</p>
          )}
          {fit.spuriousRegressionSuspected && (
            <p className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#F0E442]" /> R² ({formatValue(fit.rSquared)}) is above Durbin-Watson ({formatValue(fit.durbinWatson)}): the residuals move in long runs, the signature of two series that merely share a trend. The ordinary p-value is not to be trusted — use Change or Forward return.</p>
          )}
          {settings.mode === "level" && variable.containsClose && (
            <p className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#F0E442]" /> This variable is built from the close, so part of its relationship with the close is arithmetic.</p>
          )}
        </div>
      )}

      <Section title="Scatter" note={`${yLabel} against ${xLabel}. Hover a point to read it; click to pin it.`}>
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <span><span style={{ color: REGRESSION_COLORS.point }}>●</span> bar</span>
          <span><span style={{ color: REGRESSION_COLORS.verticalOutlier }}>◆</span> vertical outlier ({fit.verticalOutlierCount})</span>
          <span><span style={{ color: REGRESSION_COLORS.influential }}>○</span> influential ({fit.influentialCount})</span>
          <span><span style={{ color: REGRESSION_COLORS.fit }}>━</span> fitted line</span>
          {refitFit && <span><span style={{ color: REGRESSION_COLORS.refit }}>╍</span> refit without flagged</span>}
          {showConfidence && <span><span className="inline-block h-2 w-3 align-middle" style={{ background: REGRESSION_COLORS.confidenceBand }} /> {Math.round(fit.confidenceLevel * 100)}% confidence</span>}
          {showPrediction && <span><span style={{ color: REGRESSION_COLORS.predictionBand }}>┄</span> {Math.round(fit.confidenceLevel * 100)}% prediction</span>}
          <label className="ml-auto flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={clip} onChange={(event) => setClip(event.target.checked)} className="accent-[#E69F00]" />
            axes 0.5th–99.5th percentile
          </label>
        </div>
        <div ref={measureRef} className="w-full" style={{ height: 340 }}>
          {width > 0 && (
            <ScatterPlot
              width={width}
              height={340}
              pairs={pairs}
              fit={fit}
              refit={refitFit}
              showConfidence={showConfidence}
              showPrediction={showPrediction}
              clipToPercentiles={clip}
              xLabel={xLabel}
              yLabel={yLabel}
              highlightIndex={active}
              probeX={probeX}
              onHover={setHovered}
              onSelect={(index) => setSelected((current) => (current === index ? null : index))}
            />
          )}
        </div>
        <div className="mt-2 min-h-[34px] rounded border border-white/[0.06] bg-black/20 px-2 py-1 font-mono text-[10px] text-foreground/80">
          {activeTooltip ? (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 tabular-nums">
              <span>{activeTooltip.time !== undefined ? formatTimestamp(activeTooltip.time, clock) : "—"}</span>
              <span>X {formatValue(activeTooltip.x)}</span>
              <span>Y {formatValue(activeTooltip.y)}</span>
              <span>fitted {formatValue(activeTooltip.fitted)}</span>
              <span>residual {formatValue(activeTooltip.residual)}</span>
              <span>studentized {formatValue(activeTooltip.studentized)}</span>
              <span>leverage {formatValue(activeTooltip.leverage)}</span>
              <span>Cook {formatValue(activeTooltip.cook)}</span>
              {activeTooltip.vertical && <span style={{ color: REGRESSION_COLORS.verticalOutlier }}>◆ vertical outlier</span>}
              {activeTooltip.influential && <span style={{ color: REGRESSION_COLORS.influential }}>○ influential</span>}
            </div>
          ) : (
            <span className="text-muted-foreground">Hover or click a point.</span>
          )}
        </div>
      </Section>

      <Formula fit={fit} xLabel={xLabel} yLabel={yLabel} probeX={probeX} onProbeXChange={setProbeX} />

      <Section title="Statistics">
        <table className="w-full text-[11px]">
          <tbody>
            {statRows.map(([label, value, meaning]) => (
              <tr key={label} className="border-t border-white/[0.04] align-top">
                <td className="w-[34%] py-1 pr-2 text-foreground/85">{label}</td>
                <td className="w-[28%] py-1 pr-2 text-right font-mono tabular-nums text-foreground">{value}</td>
                <td className="py-1 text-[10px] leading-snug text-muted-foreground">{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Residuals through time"
        note="Externally studentized residual of every bar in time order. Dashed lines: the Bonferroni cut-off. Runs of same-signed residuals are what Durbin-Watson measures. Click to pin a bar."
      >
        <ResidualTimeline fit={fit} highlightIndex={active} onSelect={setSelected} />
      </Section>

      <Section title="Residual distribution" note="Histogram of residuals against a normal curve of the same spread (dashed). Fat tails show as bars beyond the curve — kurtosis below says how fat.">
        <ResidualHistogram fit={fit} />
        {summaries && (
          <div className="mt-2">
            <EightNumberTable
              columns={[
                { label: "residual", summary: fit.residualSummary },
                { label: "X", summary: summaries.x },
                { label: "Y", summary: summaries.y },
              ]}
            />
          </div>
        )}
      </Section>

      {buckets && (
        <Section
          title="Mean Y across fifths of X"
          note="Bars sorted by X and split into five equal groups — fewer when X repeats, since one X value is never split across two groups. A straight line assumes Y moves evenly across X; this shows whether it does, or moves only at the extremes."
        >
          <BucketMeans buckets={buckets} yUnit={settings.mode === "forward_return" ? "basis points" : "points"} />
        </Section>
      )}

      <Section title="Flagged bars" note={`The ${outliers.length} most extreme of ${fit.verticalOutlierCount + fit.influentialCount} flags, by |studentized residual|. Click a row to find it in the scatter and the timeline.`}>
        {outliers.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No bar crosses either cut-off.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[10px]">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-wide text-muted-foreground/70">
                  <th className="pb-1 font-medium">bar</th>
                  <th className="pb-1 text-right font-medium">X</th>
                  <th className="pb-1 text-right font-medium">Y</th>
                  <th className="pb-1 text-right font-medium">residual</th>
                  <th className="pb-1 text-right font-medium">studentized</th>
                  <th className="pb-1 text-right font-medium">Cook</th>
                  <th className="pb-1 pl-2 font-medium">flag</th>
                </tr>
              </thead>
              <tbody>
                {outliers.map((index) => {
                  const time = bars[pairs.barIndex[index] as number]?.timestamp;
                  return (
                    <tr
                      key={index}
                      onClick={() => setSelected(index)}
                      className={`cursor-pointer border-t border-white/[0.04] hover:bg-white/[0.04] ${selected === index ? "bg-white/[0.06]" : ""}`}
                    >
                      <td className="py-0.5 font-mono text-foreground/80">{time !== undefined ? formatTimestamp(time, clock) : "—"}</td>
                      <td className="py-0.5 text-right font-mono tabular-nums">{formatValue(pairs.x[index] as number)}</td>
                      <td className="py-0.5 text-right font-mono tabular-nums">{formatValue(pairs.y[index] as number)}</td>
                      <td className="py-0.5 text-right font-mono tabular-nums">{formatValue(fit.residuals[index] as number)}</td>
                      <td className="py-0.5 text-right font-mono tabular-nums">{formatValue(fit.studentizedExternal[index] as number)}</td>
                      <td className="py-0.5 text-right font-mono tabular-nums">{formatValue(fit.cookDistance[index] as number)}</td>
                      <td className="py-0.5 pl-2">
                        {fit.verticalOutlier[index] === 1 && <span style={{ color: REGRESSION_COLORS.verticalOutlier }}>◆ </span>}
                        {fit.influential[index] === 1 && <span style={{ color: REGRESSION_COLORS.influential }}>○</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
