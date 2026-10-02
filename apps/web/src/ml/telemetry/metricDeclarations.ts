/**
 * Narrowing for the self-describing metric declarations that arrive over SSE.
 *
 * Training runners emit `metric_declarations` at start, describing what they
 * are about to report: renderer hint, mission text, thresholds, units, and
 * whether higher is better. The transport types it as
 * `Record<string, unknown>` because a runner is free to send anything, so
 * everything here is defensive — a malformed declaration degrades to a sensible
 * default rather than throwing inside a render.
 *
 * The point of reading declarations at all is that the telemetry surface never
 * hardcodes a metric list. A new runner that declares `kl_divergence` gets a
 * ticker column for free.
 */

import type { MetricContext } from "@/ml/lib/diagnostics-schema";

export interface MetricDeclaration {
  key: string;
  /** Human label. Falls back to a prettified key. */
  label: string;
  /** Thresholds, units, and direction. Empty object when undeclared. */
  context: MetricContext;
  /** Optional grouping hint, e.g. "losses" / "trading". */
  group?: string;
}

/** Metric names that conventionally improve as they fall, used as a fallback. */
const LOWER_IS_BETTER_HINTS = [
  "loss",
  "error",
  "mse",
  "mae",
  "rmse",
  "drawdown",
  "perplexity",
  "regret",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `val_acc` → `Val Acc`. Only used when a declaration omits a label. */
export function prettifyMetricKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Decide whether a metric improves downward.
 *
 * An explicit `higher_is_better: false` always wins. Only when the runner said
 * nothing do we fall back to the name, because guessing from a name is a guess
 * — `val_loss` is safe, but a metric called `loss_recovery_rate` is not, and an
 * explicit declaration must never be second-guessed.
 */
export function isLowerBetter(key: string, context: MetricContext): boolean {
  if (typeof context.higher_is_better === "boolean") return !context.higher_is_better;
  const lower = key.toLowerCase();
  return LOWER_IS_BETTER_HINTS.some((hint) => lower.includes(hint));
}

/** Pull one declaration out of the raw payload, tolerating any shape. */
function parseDeclaration(key: string, raw: unknown): MetricDeclaration {
  if (!isRecord(raw)) {
    return { key, label: prettifyMetricKey(key), context: {} };
  }
  const context = isRecord(raw.context) ? (raw.context as MetricContext) : {};
  const label =
    typeof raw.label === "string" && raw.label.trim()
      ? raw.label.trim()
      : prettifyMetricKey(key);
  const group = typeof raw.group === "string" ? raw.group : undefined;
  return { key, label, context, group };
}

/**
 * Build the ordered metric list for a live surface.
 *
 * Declared metrics come first, in declaration order, because that order is the
 * runner's own statement of importance. Metrics that show up in the stream
 * without a declaration are appended rather than dropped — a runner that
 * forgets to declare something should still be observable, just unsorted.
 */
export function resolveMetrics(
  declarations: Record<string, unknown> | null,
  liveMetrics: Record<string, number>,
): MetricDeclaration[] {
  const resolved: MetricDeclaration[] = [];
  const seen = new Set<string>();

  if (isRecord(declarations)) {
    for (const [key, raw] of Object.entries(declarations)) {
      resolved.push(parseDeclaration(key, raw));
      seen.add(key);
    }
  }

  for (const key of Object.keys(liveMetrics)) {
    if (seen.has(key)) continue;
    resolved.push({ key, label: prettifyMetricKey(key), context: {} });
  }

  return resolved;
}
