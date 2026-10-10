/**
 * How the Data page writes a number for a person: whole numbers with thousands
 * separators, shares as percentages, at most one decimal where a fraction
 * matters, and never scientific notation. The recorded value is the caller's to
 * keep one hover away; nothing here changes what is stored.
 */

/** A count: `882665821` reads `882,665,821`. An unknown reads as a dash, never 0. */
export function wholeNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

/** A share between 0 and 1 as a percentage: `0.517` reads `51.7%`. */
export function percentage(share: number | null | undefined): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return "—";
  const percent = share * 100;
  const rounded = Math.round(percent * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/**
 * A stored number, written as stored: whole numbers with separators, a fraction
 * with every digit it holds (a price keeps its tick, an exchange rate its fifth
 * decimal). Ten significant digits are kept, which drops binary float noise
 * (`0.1 + 0.2` reads `0.3`); never scientific notation.
 */
export function storedValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return Number(value.toPrecision(10)).toLocaleString("en-US", { maximumFractionDigits: 10 });
}

/**
 * A grid cell: a column named as a share (`_fraction`, `_share`) reads as a
 * percentage, every other number reads as stored.
 */
export function cellText(value: number, columnName: string): string {
  if (/(_fraction|_share)$/i.test(columnName) && Math.abs(value) <= 1) return percentage(value);
  return storedValue(value);
}

/**
 * A computed statistic of unknown unit (a mean, a percentile). From 100,000 up
 * it is whole; from 1,000 it keeps at most one decimal; from 1 it keeps four
 * significant digits (a mean exchange rate reads 1.121, not 1.1); below 1 it is
 * written out in plain decimal places to three significant digits, never as
 * `1.2e-4`.
 */
export function measuredValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude === 0) return "0";
  if (magnitude >= 100_000) return Math.round(value).toLocaleString("en-US");
  if (magnitude >= 1_000) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  }
  if (magnitude >= 1) return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  const leadingZeros = Math.max(0, -Math.floor(Math.log10(magnitude)) - 1);
  const places = Math.min(12, leadingZeros + 3);
  return value.toFixed(places).replace(/0+$/, "").replace(/\.$/, "");
}

/** A byte count in whole megabytes or, from 1,024 megabytes, gigabytes with one decimal. */
export function byteSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1) return `${wholeNumber(bytes / 1024)} kilobytes`;
  if (megabytes < 1024) return `${wholeNumber(megabytes)} megabytes`;
  return `${(megabytes / 1024).toFixed(1)} gigabytes`;
}

/** Whole days between two instants, never negative. */
export function wholeDaysBetween(earlierMilliseconds: number, laterMilliseconds: number): number {
  return Math.max(0, Math.floor((laterMilliseconds - earlierMilliseconds) / 86_400_000));
}
