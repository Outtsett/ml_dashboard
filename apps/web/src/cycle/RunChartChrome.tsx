/**
 * The run's chrome, drawn over the Market chart while a Model Cycle run is shown.
 *
 * This is the UI half of what used to be `CycleChart.tsx`: the run's legend line,
 * the follow control, the key that explains the glyphs, and the crosshair readout
 * (the one thing the market chart's own HUD cannot say — what the model predicted
 * on this bar, its P(up), the move its label is scored on, the trade it opened).
 *
 * It sits in the same layer as the market chart's HUD, the "Latest" button and the
 * label legend, and yields to them: the legend goes top-left under the HUD's own
 * line, the key and the follow control top-right beside the "Latest" button.
 */

import { useState } from "react";

import { REGIME_DEFINITIONS, REGIME_NAMES, REGIME_STYLES, regimeLabel } from "@shared/runs/regimeDefinitions";

import { regimeShares, regimeStyleOfBar } from "./regimes";
import { useCycleStore } from "./store";
import {
  CYCLE_COLORS,
  formatSignedUsd,
  GLYPH_FAINT_ALPHA,
  phaseWord,
  withAlpha,
  type BarReadout,
  type ForecastOnlyReadout,
} from "./chartModel";
import { runIsShown, type RunHoverState } from "./useRunOverlay";

function formatPrice(value: number): string {
  return Number.isInteger(value)
    ? value.toFixed(2)
    : value.toFixed(Math.min(5, Math.max(2, String(value).split(".")[1]?.length ?? 2)));
}

