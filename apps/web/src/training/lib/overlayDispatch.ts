/**
 * overlayDispatch — model-agnostic routing for training chart overlays.
 *
 * A model declares how it wants to be drawn on the price chart with the
 * `chartOverlay` string in `packages/config/runners.json` / `models.json` /
 * `tasks.json`, merged onto `ModelRegistryEntry` at
 * `apps/api/training/registry.ts:122` (default `"prediction_markers"`).
 * While it trains it emits `overlay` events carrying that same string as
 * `overlayType` (`packages/ml-engine/packages/shared/src/protocol.py` — `emit_overlay`,
 * `emit_prediction_markers`). The server parser is already generic:
 * `OverlayEventSchema` (`apps/api/training/runners/parsers/generated.ts:150`)
 * accepts any `overlayType`.
 *
 * This module is the client half of that contract: one registry keyed by
 * `overlayType`, no per-model branching anywhere else. Adding support for a new
 * overlay is adding one entry here, never an `if` in the chart code.
 *
 * Every overlay type that any config declares has an entry, including the ones
 * nothing paints yet — those resolve to `declared_but_not_yet_rendered` and are
 * logged by name, so "my model declared X and nothing appeared" is an answer on
 * the console rather than a mystery.
 *
 * The dispatcher is pure: it takes an overlay event and returns a discriminated
 * result. Logging lives in `reportOverlayDispatchResult`, so the same call is
 * safe from both the SSE handler and any chart consumer that wants the
 * normalised shape.
 */

import type { OverlayPayload } from "@shared/trainingTypes";

// ── Normalised shapes handed to the chart ──────────────────────────────────

/** Predicted direction for one bar: up, flat/no-position, or down. */
export type PredictionDirection = 1 | 0 | -1;

/**
 * One prediction, normalised out of the compact three-parallel-array wire form.
 *
 * `timestampSeconds` is epoch SECONDS — the key lightweight-charts indexes
 * candles on, and what `emit_prediction_markers` sends. Note that the chart's
 * own `PredictionMarker` (`apps/web/packages/shared/src/contexts/dashboardTypes.ts:26`)
 * carries `timestamp` in MILLISECONDS, so a consumer building those must
 * multiply by 1000.
 *
 * `confidence` is `null` — never `0` — when the model reported no confidence
 * for that bar: zero would read as "certain it is wrong".
 */
export interface NormalizedPredictionMarker {
  timestampSeconds: number;
  direction: PredictionDirection;
  confidence: number | null;
}

/** Per-bar categorical assignment, the shape the regime painter already uses. */
export interface NormalizedRegimeAssignments {
  timestampsSeconds: number[];
  regimeAssignments: number[];
}

// ── Discriminated dispatch result ──────────────────────────────────────────

export type OverlayDispatchResult =
  | {
      outcome: "regime_zones";
      overlayType: string;
      timestampsSeconds: number[];
      regimeAssignments: number[];
    }
  | {
      outcome: "prediction_markers";
      overlayType: string;
      predictionMarkers: NormalizedPredictionMarker[];
    }
  | {
      outcome: "declared_but_not_yet_rendered";
      overlayType: string;
      explanation: string;
    }
  | {
      outcome: "malformed_payload";
      overlayType: string;
      explanation: string;
    }
  | {
      outcome: "unknown_overlay_type";
      overlayType: string;
      explanation: string;
    };

/** A handler turns one overlay event into chart-ready state. */
export type OverlayHandler = (event: OverlayPayload) => OverlayDispatchResult;

// ── Coercion helpers ───────────────────────────────────────────────────────

/**
 * Epoch seconds from whatever arrived. The emitters send seconds; a value past
 * 1e12 is milliseconds (the same threshold `_to_epoch_sec` uses in
 * `packages/ml-engine/packages/shared/src/protocol.py:285`), and a numeric string is accepted because
 * the regime path has always accepted one.
 */
function toEpochSeconds(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value) : (value as number);
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return null;
  return numeric > 1e12 ? Math.round(numeric / 1000) : numeric;
}

function toPredictionDirection(value: unknown): PredictionDirection {
  const numeric = typeof value === "string" ? Number(value) : (value as number);
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return 0;
  if (numeric > 0) return 1;
  if (numeric < 0) return -1;
  return 0;
}

/** Describes what actually arrived where an array was expected, for a log line. */
function describeArray(value: unknown): string {
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (value === undefined) return "missing";
  if (value === null) return "null";
  return typeof value;
}

function toConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * regime_zones — per-bar categorical assignment that colours the candles.
 *
 * This is the one overlay that paints today (`MarketDataPage.tsx:197` ->
 * `useChartOverlayData.ts:117` -> `useChartSeries.ts:152`). Its behaviour is
 * deliberately unchanged: the same two arrays, the same string-to-number
 * coercion the hardcoded branch in `sse_handlers.ts` performed.
 */
const handleRegimeZones: OverlayHandler = (event) => {
  if (!Array.isArray(event.timestamps) || !Array.isArray(event.assignments)) {
    return {
      outcome: "malformed_payload",
      overlayType: event.overlayType,
      explanation:
        "regime_zones needs both a timestamps array and an assignments array; " +
        `received timestamps=${describeArray(event.timestamps)}, ` +
        `assignments=${describeArray(event.assignments)}.`,
    };
  }
  return {
    outcome: "regime_zones",
    overlayType: event.overlayType,
    timestampsSeconds: event.timestamps.map((t: unknown) =>
      typeof t === "string" ? Number(t) : (t as number),
    ),
    regimeAssignments: event.assignments,
  };
};

/**
 * prediction_markers — one directional marker per bar, the live
 * "is the model predicting correctly?" channel.
 *
 * Wire form (`emit_prediction_markers`, `packages/ml-engine/packages/shared/src/protocol.py:396`) is
 * three parallel arrays rather than per-bar objects, because thousands of bars
 * flow through this event:
 *
 *     { overlayType: "prediction_markers",
 *       timestamps:  [1726790400, ...],          // epoch seconds
 *       assignments: [1, -1, 0, ...],            // direction per bar
 *       payload: { confidences: [0.82, null, ...], direction_legend, bar_count } }
 *
 * A bar whose timestamp will not coerce to a finite number is dropped rather
 * than placed at 0, which would stack every bad marker on 1970.
 */
const handlePredictionMarkers: OverlayHandler = (event) => {
  if (!Array.isArray(event.timestamps) || !Array.isArray(event.assignments)) {
    return {
      outcome: "malformed_payload",
      overlayType: event.overlayType,
      explanation:
        "prediction_markers needs a timestamps array and an assignments array " +
        "(direction per bar); received " +
        `timestamps=${describeArray(event.timestamps)}, ` +
        `assignments=${describeArray(event.assignments)}.`,
    };
  }
  if (event.timestamps.length !== event.assignments.length) {
    return {
      outcome: "malformed_payload",
      overlayType: event.overlayType,
      explanation:
        `prediction_markers received ${event.timestamps.length} timestamps but ` +
        `${event.assignments.length} directions — they must be parallel, so every ` +
        "marker after the first gap would land on the wrong bar.",
    };
  }

  const payload = (event.payload ?? {}) as { confidences?: unknown };
  const confidences = Array.isArray(payload.confidences) ? payload.confidences : null;
  if (confidences !== null && confidences.length !== event.timestamps.length) {
    return {
      outcome: "malformed_payload",
      overlayType: event.overlayType,
      explanation:
        `prediction_markers received ${event.timestamps.length} timestamps but ` +
        `${confidences.length} confidences — they must be parallel.`,
    };
  }

  const predictionMarkers: NormalizedPredictionMarker[] = [];
  for (let index = 0; index < event.timestamps.length; index += 1) {
    const timestampSeconds = toEpochSeconds(event.timestamps[index]);
    if (timestampSeconds === null) continue;
    predictionMarkers.push({
      timestampSeconds,
      direction: toPredictionDirection(event.assignments[index]),
      confidence: confidences === null ? null : toConfidence(confidences[index]),
    });
  }

  return {
    outcome: "prediction_markers",
    overlayType: event.overlayType,
    predictionMarkers,
  };
};

/**
 * Builds the entry for an overlay type a model may legitimately declare but
 * which no painter consumes yet. It resolves to a named, logged outcome — the
 * point is that an unrendered declaration is visible, not silent.
 */
function declaredButNotYetRendered(
  declarationSites: string,
  intendedAppearance: string,
): OverlayHandler {
  return (event) => ({
    outcome: "declared_but_not_yet_rendered",
    overlayType: event.overlayType,
    explanation:
      `"${event.overlayType}" is declared as a chartOverlay in ${declarationSites} ` +
      `and is meant to draw ${intendedAppearance}, but no chart painter consumes it yet, ` +
      "so this event carries data nothing will draw. Add a handler in " +
      "apps/web/src/training/lib/overlayDispatch.ts and a painter on the chart side.",
  });
}

// ── The registry ───────────────────────────────────────────────────────────

