/**
 * The bar time a terminal line names. The engine stamps every bar line with the
 * bar's own clock (`[fold 2/2][test] 2025-12-26 01:45 bar 1066/1320 ...`,
 * `[trade #29] ENTER SHORT 1 @ 25884.75 2025-12-25 19:50 ...`) in the same
 * stamps the bars carry, so the text and the chart agree to the minute.
 */

const BAR_STAMP = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/;

/** Epoch seconds of the first `YYYY-MM-DD HH:MM` in the line, or null when it names no bar. */
export function barTimeOf(message: string): number | null {
  const match = BAR_STAMP.exec(message);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) / 1000;
}

/** The stamp as the engine writes it, for finding a bar's lines. */
export function formatBarTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ");
}