/** "+3.25" / "−1.50" (true minus sign), `decimals` places. */
function formatSignedPoints(value: number, decimals: number): string {
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(decimals)}`;
}

/** "+13 ticks" / "−6.5 ticks": whole ticks print without decimals. */
function formatSignedTicks(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const magnitude = Number.isInteger(rounded) ? Math.abs(rounded).toFixed(0) : String(Math.abs(rounded));
  return `${rounded < 0 ? "−" : "+"}${magnitude} ticks`;
}

function contractsWord(count: number): string {
  return count === 1 ? "1 contract" : `${count} contracts`;
}

function errorWord(errorPoints: number): string {
  return errorPoints > 0 ? "forecast too high" : errorPoints < 0 ? "forecast too low" : "exact";
}

/**
 * The label move: this close → the close `labelHorizonBars` later, in points,
 * ticks and USD. It is what the label is scored on, not what a trade made — the
 * trade line carries that.
 */
function LabelMoveLines({ readout, decimals }: { readout: BarReadout; decimals: number }) {
  const move = readout.labelMove;
  if (!move) return null;
  if (move.state === "pending") {
    return (
      <div className="mt-1 border-t border-white/10 pt-1" data-testid="cycle-chart-readout-label-move">
        <span className="text-muted-foreground">label move ({move.horizonBars} bars ahead):</span> …{" "}
        {move.resolutionTimeText ? `resolves at ${move.resolutionTimeText}` : `resolves ${move.horizonBars} bars later`}
      </div>
    );
  }
  const tone = move.movePoints > 0 ? CYCLE_COLORS.up : move.movePoints < 0 ? CYCLE_COLORS.down : undefined;
  return (
    <div className="mt-1 space-y-0.5 border-t border-white/10 pt-1" data-testid="cycle-chart-readout-label-move">
      <div>
        <span className="text-muted-foreground">label move ({move.horizonBars} bars ahead):</span> close{" "}
        {move.startClose.toFixed(decimals)} → {move.resolutionClose.toFixed(decimals)} at {move.resolutionTimeText}
      </div>
      <div style={tone ? { color: tone } : undefined}>
        {move.movePoints > 0 ? "▲ " : move.movePoints < 0 ? "▼ " : ""}
        {formatSignedPoints(move.movePoints, decimals)} points · {formatSignedTicks(move.moveTicks)} ·{" "}
        {formatSignedUsd(move.moveUsdPerContract)} per contract
        {move.contracts > 1 ? ` · ${formatSignedUsd(move.moveUsdAllContracts)} for ${contractsWord(move.contracts)}` : ""}
      </div>
      <div className="text-muted-foreground">
        the move the label is scored on, not a trade result
        {move.thresholdTicks > 0 ? ` · a move inside ±${move.thresholdTicks} ticks is not scored` : ""}
      </div>
    </div>
  );
}

function ForecastLines({ readout, decimals }: { readout: BarReadout; decimals: number }) {
  const target = readout.forecastForThisBar;
  const made = readout.forecastMadeHere;
  if (readout.role === "processed" && readout.hasPriceModel === false) {
    return (
      <div className="mt-1 border-t border-white/10 pt-1 text-muted-foreground" data-testid="cycle-chart-readout-forecast">
        no price model — this model has no regression form, so it makes no price forecast
      </div>
    );
  }
  if (!target && !made) return null;
  return (
    <div className="mt-1 space-y-0.5 border-t border-white/10 pt-1" data-testid="cycle-chart-readout-forecast">
      {made && (
        <div>
          <span style={{ color: CYCLE_COLORS.active }}>◆ </span>
          <span className="text-muted-foreground">this bar&apos;s forecast:</span> close {made.predictedClose.toFixed(decimals)} at{" "}
          {made.targetTimeText} ({formatSignedPoints(made.predictedMovePoints, decimals)} points from this close)
          {made.errorPoints !== null && made.actualClose !== null ? (
            <div className="pl-3">
              actual {made.actualClose.toFixed(decimals)} · error {formatSignedPoints(made.errorPoints, decimals)} points
              {made.errorTicks !== null ? ` (${formatSignedTicks(made.errorTicks)})` : ""}
              <span className="text-muted-foreground"> — {errorWord(made.errorPoints)}</span>
            </div>
          ) : (
            <div className="pl-3 text-muted-foreground">error known when that bar arrives</div>
          )}
        </div>
      )}
      {target && (
        <div>
          <span style={{ color: CYCLE_COLORS.active }}>┄ </span>
          <span className="text-muted-foreground">forecast for this bar (made at {target.madeAtText}):</span>{" "}
          {target.predictedClose.toFixed(decimals)} · actual close {target.actualClose.toFixed(decimals)} · error{" "}
          {formatSignedPoints(target.errorPoints, decimals)} points
          <span className="text-muted-foreground"> ({errorWord(target.errorPoints)})</span>
        </div>
      )}
    </div>
  );
}

/** The trade opened at the next bar's open on this bar's call, so the label move is not read as profit. */
function TradeLine({ readout, decimals }: { readout: BarReadout; decimals: number }) {
  const trade = readout.tradeAtNextOpen;
  if (!trade) return null;
  const long = trade.side === "long";
  const netTone = trade.netProfitUsd === null ? undefined : trade.netProfitUsd >= 0 ? CYCLE_COLORS.up : CYCLE_COLORS.down;
  return (
    <div className="mt-1 border-t border-white/10 pt-1" data-testid="cycle-chart-readout-trade">
      <span style={{ color: long ? CYCLE_COLORS.up : CYCLE_COLORS.down }}>{long ? "⇧ " : "⇩ "}</span>
      <span className="text-muted-foreground">{`trade ${long ? "L" : "S"}${trade.tradeNumber}:`}</span>{" "}
      {`${trade.side} ${contractsWord(trade.contracts)}, filled ${trade.fillPrice.toFixed(decimals)} at the next bar's open (${trade.entryTimeText}) · `}
      {trade.netProfitUsd === null ? (
        <span className="text-muted-foreground">still open</span>
      ) : (
        <span style={netTone ? { color: netTone } : undefined}>
          {`net ${formatSignedUsd(trade.netProfitUsd)} after costs${trade.exitTimeText ? `, exited ${trade.exitTimeText}` : ""}`}
        </span>
      )}
    </div>
  );
}

function RollLine({ readout, decimals }: { readout: BarReadout; decimals: number }) {
  const roll = readout.rollAdjustment;
  if (!roll) return null;
  const rolls = roll.rollCount === 1 ? "the roll" : `${roll.rollCount} rolls`;
  return (
    <div className="mt-1 border-t border-white/10 pt-1 text-muted-foreground" data-testid="cycle-chart-readout-roll">
      {`roll-adjusted price: ${formatSignedPoints(roll.shiftPoints, decimals)} points added for ${rolls} after this bar (next: ${roll.nextRollFromContract} → ${roll.nextRollToContract} at ${roll.nextRollTimeText}); the traded price was this less that`}
    </div>
  );
}

