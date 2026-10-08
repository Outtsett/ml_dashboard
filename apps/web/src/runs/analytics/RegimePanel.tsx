/**
 * The regime Monte Carlo decision model, bar by bar: which of the three regimes
 * (— flat, ▲ uptrend, ▼ downtrend; fixed colours from
 * `@shared/runs/regimeDefinitions`) the forward filter puts each test bar in
 * (stacked bands by name), the decision model's
 * P(up) against its trade gate, and — at the chosen bar — the Monte Carlo fan
 * (10th / 50th / 90th percentile of the simulated moves, step by step to the
 * horizon) with Kronos' predicted candles drawn over it, plus the decision
 * model's feature weights, each regime's feature means in words, its return
 * distribution and the transition matrix labelled flat / uptrend / downtrend. Reads the run view (`cycle_regime_forecast`, merged per
 * fold); nothing here fetches. Every number's hover says how it is computed
 * (`@shared/runs/regimeDefinitions`). Okabe-Ito only; up is orange and hollow,
 * down is blue and filled, so colour is never the only signal.
 */
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { RunRegimeForecast } from "@shared/runs/types";
import { REGIME_FEATURE_WORDS, regimeLabel, regimePosition, regimeStyleAt } from "@shared/runs/regimeDefinitions";
import { Chip } from "@/runs/learning";
import { formatBarTime } from "@/runs/barTime";
import { howComputedRegime } from "@/runs/howComputed";

const AXIS = { fontSize: 10, fill: "hsl(var(--muted-foreground))", fontFamily: "ui-monospace, monospace" } as const;
const GRID = "hsl(var(--border))";
const TOOLTIP_STYLE = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11, fontFamily: "ui-monospace, monospace" } as const;
const UP = "#E69F00";
const DOWN = "#0072B2";
const FAN = "#56B4E9";
const MEDIAN = "#0072B2";
const KRONOS = "#CC79A7";
/** Bars drawn per fold in the time charts: thinned by row count, never by clock span. */
const MAX_DRAWN_BARS = 600;

function thin<T>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  const step = rows.length / limit;
  const out: T[] = [];
  for (let position = 0; position < limit; position += 1) out.push(rows[Math.floor(position * step)]!);
  return out;
}

