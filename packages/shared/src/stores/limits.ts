/**
 * Limits the Data page and its routes share, so the page disables exactly what
 * the server would refuse.
 */

/**
 * The most rows a lake sort may have to read. An ORDER BY reads every row the
 * filters leave, so a sort runs only when that number is known and at or under
 * this limit.
 */
export const SORT_ROW_LIMIT = 50_000_000;

/** The most rows the SQL console returns for one statement. */
export const QUERY_ROW_LIMIT = 1_000;
