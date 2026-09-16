/**
 * PlaybackPanel — V10 step-by-step backtest playback: at each bar, what did
 * the market look like, what did the model see and predict, what did it do,
 * and what did that earn.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, SkipForward, StepBack, StepForward } from "lucide-react";
import type { LensBarWindow, LensManifest } from "@shared/lens/types";
import { Button } from "@/shared/ui/button";
import { Slider } from "@/shared/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { cn } from "@/shared/utils/utils";
import { DATA_COLORS } from "@/shared/theme/dataColors";
import { LensFrame } from "../Frame";
import { decimalsFromTick } from "../charts/priceLensData";
import { MiniCandleStrip } from "./MiniCandleStrip";
import {
  candleStripWindow,
  decisionText,
  findNextTradeEntryIndex,
  intervalBasisPointsForCoverage,
  intervalLanding,
  regimeGlyph,
  regimeLabel,
  stepBack,
  stepForward,
  targetBarForHorizon,
  topFeaturesAtBar,
} from "./playbackLogic";

export interface PlaybackPanelProps {
  window: LensBarWindow;
  manifest: LensManifest;
  /** Index into window.bars. */
  cursorIndex: number;
  onCursorIndexChange: (index: number) => void;
  /** Called when playback steps past the last bar of the window; the page slides the window forward. */
  onReachWindowEnd?: () => void;
  /** True when rows exist after this window. */
  hasMoreAfterWindow: boolean;
}

const SPEEDS = [1, 4, 16, 64] as const;
const CANDLE_STRIP_LENGTH = 40;
const TOP_FEATURE_COUNT = 10;