function points(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)} pt`;
}

function share(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

/** The bar of `fold` nearest to `seconds` (by time), or the last bar. */
function barNearest(fold: RunRegimeForecast, seconds: number | null): number {
  const count = fold.timestamps.length;
  if (count === 0) return 0;
  if (seconds === null) return count - 1;
  let best = 0;
  for (let bar = 1; bar < count; bar += 1) {
    if (Math.abs(fold.timestamps[bar]! - seconds) < Math.abs(fold.timestamps[best]! - seconds)) best = bar;
  }
  return best;
}

export function RegimePanel({ forecasts, modelLabel, focusTime, onFocusTime }: {
  forecasts: RunRegimeForecast[];
  modelLabel: string | null;
  focusTime: number | null;
  onFocusTime: (seconds: number) => void;
}) {
  const [foldPosition, setFoldPosition] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const fold = forecasts[Math.min(foldPosition, Math.max(0, forecasts.length - 1))] ?? null;

  if (fold === null) {
    return (
      <div className="rounded-md border border-border bg-card/60 p-3" data-testid="regime-forecast">
        <div className="text-[12px] font-semibold text-foreground">Regimes, the simulated fan, Kronos' candles and the trade gate</div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          {modelLabel ? `${modelLabel} sends no regime forecasts: only the regime Monte Carlo decision stack does. ` : ""}
          Its bars stream in as each fold's test walk goes, and land beside the run's artifacts at the end of every fold.
        </div>
      </div>
    );
  }

  const count = fold.timestamps.length;
  // the run page's shared focus (a click on its bar chart or here) picks the bar; the scrubber's own choice otherwise
  const bar = Math.min(Math.max(0, focusTime !== null ? barNearest(fold, focusTime) : chosen ?? count - 1), Math.max(0, count - 1));
  const choose = (position: number) => {
    const clamped = Math.min(Math.max(0, position), count - 1);
    setChosen(clamped);
    const seconds = fold.timestamps[clamped];
    if (seconds !== undefined) onFocusTime(seconds);
  };
  const positionOf = new Map(fold.timestamps.map((time, position) => [time, position] as const));

  const bandRows = thin(
    fold.timestamps.map((time, position) => {
      const row: Record<string, number | null> = { time, decision: fold.decisionProbabilityUp[position] ?? null, gate: fold.gateOpen[position] ? 1 : 0 };
      fold.regimeProbabilities[position]?.forEach((probability, regime) => {
        row[`regime_${regime}`] = hidden.has(regime) ? 0 : probability;
      });
      return row;
    }),
    MAX_DRAWN_BARS,
  );
  const threshold = fold.decisionThreshold;
  const opened = fold.gateOpen.filter(Boolean).length;
  const styles = Array.from({ length: fold.regimeCount }, (_, regime) => regimeStyleAt(fold.regimeNames, regime));
  const occupancy = Array.from({ length: fold.regimeCount }, () => 0);
  for (const value of fold.mostLikelyRegime) {
    const position = regimePosition(fold.regimeNames, value);
    if (position !== null && position < occupancy.length) occupancy[position]! += 1;
  }
  const time = fold.timestamps[bar] ?? 0;
  const regimeNow = fold.regimeProbabilities[bar] ?? [];
  const likelyNow = regimePosition(fold.regimeNames, fold.mostLikelyRegime[bar]);

  const clickChart = (state: { activeLabel?: string | number } | null) => {
    const label = state?.activeLabel;
    if (label === undefined) return;
    const position = positionOf.get(Number(label));
    if (position !== undefined) choose(position);
  };

  return (
    <div className="rounded-md border border-border bg-card/60 p-3" data-testid="regime-forecast">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-foreground">Regimes, the simulated fan, Kronos' candles and the trade gate</div>
          <div className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
            Think of it as four analysts handing notes to one trader. The hidden Markov model says whether this bar is {styles.map((style) => regimeLabel(style)).join(", ")}
            {" "}(from ADX, candle bodies, range compression and the swing highs and lows confirmed so far); the Monte Carlo
            simulation runs that kind of market {fold.horizonBars} bars forward {fold.simulationCount.toLocaleString("en-US")} times; Kronos sketches the next
            {" "}{fold.horizonBars} candles; FinBERT reads the news. The trader (the decision model) weighs the notes and trades only when it is at least
            {" "}{share(threshold)} away from a coin flip. Click a bar or drag the scrubber.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {forecasts.map((entry, position) => (
            <Chip key={entry.foldIndex ?? position} active={position === foldPosition} onClick={() => { setFoldPosition(position); setChosen(null); }}>
              Fold {(entry.foldIndex ?? 0) + 1}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
        {occupancy.map((bars, regime) => (
          <button
            key={regime}
            type="button"
            className={`flex cursor-pointer items-center gap-1 ${hidden.has(regime) ? "opacity-40" : ""}`}
            title={`${howComputedRegime("regime_most_likely", regimeLabel(styles[regime]!))}\n\n${styles[regime]!.meaning}\n\nClick to hide or show this regime's band.`}
            onClick={() => setHidden((previous) => {
              const next = new Set(previous);
              if (next.has(regime)) next.delete(regime); else next.add(regime);
              return next;
            })}
          >
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: styles[regime]!.color }} />
            <span style={{ color: styles[regime]!.color }}>{regimeLabel(styles[regime]!)}</span>: most likely on {share(bars / Math.max(count, 1))} of the fold
          </button>
        ))}
        <span title={howComputedRegime("trade_gate", "Trade gate")}>· gate open on {opened.toLocaleString("en-US")} of {count.toLocaleString("en-US")} bars ({share(opened / Math.max(count, 1))})</span>
      </div>

      <div className="mt-2 grid gap-3 xl:grid-cols-2">
        <div>
          <div className="font-mono text-[10px] text-muted-foreground" title={howComputedRegime("regime_probability", "Filtered regime probability")}>
            Filtered regime probability per bar (stacks to 100%)
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={bandRows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} stackOffset="expand" onClick={clickChart}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
                <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} tickFormatter={(value: number) => formatBarTime(value).slice(5)} minTickGap={60} />
                <YAxis tick={AXIS} width={36} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(value: number) => formatBarTime(value)} formatter={(value: number, name: string) => [share(value), name]} />
                {Array.from({ length: fold.regimeCount }, (_, regime) => (
                  <Area key={regime} dataKey={`regime_${regime}`} name={regimeLabel(styles[regime]!)} stackId="regimes" stroke="none" fill={styles[regime]!.color} fillOpacity={0.85} isAnimationActive={false} />
                ))}
                <ReferenceLine x={time} stroke="hsl(var(--foreground))" strokeDasharray="3 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] text-muted-foreground" title={howComputedRegime("decision_probability_up", "Decision model P(up)")}>
            Decision model P(up); the shaded band is where the gate stays closed (within {share(threshold)} of 0.5)
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={bandRows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} onClick={clickChart}>
                <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
                <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} tickFormatter={(value: number) => formatBarTime(value).slice(5)} minTickGap={60} />
                <YAxis tick={AXIS} width={36} domain={[0, 1]} tickFormatter={(value: number) => value.toFixed(2)} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(value: number) => formatBarTime(value)} formatter={(value: number, name: string) => [name === "gate" ? (value ? "open" : "closed") : Number(value).toFixed(3), name]} />
                <ReferenceArea y1={0.5 - threshold} y2={0.5 + threshold} fill="#808A99" fillOpacity={0.15} />
                <ReferenceLine y={0.5} stroke="#808A99" strokeDasharray="6 3" />
                <Line dataKey="decision" name="decision P(up)" stroke={UP} strokeWidth={1.2} dot={false} isAnimationActive={false} connectNulls />
                <ReferenceLine x={time} stroke="hsl(var(--foreground))" strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px]">
        <button type="button" className="cursor-pointer rounded border border-border px-2" onClick={() => choose(bar - 1)} aria-label="previous bar">◀</button>
        <input
          type="range"
          min={0}
          max={Math.max(0, count - 1)}
          value={bar}
          onChange={(event) => choose(Number(event.target.value))}
          className="w-64"
          aria-label="chosen bar"
        />
        <button type="button" className="cursor-pointer rounded border border-border px-2" onClick={() => choose(bar + 1)} aria-label="next bar">▶</button>
        <span className="text-muted-foreground">bar {bar + 1} of {count.toLocaleString("en-US")} · {formatBarTime(time)} · close {fold.close[bar]?.toFixed(2) ?? "n/a"}</span>
        {likelyNow !== null && styles[likelyNow] && (
          <span data-testid="regime-now" style={{ color: styles[likelyNow]!.color }} title={howComputedRegime("regime_most_likely", "Most likely regime at this bar")}>
            · {regimeLabel(styles[likelyNow]!)}
          </span>
        )}
      </div>

      <div className="mt-2 grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <FanChart fold={fold} bar={bar} />
        <BarReadout fold={fold} bar={bar} regimeNow={regimeNow} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <FeatureWeights fold={fold} />
        <RegimeTable fold={fold} />
      </div>
    </div>
  );
}

