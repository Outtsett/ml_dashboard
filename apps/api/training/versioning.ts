/**
 * Model Versioning — Timestamped model IDs that never overwrite.
 *
 * SRP: Only concern is ID generation/parsing.
 * OCP: If format changes, only this module changes.
 *
 * Format: {SYMBOL}_{TIMEFRAME}_{MODEL-TYPE}_{YYYYMMDDTHHMMSS}
 * Example: ES_1h_primitives-discovery_20260227T143022
 */

/** Generate a versioned model ID with current timestamp. */
export function generateVersionedModelId(
  symbol: string,
  timeframe: string,
  modelType: string,
): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")     // Remove dashes and colons
    .replace(/\.\d{3}Z$/, ""); // Remove .000Z milliseconds
  // Result: "20260227T143022"
  return `${symbol}_${timeframe}_${modelType}_${ts}`;
}

/** Extract the base model ID (without version timestamp).
 *  ES_1h_primitives-discovery_20260227T143022 → ES_1h_primitives-discovery */
export function getBaseModelId(versionedModelId: string): string {
  const parts = versionedModelId.split("_");
  const tsPattern = /^\d{8}T\d{6}$/;
  const tsIdx = parts.findIndex(p => tsPattern.test(p));
  if (tsIdx === -1) return versionedModelId;
  return parts.slice(0, tsIdx).join("_");
}

/** Extract timestamp from versioned model ID. Returns null if not found. */
export function getVersionTimestamp(versionedModelId: string): Date | null {
  const parts = versionedModelId.split("_");
  const tsPattern = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;
  for (const part of parts) {
    const match = part.match(tsPattern);
    if (match) {
      const [, y, m, d, h, min, s] = match;
      return new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`);
    }
  }
  return null;
}

/** Append walk-forward window index to versioned model ID.
 *  ES_1h_primitives-discovery_20260227T143022 → ES_1h_primitives-discovery_20260227T143022_w0 */
export function appendWindowIndex(versionedModelId: string, windowIndex: number): string {
  return `${versionedModelId}_w${windowIndex}`;
}
