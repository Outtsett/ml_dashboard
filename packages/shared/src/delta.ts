/**
 * Delta encoding/decoding for SSE model_state payloads.
 *
 * Training SSE emits 50-200KB model_state snapshots every 25-50 iterations.
 * Most fields (emission heatmaps, transition matrices) change incrementally.
 * This module computes minimal diffs to reduce SSE bandwidth ~90%.
 *
 * Protocol:
 * - First model_state is always a full snapshot
 * - Subsequent states include `__delta__: true` marker if they're deltas
 * - Every `FULL_SNAPSHOT_INTERVAL` events, a full snapshot is forced (recovery)
 * - Client applies deltas to reconstruct full state
 */

/** Marker property indicating this payload is a delta, not a full snapshot */
export const DELTA_MARKER = '__delta__' as const;

/** Force a full snapshot every N model_state events (recovery from drift) */
export const FULL_SNAPSHOT_INTERVAL = 10;

/**
 * Compute a delta between two plain objects.
 * Returns only the fields that changed between prev and next.
 *
 * - For primitive values: includes if different
 * - For arrays: includes full array if any element differs (partial array updates are fragile)
 * - For nested objects: recurses and includes only changed nested fields
 * - For deleted fields: includes as null
 */
export function computeDelta(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};

  // Fields in next that differ from prev
  for (const key of Object.keys(next)) {
    if (key === DELTA_MARKER) continue;
    const prevVal = prev[key];
    const nextVal = next[key];

    if (prevVal === nextVal) continue;

    if (nextVal === null || nextVal === undefined) {
      if (prevVal !== null && prevVal !== undefined) {
        delta[key] = null; // field removed
      }
      continue;
    }

    if (typeof nextVal !== typeof prevVal) {
      delta[key] = nextVal;
      continue;
    }

    // Arrays: compare element-wise, but send full array if any differ
    if (Array.isArray(nextVal)) {
      if (!Array.isArray(prevVal) || !arraysEqual(prevVal, nextVal)) {
        delta[key] = nextVal;
      }
      continue;
    }

    // Nested objects: recurse
    if (typeof nextVal === 'object' && typeof prevVal === 'object' && prevVal !== null) {
      const nested = computeDelta(
        prevVal as Record<string, unknown>,
        nextVal as Record<string, unknown>,
      );
      if (Object.keys(nested).length > 0) {
        delta[key] = nested;
      }
      continue;
    }

    // Primitives
    if (nextVal !== prevVal) {
      delta[key] = nextVal;
    }
  }

  // Fields in prev that are missing from next (deletions)
  for (const key of Object.keys(prev)) {
    if (key === DELTA_MARKER) continue;
    if (!(key in next)) {
      delta[key] = null;
    }
  }

  return delta;
}

/**
 * Apply a delta to a base state, producing the full state.
 * - null values remove the field
 * - Object values are merged recursively
 * - All other values replace directly
 */
export function applyDelta(
  base: Record<string, unknown>,
  delta: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };

  for (const [key, value] of Object.entries(delta)) {
    if (key === DELTA_MARKER) continue;

    if (value === null) {
      delete result[key];
      continue;
    }

    // Recursive merge for plain objects (not arrays)
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = applyDelta(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      continue;
    }

    result[key] = value;
  }

  return result;
}

/** Shallow-ish array equality (handles nested arrays for heatmaps) */
function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === bv) continue;
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (!arraysEqual(av, bv)) return false;
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}