function ForecastOnlyBox({ forecast, decimals }: { forecast: ForecastOnlyReadout; decimals: number }) {
  return (
    <>
      <div className="text-foreground">{forecast.timeText}</div>
      <div className="text-muted-foreground">ahead of the newest candle — this bar has not arrived yet</div>
      <div className="mt-1">
        <span style={{ color: CYCLE_COLORS.active }}>┄ </span>
        <span className="text-muted-foreground">forecast for this bar (made at {forecast.madeAtText}):</span>{" "}
        {forecast.predictedClose.toFixed(decimals)}
      </div>
    </>
  );
}

function ReadoutBox({
  hover,
  decimals,
  pinnedTimestamp,
}: {
  hover: RunHoverState;
  decimals: number;
  pinnedTimestamp: number | null;
}) {
  const readout = hover.readout;
  const style = hover.placeLeft ? { right: `calc(100% - ${hover.x - 14}px)` } : { left: hover.x + 14 };
  const className =
    "pointer-events-none absolute top-24 z-20 min-w-[210px] max-w-[440px] rounded-md border border-white/15 bg-[rgba(11,15,22,0.92)] px-2.5 py-2 font-mono text-[11px] leading-[1.45] text-foreground/90 shadow-lg";
  if (!readout) {
    return hover.forecastOnly ? (
      <div className={className} style={style} data-testid="cycle-chart-readout">
        <ForecastOnlyBox forecast={hover.forecastOnly} decimals={decimals} />
      </div>
    ) : null;
  }
  const labelTone =
    readout.labelWord === "right" ? CYCLE_COLORS.up : readout.labelWord === "wrong" ? CYCLE_COLORS.neutral : undefined;
  const pinned = pinnedTimestamp !== null && pinnedTimestamp === readout.timestamp;
  const regime = regimeStyleOfBar(useCycleStore.getState().regimes, readout.timestamp);
  return (
    <div className={className} style={style} data-testid="cycle-chart-readout">
      <div className="text-foreground">{readout.timeText}</div>
      <div className="text-muted-foreground">
        {readout.role === "processed" ? "test bar — the model predicted it" : "context bar — the model was not tested here"}
      </div>
      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
        <span className="text-muted-foreground">open</span>
        <span>{formatPrice(readout.open)}</span>
        <span className="text-muted-foreground">high</span>
        <span>{formatPrice(readout.high)}</span>
        <span className="text-muted-foreground">low</span>
        <span>{formatPrice(readout.low)}</span>
        <span className="text-muted-foreground">close</span>
        <span>{formatPrice(readout.close)}</span>
        {readout.role === "processed" && (
          <>
            <span className="text-muted-foreground">P(up)</span>
            <span>{readout.probabilityUp === null ? "none" : readout.probabilityUp.toFixed(3)}</span>
            <span className="text-muted-foreground">predicts</span>
            <span>
              {readout.predictedDirectionWord === "up" ? "▲ " : readout.predictedDirectionWord === "down" ? "▼ " : ""}
              {readout.predictedDirectionWord}
            </span>
            {regime && (
              <>
                <span className="text-muted-foreground">regime</span>
                <span style={{ color: regime.color }} data-testid="cycle-chart-readout-regime">
                  {regimeLabel(regime)}
                </span>
              </>
            )}
            <span className="text-muted-foreground">position</span>
            <span>{readout.positionWord}</span>
            <span className="text-muted-foreground">equity</span>
            <span>{readout.equityUsd === null ? "none" : formatSignedUsd(readout.equityUsd)}</span>
            <span className="text-muted-foreground">label</span>
            <span style={labelTone ? { color: labelTone } : undefined} data-testid="cycle-chart-readout-label">
              {readout.labelGlyph} {readout.labelWord}
              {readout.actualDirectionWord ? ` (moved ${readout.actualDirectionWord})` : ""}
            </span>
          </>
        )}
      </div>
      <LabelMoveLines readout={readout} decimals={decimals} />
      <ForecastLines readout={readout} decimals={decimals} />
      <TradeLine readout={readout} decimals={decimals} />
      <RollLine readout={readout} decimals={decimals} />
      <div className="mt-1 border-t border-white/10 pt-1 text-muted-foreground" data-testid="cycle-chart-readout-pin">
        {pinned ? "pinned for Inside the model — click the bar again to unpin" : "click to pin this bar for Inside the model"}
      </div>
    </div>
  );
}

