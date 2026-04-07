import {
  type Bar,
  type IndicatorPoint,
  toPoints,
  ohlc4,
  medianPrice,
  typicalPrice,
  weightedClose,
} from "../math_primitives";

/** Average Price: (O+H+L+C)/4 */
export function calcAvgPrice(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const vals = ohlc4(bars);
  return toPoints(vals, bars);
}

/** Median Price: (H+L)/2 */
export function calcMedPrice(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const vals = medianPrice(bars);
  return toPoints(vals, bars);
}

/** Typical Price: (H+L+C)/3 */
export function calcTypPrice(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const vals = typicalPrice(bars);
  return toPoints(vals, bars);
}

/** Weighted Close Price: (H+L+2C)/4 */
export function calcWCLPrice(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const vals = weightedClose(bars);
  return toPoints(vals, bars);
}