/**
 * Every `chartOverlay` value any config declares, plus `regime_zones`, which is
 * what the regime emitter actually sends. Counted across
 * `packages/config/runners.json`, `models.json` and `tasks.json` on 2026-09-22:
 * prediction_markers x8, prediction_line x7, prediction_heatband x5,
 * reward_curve x1, regime_bands x1, credible_bands x1.
 *
 * `regime_bands` is the declaration; `regime_zones` is the wire value the
 * existing emitter uses, and only `regime_zones` has a painter today, so
 * `regime_bands` is listed honestly as not-yet-rendered rather than quietly
 * aliased.
 */
export const OVERLAY_HANDLER_REGISTRY: Readonly<Record<string, OverlayHandler>> = {
  regime_zones: handleRegimeZones,
  prediction_markers: handlePredictionMarkers,
  prediction_line: declaredButNotYetRendered(
    "packages/config/runners.json, models.json and tasks.json (7 models)",
    "a continuous predicted-value line beside the candles",
  ),
  prediction_heatband: declaredButNotYetRendered(
    "packages/config/runners.json, models.json and tasks.json (5 models)",
    "a shaded band of predicted range or probability around price",
  ),
  regime_bands: declaredButNotYetRendered(
    "packages/config/runners.json, models.json and tasks.json (1 model)",
    "per-bar regime colouring — the same shape regime_zones paints, which is " +
      "the wire value the existing emitter sends",
  ),
  reward_curve: declaredButNotYetRendered(
    "packages/config/runners.json, models.json and tasks.json (1 model)",
    "a cumulative reward curve for a reinforcement-learning run",
  ),
  credible_bands: declaredButNotYetRendered(
    "packages/config/runners.json, models.json and tasks.json (1 model)",
    "Bayesian credible intervals around the predicted path",
  ),
};

/** The overlay types this client knows about, in registry order. */
export const DECLARED_OVERLAY_TYPES: readonly string[] = Object.keys(OVERLAY_HANDLER_REGISTRY);

// ── Dispatch ───────────────────────────────────────────────────────────────

/**
 * Route one overlay event to its handler. Pure — call it from the SSE handler
 * or from a chart consumer that wants the normalised shape; it never logs and
 * never throws.
 */
export function dispatchOverlayEvent(event: OverlayPayload): OverlayDispatchResult {
  const overlayType = typeof event?.overlayType === "string" ? event.overlayType : "";
  if (!overlayType) {
    return {
      outcome: "unknown_overlay_type",
      overlayType: String(event?.overlayType ?? ""),
      explanation:
        "The overlay event carried no overlayType string, so there is nothing to " +
        "dispatch on. The emitting model must send the same string it declares as " +
        "its chartOverlay.",
    };
  }

  const handler = OVERLAY_HANDLER_REGISTRY[overlayType];
  if (!handler) {
    return {
      outcome: "unknown_overlay_type",
      overlayType,
      explanation:
        `No handler is registered for overlayType "${overlayType}". Known types: ` +
        `${DECLARED_OVERLAY_TYPES.join(", ")}. Either the model's chartOverlay ` +
        "declaration and its emitted overlayType disagree, or this is a new overlay " +
        "that needs an entry in apps/web/src/training/lib/overlayDispatch.ts.",
    };
  }

  return handler(event);
}

// ── Reporting ──────────────────────────────────────────────────────────────

const reportedOverlayTypes = new Set<string>();

/**
 * Clear the once-per-overlay-type log memory. Called when a new training
 * session starts so the same warning is seen again on the next run rather than
 * being swallowed for the life of the browser tab.
 */
export function resetOverlayDispatchReporting(): void {
  reportedOverlayTypes.clear();
}

/**
 * Log an overlay outcome the user needs to know about — once per overlay type
 * per training session, because these events arrive per iteration and a warning
 * repeated hundreds of times is a warning nobody reads.
 *
 * Returns true when this call actually logged.
 */
export function reportOverlayDispatchResult(result: OverlayDispatchResult): boolean {
  if (result.outcome === "regime_zones" || result.outcome === "prediction_markers") {
    return false;
  }

  const reportKey = `${result.outcome}:${result.overlayType}`;
  if (reportedOverlayTypes.has(reportKey)) return false;
  reportedOverlayTypes.add(reportKey);

  const headline =
    result.outcome === "unknown_overlay_type"
      ? `[chart overlay] unknown overlay type "${result.overlayType}" — nothing will be drawn.`
      : result.outcome === "declared_but_not_yet_rendered"
        ? `[chart overlay] overlay type "${result.overlayType}" is declared but not yet rendered — nothing will be drawn.`
        : `[chart overlay] overlay type "${result.overlayType}" arrived with a payload this client cannot use — nothing will be drawn.`;

  console.warn(`${headline} ${result.explanation}`);
  return true;
}