/** The fan and Kronos' candles at one bar, in one price scale (custom SVG so both share it). */
function FanChart({ fold, bar }: { fold: RunRegimeForecast; bar: number }) {
  const close = fold.close[bar] ?? null;
  const horizon = fold.horizonBars;
  const low = fold.monteCarloPercentile10Points[bar] ?? [];
  const median = fold.monteCarloPercentile50Points[bar] ?? [];
  const high = fold.monteCarloPercentile90Points[bar] ?? [];
  const candles = Array.from({ length: horizon }, (_, step) => ({
    open: fold.kronosOpen[bar]?.[step] ?? null,
    high: fold.kronosHigh[bar]?.[step] ?? null,
    low: fold.kronosLow[bar]?.[step] ?? null,
    close: fold.kronosClose[bar]?.[step] ?? null,
  }));
  if (close === null) return <div className="text-[11px] text-muted-foreground">No close at this bar.</div>;
  // the fan carries moves in points from this close; Kronos' candles carry prices
  const fanPrice = (move: number | null | undefined) => (move === null || move === undefined ? null : close + move);
  const prices: number[] = [close];
  for (let step = 0; step < horizon; step += 1) {
    for (const price of [fanPrice(low[step]), fanPrice(high[step]), candles[step]!.low, candles[step]!.high]) {
      if (price !== null && Number.isFinite(price)) prices.push(price);
    }
  }
  const top = Math.max(...prices);
  const bottom = Math.min(...prices);
  const span = Math.max(top - bottom, 1e-6);
  const width = 520;
  const height = 220;
  const left = 56;
  const right = 12;
  const pad = 14;
  const x = (step: number) => left + (step / horizon) * (width - left - right);
  const y = (price: number) => pad + (1 - (price - bottom) / span) * (height - 2 * pad);
  const bandTop = [`${x(0)},${y(close)}`, ...high.map((move, step) => `${x(step + 1)},${y(fanPrice(move) ?? close)}`)];
  const bandBottom = [...low.map((move, step) => `${x(step + 1)},${y(fanPrice(move) ?? close)}`).reverse(), `${x(0)},${y(close)}`];
  const medianPath = [`M ${x(0)} ${y(close)}`, ...median.map((move, step) => `L ${x(step + 1)} ${y(fanPrice(move) ?? close)}`)].join(" ");
  const candleWidth = Math.max(4, ((width - left - right) / horizon) * 0.35);
  const ticks = [bottom, bottom + span / 2, top];
  return (
    <div>
      <div className="font-mono text-[10px] text-muted-foreground" title={howComputedRegime("monte_carlo_fan", "Monte Carlo fan")}>
        Monte Carlo fan from this close (band = 10th–90th percentile of {fold.simulationCount.toLocaleString("en-US")} simulated paths, line = 50th) with Kronos' {horizon} predicted candles
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" role="img" aria-label="Monte Carlo fan and Kronos candles">
        {ticks.map((price) => (
          <g key={price}>
            <line x1={left} x2={width - right} y1={y(price)} y2={y(price)} stroke="hsl(var(--border))" strokeDasharray="2 4" />
            <text x={left - 4} y={y(price) + 3} textAnchor="end" fontSize={9} fill="hsl(var(--muted-foreground))" fontFamily="ui-monospace, monospace">{price.toFixed(2)}</text>
          </g>
        ))}
        {Array.from({ length: horizon + 1 }, (_, step) => (
          <text key={step} x={x(step)} y={height - 2} textAnchor="middle" fontSize={9} fill="hsl(var(--muted-foreground))" fontFamily="ui-monospace, monospace">{step === 0 ? "now" : `+${step}`}</text>
        ))}
        <polygon points={[...bandTop, ...bandBottom].join(" ")} fill={FAN} fillOpacity={0.3} stroke="none">
          <title>{howComputedRegime("monte_carlo_fan", "10th to 90th percentile band")}</title>
        </polygon>
        <path d={medianPath} fill="none" stroke={MEDIAN} strokeWidth={1.6}>
          <title>{howComputedRegime("monte_carlo_fan", "50th percentile path")}</title>
        </path>
        {candles.map((candle, step) => {
          if (candle.open === null || candle.close === null || candle.high === null || candle.low === null) return null;
          const rising = candle.close >= candle.open;
          const center = x(step + 1);
          const bodyTop = y(Math.max(candle.open, candle.close));
          const bodyHeight = Math.max(1, Math.abs(y(candle.open) - y(candle.close)));
          return (
            <g key={step}>
              <title>{`${howComputedRegime("kronos_candles", `Kronos candle +${step + 1}`)}\n\nopen ${candle.open.toFixed(2)} · high ${candle.high.toFixed(2)} · low ${candle.low.toFixed(2)} · close ${candle.close.toFixed(2)} (${rising ? "rising: hollow, orange" : "falling: filled, blue"})`}</title>
              <line x1={center} x2={center} y1={y(candle.high)} y2={y(candle.low)} stroke={KRONOS} strokeWidth={1.2} />
              <rect x={center - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} fill={rising ? "transparent" : DOWN} stroke={rising ? UP : DOWN} strokeWidth={1.4} />
            </g>
          );
        })}
        <circle cx={x(0)} cy={y(close)} r={3} fill="hsl(var(--foreground))">
          <title>{`This bar's close: ${close.toFixed(2)}`}</title>
        </circle>
      </svg>
      <div className="flex flex-wrap gap-x-4 font-mono text-[10px] text-muted-foreground">
        <span><span className="inline-block h-2 w-3 align-middle" style={{ backgroundColor: FAN, opacity: 0.5 }} /> 10th–90th percentile of the simulated move</span>
        <span><span className="inline-block h-0.5 w-3 align-middle" style={{ backgroundColor: MEDIAN }} /> 50th percentile</span>
        <span>Kronos candle: hollow orange = rising, filled blue = falling, wick = predicted high to low</span>
      </div>
    </div>
  );
}