function Swatch({ color, border }: { color: string; border?: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: color, border: border ? `1px solid ${border}` : undefined }} />;
}

/**
 * The regimes of the walked bars: one chip per regime (its colour, glyph, word and
 * the share of walked bars it holds) and the switch that paints the candles with
 * them. Renders nothing for a model that sends no regimes.
 */
function RegimeLegend() {
  // the version is what changes; the regimes object is appended in place
  useCycleStore((state) => state.regimesVersion);
  const regimes = useCycleStore((state) => state.regimes);
  const shown = useCycleStore((state) => state.showRegimeColors);
  const setShown = useCycleStore((state) => state.setShowRegimeColors);
  if (regimes.byTimestamp.size === 0) return null;
  const how = REGIME_DEFINITIONS.regime_most_likely!;
  return (
    <div
      className="pointer-events-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 rounded border border-white/10 bg-[rgba(11,15,22,0.82)] px-2 py-0.5 font-mono text-[10px] text-foreground/90"
      data-testid="run-chart-regimes"
      title={`Most likely regime per walked bar\n\nHow it is computed: ${how.how}\n\nFormula: ${how.formula}`}
    >
      <button
        type="button"
        onClick={() => setShown(!shown)}
        className="rounded border border-white/15 px-1.5 hover:bg-white/10"
        aria-pressed={shown}
        data-testid="run-chart-regimes-toggle"
      >
        {shown ? "◼ candles by regime" : "◻ candles by regime"}
      </button>
      {regimeShares(regimes).map(({ style, share, barCount }) => (
        <span key={style.word} className="flex items-center gap-1" title={`${style.meaning} Most likely on ${barCount.toLocaleString()} of ${regimes.byTimestamp.size.toLocaleString()} walked bars.`}>
          <Swatch color={style.color} />
          <span style={{ color: style.color }}>{regimeLabel(style)}</span>
          <span className="text-muted-foreground">{(share * 100).toFixed(0)}%</span>
        </span>
      ))}
    </div>
  );
}

