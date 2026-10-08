/**
 * The most likely regime of every bar a regime model has walked, as the Market
 * chart reads it: one entry per bar timestamp, fed by the run's
 * `cycle_regime_forecast` stretches (live) or by its recorded forecasts
 * (`CycleSnapshot.regimeForecasts`, `RunView.regimeForecasts`).
 *
 * Held mutable with a version counter, like the run's bars: a stretch appends in
 * place. The regime of a bar is the NAME the engine sent (`flat`, `uptrend`,
 * `downtrend`); its colour, glyph and word come from the one table in
 * `@shared/runs/regimeDefinitions`.
 */
import type { CycleRegimeForecast } from "@shared/cycle/schema";
import { regimePosition, regimeStyleAt, type RegimeStyle } from "@shared/runs/regimeDefinitions";

export interface RunRegimes {
  /** The regimes' names in the engine's order; empty until a forecast arrives. */
  names: string[];
  /** Bar timestamp (epoch seconds) → position in `names` of its most likely regime. */
  byTimestamp: Map<number, number>;
  /** Bars whose most likely regime is each of `names`. */
  counts: number[];
}

export type RegimeForecastStretch = Pick<CycleRegimeForecast, "regimeCount" | "regimeNames" | "timestamps" | "mostLikelyRegime">;

export function emptyRunRegimes(): RunRegimes {
  return { names: [], byTimestamp: new Map(), counts: [] };
}

/** Fold one stretch (or one whole fold) into `regimes` IN PLACE; returns how many bars changed. */
export function appendRegimeForecast(regimes: RunRegimes, forecast: RegimeForecastStretch): number {
  const names = forecast.regimeNames ?? Array.from({ length: forecast.regimeCount }, (_, position) => `regime ${position + 1}`);
  if (names.length !== regimes.names.length || names.some((name, position) => name !== regimes.names[position])) {
    regimes.names = [...names];
    while (regimes.counts.length < names.length) regimes.counts.push(0);
  }
  let changed = 0;
  forecast.timestamps.forEach((timestamp, bar) => {
    const position = regimePosition(names, forecast.mostLikelyRegime[bar]);
    if (position === null || position >= names.length) return;
    const previous = regimes.byTimestamp.get(timestamp);
    if (previous === position) return;
    if (previous !== undefined) regimes.counts[previous] = Math.max(0, (regimes.counts[previous] ?? 0) - 1);
    regimes.byTimestamp.set(timestamp, position);
    regimes.counts[position] = (regimes.counts[position] ?? 0) + 1;
    changed += 1;
  });
  return changed;
}

/** The regimes of every fold of a recorded run. */
export function regimesOf(forecasts: readonly RegimeForecastStretch[] | undefined): RunRegimes {
  const regimes = emptyRunRegimes();
  for (const forecast of forecasts ?? []) appendRegimeForecast(regimes, forecast);
  return regimes;
}

/** The style (colour, glyph, word) of the bar at `timestamp`; null when no regime model spoke for it. */
export function regimeStyleOfBar(regimes: RunRegimes, timestamp: number): RegimeStyle | null {
  const position = regimes.byTimestamp.get(timestamp);
  return position === undefined ? null : regimeStyleAt(regimes.names, position);
}

export interface RegimeShare {
  style: RegimeStyle;
  barCount: number;
  /** barCount over the bars that carry a regime; 0 when none does. */
  share: number;
}

/** One row per regime, in the engine's order: how many walked bars it holds and their share. */
export function regimeShares(regimes: RunRegimes): RegimeShare[] {
  const total = regimes.byTimestamp.size;
  return regimes.names.map((_, position) => {
    const barCount = regimes.counts[position] ?? 0;
    return { style: regimeStyleAt(regimes.names, position), barCount, share: total > 0 ? barCount / total : 0 };
  });
}