function BarReadout({ fold, bar, regimeNow }: { fold: RunRegimeForecast; bar: number; regimeNow: (number | null)[] }) {
  const gate = fold.gateOpen[bar] ?? false;
  const decision = fold.decisionProbabilityUp[bar] ?? null;
  const rows: { label: string; value: string; name: string }[] = [
    { label: "Monte Carlo P(up)", value: share(fold.monteCarloProbabilityUp[bar]), name: "monte_carlo_probability_up" },
    { label: "Monte Carlo expected move", value: points(fold.monteCarloExpectedMovePoints[bar]), name: "monte_carlo_expected_move_points" },
    { label: "Kronos predicted move", value: points(fold.kronosPredictedMovePoints[bar]), name: "kronos_predicted_move_points" },
    { label: "Decision model P(up)", value: share(decision), name: "decision_probability_up" },
  ];
  return (
    <div className="space-y-2 font-mono text-[11px]">
      <div title={howComputedRegime("regime_probability", "Filtered regime probability at this bar")}>
        <div className="text-[10px] text-muted-foreground">Regime probability at this bar</div>
        {regimeNow.map((probability, regime) => (
          <div key={regime} className="flex items-center gap-2">
            <span className="w-24" style={{ color: regimeStyleAt(fold.regimeNames, regime).color }}>{regimeLabel(regimeStyleAt(fold.regimeNames, regime))}</span>
            <span className="relative h-2 flex-1 rounded-sm bg-border">
              <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.max(0, Math.min(1, probability ?? 0)) * 100}%`, backgroundColor: regimeStyleAt(fold.regimeNames, regime).color }} />
            </span>
            <span className="w-14 text-right">{share(probability)}</span>
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-2 border-b border-border/50 pb-0.5" title={howComputedRegime(row.name, row.label)}>
          <span className="text-muted-foreground">{row.label}</span>
          <span>{row.value}</span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2" title={howComputedRegime("trade_gate", "Trade gate")}>
        <span className="text-muted-foreground">Trade gate</span>
        <span style={{ color: gate ? UP : undefined }}>
          {gate ? "● open: the engine may enter" : "○ closed: the engine stands aside"}
        </span>
      </div>
      <div className="text-[10px] leading-snug text-muted-foreground">
        The gate opens when the decision model's P(up) is at least {share(fold.decisionThreshold)} away from 0.5 ({decision === null ? "no probability at this bar" : `here ${share(Math.abs(decision - 0.5))} away`}).
      </div>
    </div>
  );
}

function FeatureWeights({ fold }: { fold: RunRegimeForecast }) {
  const largest = Math.max(1e-9, ...fold.featureWeights.map((item) => item.gainShare ?? 0));
  return (
    <div title={howComputedRegime("feature_weight", "Decision model feature weight")}>
      <div className="font-mono text-[10px] text-muted-foreground">What the decision model leaned on (share of total gain)</div>
      <div className="mt-1 space-y-0.5 font-mono text-[10px]">
        {fold.featureWeights.map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <span className="w-64 truncate" title={howComputedRegime("feature_weight", item.name)}>{item.name.replace(/_/g, " ")}</span>
            <span className="relative h-2 flex-1 rounded-sm bg-border">
              <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${((item.gainShare ?? 0) / largest) * 100}%`, backgroundColor: item.name.startsWith("finbert_") ? "#CC79A7" : item.name.startsWith("kronos_") ? "#E69F00" : item.name.startsWith("monte_carlo_") ? "#56B4E9" : "#0072B2" }} />
            </span>
            <span className="w-14 text-right">{share(item.gainShare)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">Colour by source: dark blue regime model · sky blue Monte Carlo · orange Kronos · purple FinBERT news</div>
    </div>
  );
}

function RegimeTable({ fold }: { fold: RunRegimeForecast }) {
  const styles = fold.regimes.map((_, position) => regimeStyleAt(fold.regimeNames, position));
  const featureNames = fold.regimes[0]?.featureMeans?.map((item) => item.name) ?? [];
  return (
    <div className="font-mono text-[10px]">
      <div className="text-muted-foreground" title={howComputedRegime("regime_summary", "Each regime on the training span")}>
        Each regime on the training span: how long it lasts and its one-bar log return (Student-t)
      </div>
      <table className="mt-1 w-full" data-testid="regime-table">
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-left">regime</th>
            <th className="text-right">stays</th>
            <th className="text-right">bars per visit</th>
            <th className="text-right">training bars</th>
            <th className="text-right">mean return</th>
            <th className="text-right">deviation</th>
            <th className="text-right">degrees of freedom</th>
          </tr>
        </thead>
        <tbody>
          {fold.regimes.map((regime, position) => (
            <tr key={regime.regime} title={`${howComputedRegime("regime_summary", regimeLabel(styles[position]!))}${regime.description ? `\n\n${regime.description}` : ""}`}>
              <td>
                <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: styles[position]!.color }} />
                <span style={{ color: styles[position]!.color }}>{regimeLabel(styles[position]!)}</span>{regime.pooled ? " (pooled)" : ""}
              </td>
              <td className="text-right">{share(regime.stayProbability)}</td>
              <td className="text-right">{regime.expectedBarsPerVisit === null || regime.expectedBarsPerVisit === undefined ? "n/a" : regime.expectedBarsPerVisit.toFixed(0)}</td>
              <td className="text-right">{regime.trainingBarCount.toLocaleString("en-US")}</td>
              <td className="text-right">{regime.meanLogReturn.toExponential(2)}</td>
              <td className="text-right">{regime.volatilityLogReturn === null ? "n/a" : regime.volatilityLogReturn.toExponential(2)}</td>
              <td className="text-right">{regime.degreesOfFreedom.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {featureNames.length > 0 && (
        <>
          <div className="mt-2 text-muted-foreground" title={howComputedRegime("regime_features", "Observation features of the regime model")}>
            What each regime looks like: the mean of every feature the model reads, on the training span
            <span title={howComputedRegime("regime_training", "How the regime model is trained")}> · how it is trained ⓘ</span>
          </div>
          <table className="mt-1 w-full" data-testid="regime-feature-means">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left">feature</th>
                {styles.map((style) => (
                  <th key={style.word} className="text-right" style={{ color: style.color }}>{regimeLabel(style)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {featureNames.map((name, row) => {
                const words = REGIME_FEATURE_WORDS[name];
                return (
                  <tr key={name} title={howComputedRegime("regime_features", words?.words ?? name)}>
                    <td>{words?.words ?? fold.regimes[0]?.featureMeans?.[row]?.words ?? name.replace(/_/g, " ")}{words ? ` (${words.unit})` : ""}</td>
                    {fold.regimes.map((regime) => (
                      <td key={regime.regime} className="text-right">{regime.featureMeans?.[row]?.value.toFixed(2) ?? "n/a"}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      <div className="mt-2 text-muted-foreground" title={howComputedRegime("transition_matrix", "Transition matrix")}>Transition matrix: row = this bar's regime, column = the next bar's</div>
      <table className="mt-1" data-testid="regime-transition-matrix">
        <thead className="text-muted-foreground">
          <tr>
            <th />
            {styles.map((style) => (
              <th key={style.word} className="px-1 text-center" style={{ color: style.color }}>to {regimeLabel(style)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fold.transitionMatrix.map((row, from) => (
            <tr key={from}>
              <td className="pr-2" style={{ color: styles[from]?.color }}>from {styles[from] ? regimeLabel(styles[from]!) : from + 1}</td>
              {row.map((value, to) => (
                <td key={to} className="px-1 text-center" style={{ backgroundColor: `rgba(0, 114, 178, ${Math.max(0, Math.min(1, value ?? 0)) * 0.6})` }} title={`${howComputedRegime("transition_matrix", `From ${styles[from]?.word ?? from + 1} to ${styles[to]?.word ?? to + 1}`)}\n\nValue: ${share(value)}`}>
                  {share(value, 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