function ChartKey() {
  // Closed by default: open, it covers the newest candles at the top of the pane.
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-auto rounded-md border border-white/10 bg-[rgba(11,15,22,0.82)] px-2 py-1 text-[10px] leading-[1.5] text-foreground/80">
      <button type="button" className="font-mono text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
        {open ? "▾ Key" : "▸ Key"}
      </button>
      {open && (
        <div className="mt-0.5 max-w-[340px] space-y-0.5" data-testid="cycle-chart-key">
          <div className="text-muted-foreground">The model&apos;s call on each test bar:</div>
          <div>
            <span style={{ color: CYCLE_COLORS.up }}>▲</span> below the candle = predicts up ·{" "}
            <span style={{ color: CYCLE_COLORS.down }}>▼</span> above the candle = predicts down
          </div>
          <div>
            <span style={{ color: CYCLE_COLORS.up }}>▲</span> solid = proved right ·{" "}
            <span style={{ color: CYCLE_COLORS.up }}>△</span> hollow = wrong ·{" "}
            <span style={{ color: CYCLE_COLORS.up, opacity: GLYPH_FAINT_ALPHA }}>▲</span> faint = not known yet (or the
            move was too small to score)
          </div>
          <div>
            <span style={{ color: CYCLE_COLORS.active }}>┄┄</span> forecast: the price model&apos;s predicted close, drawn on
            the bar it is for, so it runs ahead of the newest candle. This line tracks the model&apos;s expected drift, not a
            price target — expect it to hug the close and miss sharp moves.
          </div>
          <div>
            <span style={{ color: CYCLE_COLORS.up }}>⇧</span> L&lt;n&gt; long entry ·{" "}
            <span style={{ color: CYCLE_COLORS.down }}>⇩</span> S&lt;n&gt; short entry (arrows with a trade number, beyond the
            call triangle)
          </div>
          <div>● exit (orange = profit, blue = loss, amount shown)</div>
          <div>
            a regime model&apos;s walked candles are painted by their most likely regime:{" "}
            {REGIME_NAMES.map((name, position) => (
              <span key={name}>
                {position > 0 ? " · " : ""}
                <span style={{ color: REGIME_STYLES[name].color }}>{regimeLabel(REGIME_STYLES[name])}</span>
              </span>
            ))}{" "}
            (the &quot;candles by regime&quot; switch above turns it off)
          </div>
          <div>the candles are the bars the model read, roll-adjusted; your indicators are computed on the same bars</div>
          <div>zoomed in (bars 14 px apart or wider): the forecast price is printed beyond each ▲ / ▼</div>
          <div>
            hover a test bar: a line from its close to the close one label horizon later (the move its label is scored on) and{" "}
            <span style={{ color: CYCLE_COLORS.active }}>◆</span> its forecast · click a bar to pin it for Inside the model,
            click it again to unpin
          </div>
          <div>P(up) and equity are panels below, with the rest of your indicators</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5">
            <span className="flex items-center gap-1">
              <Swatch color={withAlpha(CYCLE_COLORS.sky, 0.35)} border={CYCLE_COLORS.sky} /> training
            </span>
            <span className="flex items-center gap-1">
              <Swatch color={withAlpha(CYCLE_COLORS.yellow, 0.35)} border={CYCLE_COLORS.yellow} /> validation
            </span>
            <span className="flex items-center gap-1">
              <Swatch color={withAlpha(CYCLE_COLORS.up, 0.25)} border={CYCLE_COLORS.up} /> test walk
            </span>
            <span className="flex items-center gap-1">
              <Swatch color={withAlpha(CYCLE_COLORS.active, 0.45)} border={CYCLE_COLORS.active} /> working on now
            </span>
            <span className="flex items-center gap-1">
              <span style={{ color: CYCLE_COLORS.active }}>┊</span> model is here
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The run's chrome over the market chart. Renders nothing unless a run is shown,
 * so the page does not have to decide when it appears.
 */
export function RunChartChrome({ hover }: { hover: RunHoverState | null }) {
  const active = useCycleStore(runIsShown);
  const plan = useCycleStore((state) => state.plan);
  const modelType = useCycleStore((state) => state.modelType);
  const cursor = useCycleStore((state) => state.cursor);
  const barCount = useCycleStore((state) => state.barCount);
  const follow = useCycleStore((state) => state.follow);
  const setFollow = useCycleStore((state) => state.setFollow);
  const setShowOnChart = useCycleStore((state) => state.setShowOnChart);
  const pinnedTimestamp = useCycleStore((state) =>
    state.inspectSource === "pinned" ? state.inspectTimestamp : null,
  );

  if (!active) return null;

  const legend = [plan?.symbol, plan?.timeframe, plan?.modelLabel ?? modelType].filter(Boolean).join(" · ");
  const decimals = plan ? Math.max(0, Math.ceil(-Math.log10(plan.costModel.tickSize))) : 2;

  return (
    <>
      <div className="pointer-events-none absolute left-2 top-8 z-10 flex items-center gap-2 font-mono text-[11px]" data-testid="run-chart-legend">
        <span className="text-foreground/90">{legend || "Model cycle"}</span>
        <span className="text-muted-foreground">·</span>
        <span style={{ color: CYCLE_COLORS.active }}>{phaseWord(cursor)}</span>
        <span className="text-muted-foreground">· {barCount.toLocaleString()} bars read</span>
      </div>

      <div className="absolute right-[72px] top-1 z-10 flex max-w-[360px] flex-col items-end gap-1">
        {follow ? (
          <span className="rounded border border-white/10 bg-[rgba(11,15,22,0.8)] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            ◉ following the model
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setFollow(true)}
            className="rounded border px-2 py-0.5 font-mono text-[11px] text-foreground hover:bg-white/10"
            style={{ borderColor: CYCLE_COLORS.active, background: "rgba(11,15,22,0.9)" }}
            data-testid="cycle-chart-follow"
          >
            ◎ Follow the model
          </button>
        )}
        <RegimeLegend />
        <ChartKey />
        <button
          type="button"
          onClick={() => setShowOnChart(false)}
          className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-foreground/90 hover:bg-white/10"
          data-testid="run-chart-hide"
          title="Stop drawing this run on the chart and go back to the market's own bars"
        >
          ← Market bars
        </button>
      </div>

      {barCount === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-xs text-muted-foreground">
          Waiting for the model to read its first bars…
        </div>
      )}

      {hover && <ReadoutBox hover={hover} decimals={decimals} pinnedTimestamp={pinnedTimestamp} />}
    </>
  );
}
