/**
 * X variables computed from the bars themselves.
 *
 * Every one is causal: the value on bar t uses bars up to and including t,
 * and a window that is not yet full is null (never zero), so warm-up bars
 * simply drop out of the regression. They reuse the chart indicator
 * calculators, so "RSI 14" here is the RSI 14 the chart draws.
 */

import type { OhlcvData } from "@/market/components/types";
import type { SeriesFamily } from "@shared/series/types";
import { sma, trueRange, wilderSmooth, rollingMax, rollingMin } from "@/market/lib/calculators/math_primitives";
import { rsiFromValues } from "@/market/lib/calculators/momentum/utils";

export interface BarVariable {
  /** "bar:<name>" — never collides with a lake catalog id. */
  id: string;
  label: string;
  family: SeriesFamily;
  /** How it is computed, in plain words. */
  definition: string;
  /**
   * Built from the close. Against the close itself (the Level view) part of
   * the relationship is arithmetic, not market behaviour.
   */
  containsClose: boolean;
  compute(bars: ReadonlyArray<OhlcvData>): Array<number | null>;
}

const BASIS_POINTS = 10_000;

function closes(bars: ReadonlyArray<OhlcvData>): number[] {
  return bars.map((bar) => bar.close);
}

function oneBarLogReturns(bars: ReadonlyArray<OhlcvData>): Array<number | null> {
  return bars.map((bar, index) => {
    if (index === 0) return null;
    const previous = bars[index - 1]!.close;
    return previous > 0 && bar.close > 0 ? BASIS_POINTS * Math.log(bar.close / previous) : null;
  });
}

/** Sample (n − 1) standard deviation of the last `window` values; null until full. */
function rollingSampleDeviation(values: ReadonlyArray<number | null>, window: number): Array<number | null> {
  return values.map((_value, index) => {
    if (index + 1 < window) return null;
    let sum = 0;
    for (let offset = index - window + 1; offset <= index; offset += 1) {
      const value = values[offset];
      if (value === null || value === undefined) return null;
      sum += value;
    }
    const mean = sum / window;
    let squares = 0;
    for (let offset = index - window + 1; offset <= index; offset += 1) {
      const delta = (values[offset] as number) - mean;
      squares += delta * delta;
    }
    return Math.sqrt(squares / (window - 1));
  });
}

export const BAR_VARIABLES: BarVariable[] = [
  {
    id: "bar:volume",
    label: "Volume (contracts)",
    family: "volume",
    definition: "Contracts traded in the bar.",
    containsClose: false,
    compute: (bars) => bars.map((bar) => (Number.isFinite(bar.volume) ? bar.volume : null)),
  },
  {
    id: "bar:bar_range_points",
    label: "Bar range (points)",
    family: "volatility",
    definition: "High minus low.",
    containsClose: false,
    compute: (bars) => bars.map((bar) => bar.high - bar.low),
  },
  {
    id: "bar:candle_body_points",
    label: "Candle body (points, signed)",
    family: "price_structure",
    definition: "Close minus open: positive for a rising bar, negative for a falling one.",
    containsClose: true,
    compute: (bars) => bars.map((bar) => bar.close - bar.open),
  },
  {
    id: "bar:upper_wick_points",
    label: "Upper wick (points)",
    family: "price_structure",
    definition: "High minus the larger of open and close.",
    containsClose: true,
    compute: (bars) => bars.map((bar) => bar.high - Math.max(bar.open, bar.close)),
  },
  {
    id: "bar:lower_wick_points",
    label: "Lower wick (points)",
    family: "price_structure",
    definition: "The smaller of open and close, minus the low.",
    containsClose: true,
    compute: (bars) => bars.map((bar) => Math.min(bar.open, bar.close) - bar.low),
  },
  {
    id: "bar:log_return_one_bar_basis_points",
    label: "One-bar log return (basis points)",
    family: "momentum",
    definition: "10,000 × ln(close ÷ previous close).",
    containsClose: true,
    compute: oneBarLogReturns,
  },
  {
    id: "bar:realized_volatility_20_bars_basis_points",
    label: "Realized volatility, 20 bars (basis points)",
    family: "volatility",
    definition: "Sample standard deviation of the last 20 one-bar log returns.",
    containsClose: true,
    compute: (bars) => rollingSampleDeviation(oneBarLogReturns(bars), 20),
  },
  {
    id: "bar:volume_zscore_20_bars",
    label: "Volume z-score, 20 bars",
    family: "volume",
    definition: "(volume − mean of the last 20 volumes) ÷ their sample standard deviation.",
    containsClose: false,
    compute: (bars) => {
      const volumes = bars.map((bar) => bar.volume);
      const deviation = rollingSampleDeviation(volumes, 20);
      const average = sma(volumes, 20);
      return volumes.map((volume, index) => {
        const mean = average[index];
        const spread = deviation[index];
        return mean === null || mean === undefined || !spread ? null : (volume - mean) / spread;
      });
    },
  },
  {
    id: "bar:relative_strength_index_14",
    label: "Relative strength index, 14 bars",
    family: "momentum",
    definition: "Wilder's relative strength index over 14 bars, 0 to 100.",
    containsClose: true,
    compute: (bars) => rsiFromValues(closes(bars), 14),
  },
  {
    id: "bar:average_true_range_14_points",
    label: "Average true range, 14 bars (points)",
    family: "volatility",
    definition: "Wilder average of the true range over 14 bars.",
    containsClose: true,
    compute: (bars) => wilderSmooth(trueRange(bars as OhlcvData[]), 14),
  },
  {
    id: "bar:distance_from_sma_20_percent",
    label: "Distance from 20-bar simple moving average (percent)",
    family: "mean_reversion",
    definition: "100 × (close − 20-bar simple moving average) ÷ that average.",
    containsClose: true,
    compute: (bars) => {
      const values = closes(bars);
      const average = sma(values, 20);
      return values.map((close, index) => {
        const mean = average[index];
        return mean === null || mean === undefined || mean === 0 ? null : (100 * (close - mean)) / mean;
      });
    },
  },
  {
    id: "bar:range_position_20_bars_percent",
    label: "Position in 20-bar range (percent)",
    family: "mean_reversion",
    definition: "Where the close sits between the 20-bar low (0) and high (100).",
    containsClose: true,
    compute: (bars) => {
      const highest = rollingMax(bars.map((bar) => bar.high), 20);
      const lowest = rollingMin(bars.map((bar) => bar.low), 20);
      return bars.map((bar, index) => {
        const high = highest[index];
        const low = lowest[index];
        if (high === null || high === undefined || low === null || low === undefined || high === low) return null;
        return (100 * (bar.close - low)) / (high - low);
      });
    },
  },
];
