/**
 * Shared helper functions used across route modules.
 */

/**
 * Safely extract a string from Express query/param values that may be
 * string | string[] | undefined.
 */
export const getString = (param: string | string[] | undefined): string => {
  if (typeof param === 'string') return param;
  if (Array.isArray(param)) return param[0] || '';
  return '';
};

/**
 * Parse timestamps from multiple CSV column formats:
 * - ts_event: Databento format - ISO 8601 with nanoseconds
 * - timestamp: Epoch milliseconds or seconds as number
 * - time, date: Alternative column names
 */
export function parseTimestamp(record: Record<string, string>): number {
  // First check for Databento ts_event column (ISO timestamp with nanoseconds)
  if (record.ts_event) {
    const isoDate = new Date(record.ts_event);
    if (!isNaN(isoDate.getTime())) {
      return isoDate.getTime(); // Returns milliseconds since epoch
    }
  }

  // Then check for standard timestamp column
  const tsValue = record.timestamp || record.time || record.date;
  if (tsValue) {
    // Check if it's an ISO string
    if (tsValue.includes('T') || tsValue.includes('-')) {
      const isoDate = new Date(tsValue);
      if (!isNaN(isoDate.getTime())) {
        return isoDate.getTime();
      }
    }
    // Otherwise treat as numeric
    const numVal = parseInt(tsValue);
    if (!isNaN(numVal)) {
      return numVal;
    }
  }

  return NaN;
}