function formatUsdSigned(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatBasisPoints(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} bp`;
}

function formatUtc(timestampSeconds: number): string {
  return `${new Date(timestampSeconds * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function PlaybackPanel({ window: barWindow, manifest, cursorIndex, onCursorIndexChange, onReachWindowEnd, hasMoreAfterWindow }: PlaybackPanelProps) {
  const bars = barWindow.bars;
  const barCount = bars.length;
  const clampedCursor = Math.min(Math.max(0, cursorIndex), Math.max(0, barCount - 1));
  const bar = bars[clampedCursor] ?? null;

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The rAF loop reads these refs so it never closes over a stale cursor/window.
  const cursorRef = useRef(clampedCursor);
  cursorRef.current = clampedCursor;
  const barCountRef = useRef(barCount);
  barCountRef.current = barCount;
  const hasMoreRef = useRef(hasMoreAfterWindow);
  hasMoreRef.current = hasMoreAfterWindow;

  const doStep = useCallback(() => {
    const result = stepForward(cursorRef.current, barCountRef.current, hasMoreRef.current);
    if (result.nextIndex != null) onCursorIndexChange(result.nextIndex);
    else if (result.reachedWindowEnd) onReachWindowEnd?.();
    else setPlaying(false);
  }, [onCursorIndexChange, onReachWindowEnd]);

  // Play timer: requestAnimationFrame gated by wall-clock interval, not one
  // step per frame — a hidden/backgrounded tab freezes rAF entirely (the
  // playwright/claude-in-chrome automation surface does this), so playback
  // there is driven by the Step buttons instead of assumed broken.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (now - last >= 1000 / speed) {
        last = now;
        doStep();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, doStep]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const result = stepForward(clampedCursor, barCount, hasMoreAfterWindow);
      if (result.nextIndex != null) onCursorIndexChange(result.nextIndex);
      else if (result.reachedWindowEnd) onReachWindowEnd?.();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onCursorIndexChange(stepBack(clampedCursor));
    }
  };

  const jumpToNextTrade = () => {
    const next = findNextTradeEntryIndex(bars, clampedCursor);
    if (next != null) onCursorIndexChange(next);
  };

  if (!bar) {
    return <LensFrame title="Backtest playback" testId="playback-panel" unavailableReason="no bars in this window" />;
  }

  const decimals = decimalsFromTick(manifest.cost.tickSize);
  const decision = decisionText(bar.decision, bar.position);
  const positionLabel = bar.position === 1 ? "long" : bar.position === -1 ? "short" : "flat";
  const stripBars = candleStripWindow(bars, clampedCursor, CANDLE_STRIP_LENGTH);

  const topFeatures =
    barWindow.features != null
      ? topFeaturesAtBar(
          barWindow.features.names,
          barWindow.features.families,
          barWindow.features.shap[clampedCursor] ?? [],
          barWindow.features.values[clampedCursor] ?? [],
          TOP_FEATURE_COUNT,
        )
      : null;
  const maxAbsShap = topFeatures && topFeatures.length > 0 ? Math.max(...topFeatures.map((f) => Math.abs(f.shap))) : 1;

  const predictedDirection =
    bar.probabilityUp >= barWindow.params.threshold ? "up (long)" : bar.probabilityUp <= 1 - barWindow.params.threshold ? "down (short)" : "no edge";
  const intervalBp = intervalBasisPointsForCoverage(bar.predictedQuantilesBasisPoints, barWindow.params.intervalCoverage);
  const coveragePercent = Math.round(barWindow.params.intervalCoverage * 100);

  const targetBar = targetBarForHorizon(bars, bar, manifest.horizonBars);
  const landing = targetBar ? intervalLanding(bar, targetBar.close) : null;

  return (
    <LensFrame
      resizeKey="playback"
      defaultHeight={460}
      title="Backtest playback"
      question="At each bar: what did the market look like, what did the model see and predict, what did it do, and what did that earn?"
      testId="playback-panel"
      basis={`row ${bar.rowIndex.toLocaleString()} of ${barWindow.totalBarsInRange.toLocaleString()} · ${formatUtc(bar.timestampSeconds)} · speed ${speed} bars/s`}
      actions={
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => onCursorIndexChange(stepBack(clampedCursor))} disabled={clampedCursor === 0} data-testid="playback-step-back">
            <StepBack className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant={playing ? "default" : "outline"} onClick={() => setPlaying((p) => !p)} data-testid="playback-play-pause">
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon" variant="outline" onClick={doStep} disabled={clampedCursor >= barCount - 1 && !hasMoreAfterWindow} data-testid="playback-step-forward">
            <StepForward className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={jumpToNextTrade} data-testid="playback-jump-next-trade">
            <SkipForward className="mr-1 h-3.5 w-3.5" />
            Next trade
          </Button>
          <ToggleGroup type="single" size="sm" value={String(speed)} onValueChange={(v) => v && setSpeed(Number(v) as (typeof SPEEDS)[number])}>
            {SPEEDS.map((s) => (
              <ToggleGroupItem key={s} value={String(s)} data-testid={`playback-speed-${s}`}>
                {s}×
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      }
    >
      <div ref={panelRef} tabIndex={0} onKeyDown={handleKeyDown} className="flex flex-col gap-3 outline-none" data-testid="playback-body">
        {barCount > 1 ? (
          <Slider
            min={0}
            max={barCount - 1}
            step={1}
            value={[clampedCursor]}
            onValueChange={([v]) => v !== undefined && onCursorIndexChange(v)}
            data-testid="playback-scrubber"
          />
        ) : (
          // Radix Slider's percentage math divides by (max - min); a single-bar
          // window has nothing to scrub, so skip the control rather than feed it
          // a zero-width range.
          <p className="text-xs text-muted-foreground" data-testid="playback-scrubber-unavailable">
            Only one bar in this window.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {/* (1) Market state */}
          <section className="flex flex-col gap-1.5 rounded-md border border-border p-2 lg:col-span-2" data-testid="playback-market-state">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Market state</h4>
            <p className="font-mono text-xs tnum">{formatUtc(bar.timestampSeconds)}</p>
            <p className="font-mono text-xs tnum">
              O {bar.open.toFixed(decimals)} · H {bar.high.toFixed(decimals)} · L {bar.low.toFixed(decimals)} · C {bar.close.toFixed(decimals)}
            </p>
            <MiniCandleStrip bars={stripBars} cursorRowIndex={bar.rowIndex} />
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className="font-mono"
                style={{ color: bar.regime === "bull" ? DATA_COLORS.pos : bar.regime === "bear" ? DATA_COLORS.neg : DATA_COLORS.neutral }}
                aria-hidden
              >
                {regimeGlyph(bar.regime)}
              </span>
              <span>{regimeLabel(bar.regime)} regime</span>
            </div>
          </section>

          {/* (2) Features */}
          <section className="flex flex-col gap-1 rounded-md border border-border p-2 lg:col-span-2" data-testid="playback-features">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Top features (|SHAP|)</h4>
            {topFeatures ? (
              topFeatures.length === 0 ? (
                <p className="text-xs text-muted-foreground">No feature attribution at this row.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {topFeatures.map((f) => {
                    const widthPercent = maxAbsShap > 0 ? (Math.abs(f.shap) / maxAbsShap) * 50 : 0;
                    const positive = f.shap >= 0;
                    return (
                      <li key={f.name} className="text-[11px]">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate" title={f.name}>
                            {f.name} <span className="text-muted-foreground">({f.family})</span>
                          </span>
                          <span className="font-mono tnum shrink-0">
                            value {f.value != null ? f.value.toFixed(3) : "n/a"} · shap {positive ? "+" : ""}
                            {f.shap.toFixed(4)}
                          </span>
                        </div>
                        <div className="relative h-2 w-full rounded-sm bg-muted/40">
                          <div className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden />
                          <div
                            className="absolute inset-y-0 rounded-sm"
                            style={{
                              width: `${widthPercent}%`,
                              backgroundColor: positive ? DATA_COLORS.pos : DATA_COLORS.neg,
                              left: positive ? "50%" : `${50 - widthPercent}%`,
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <p className="text-xs text-muted-foreground">No attribution artifact for this model.</p>
            )}
          </section>

          {/* (3) Prediction */}
          <section className="flex flex-col gap-1.5 rounded-md border border-border p-2" data-testid="playback-prediction">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Prediction</h4>
            <div className="relative h-3 w-full rounded-full bg-muted/40" title={`P(up) = ${bar.probabilityUp.toFixed(3)}`}>
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${bar.probabilityUp * 100}%`, backgroundColor: bar.probabilityUp >= 0.5 ? DATA_COLORS.pos : DATA_COLORS.neg }}
              />
              <div className="absolute inset-y-0 w-px bg-border" style={{ left: "50%" }} aria-hidden />
              <div className="absolute inset-y-0 w-px bg-(--color-data-pos)" style={{ left: `${barWindow.params.threshold * 100}%` }} aria-hidden />
              <div className="absolute inset-y-0 w-px bg-(--color-data-neg)" style={{ left: `${(1 - barWindow.params.threshold) * 100}%` }} aria-hidden />
            </div>
            <p className="font-mono text-xs tnum">P(up) {bar.probabilityUp.toFixed(3)} · direction {predictedDirection}</p>
            {intervalBp && (
              <p className="text-[11px] text-muted-foreground">
                {coveragePercent}% interval (row + {manifest.horizonBars}): {formatBasisPoints(intervalBp.lowBasisPoints)} to {formatBasisPoints(intervalBp.highBasisPoints)}
                {bar.intervalLowerPrice != null && bar.intervalUpperPrice != null && (
                  <>
                    {" "}
                    · {bar.intervalLowerPrice.toFixed(decimals)} to {bar.intervalUpperPrice.toFixed(decimals)}
                  </>
                )}
              </p>
            )}
          </section>

          {/* (4) Decision + (5) Result */}
          <section className="flex flex-col gap-1.5 rounded-md border border-border p-2" data-testid="playback-decision-result">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Decision</h4>
            <p className="text-xs" data-testid="playback-decision-text">
              {decision} <span className="text-muted-foreground">· position {positionLabel}</span>
            </p>
            <h4 className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Result</h4>
            <p className={cn("font-mono text-xs tnum")} style={{ color: bar.barPnlUsd >= 0 ? DATA_COLORS.pos : DATA_COLORS.neg }}>
              {bar.barPnlUsd >= 0 ? "▲" : "▼"} bar {formatUsdSigned(bar.barPnlUsd)}
            </p>
            <p className="font-mono text-xs tnum">cumulative {formatUsdSigned(bar.cumulativeNetUsd)}</p>
            {landing && (
              <p className="text-[11px] text-muted-foreground" data-testid="playback-landing">
                Landed {landing} the {coveragePercent}% interval
              </p>
            )}
          </section>
        </div>
      </div>
    </LensFrame>
  );
}
