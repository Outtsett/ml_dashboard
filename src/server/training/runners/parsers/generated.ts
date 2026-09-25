/**
 * Generic Parser for `_base.py.j2`-derived runners (W1.e).
 *
 * Every model generated through the workshop's Jinja2 templates emits a
 * common, well-defined set of JSON-line events on stdout. This parser is
 * the TypeScript counterpart to `src/ml/shared/protocol.py` (and the
 * `_emit_metric_declarations()` / `emit_config()` / `emit_fold_complete()`
 * helpers added by the W1.a base template work).
 *
 * Recognized event types:
 *   - metric_declarations   (declarations: { name -> renderer/group/mission/context })
 *   - config                (config snapshot — model/data/optimizer/schedule/HPO)
 *   - epoch_metric          (per-epoch / per-fold metric dict)
 *   - fold_complete         (fold_idx, metrics) — bridges to <ExperimentLedger>
 *   - metric                (name, value, iteration, total)
 *   - log                   (level, message)
 *   - progress              (iteration, total, phase)
 *   - overlay               (overlayType, timestamps, assignments, payload)
 *   - model_state           (snapshot)
 *   - sampler_diagnostics   (diagnostics)
 *   - done                  (modelPath, diagnostics)
 *   - error                 (message, details)
 *
 * Anything else is forwarded as a plain `log` event with the raw payload —
 * generated runners may emit custom events that the frontend ignores; we
 * never throw, never drop, never block the stream.
 *
 * Lines that aren't JSON fall through to a `log` event so the verbose panel
 * still shows them (mirrors xgb_classifier parser behaviour).
 */

import { z } from 'zod';
import type { TrainingSession } from '@shared/trainingTypes';
import { CYCLE_EVENT_SCHEMAS, isCycleEventType, type CycleEventType } from '@shared/cycle/schema';
import { emitSessionEvent } from '../types';
import type { IOutputParser, ParserContext } from './types';
import { getRunContext } from '../../provenance';

// ─── Envelope (schema v1) ────────────────────────────────────────────────────
//
// `src/ml/shared/protocol.py::_envelope()` wraps every event in identity +
// ordering fields. EVERY field is `.optional()` on purpose: a headless
// `scripts/train_*.py` run, a pre-envelope runner, or any script that writes
// the protocol by hand emits none of them and must still parse. Missing
// fields are synthesized server-side from the spawn record (see
// `withSynthesizedEnvelope` below).

const EnvelopeFieldsSchema = z.object({
  /** Envelope schema version. */
  v: z.number().optional(),
  /** Event family — analytics dispatches on (kind, type) only. */
  kind: z.string().optional(),
  /** RFC3339 UTC wall clock, millisecond precision. */
  ts: z.string().optional(),
  /** Nanoseconds since the emitting process started. */
  mono_ns: z.number().optional(),
  /** Per-process counter — a gap proves a dropped stdout line. */
  seq: z.number().optional(),
  run_id: z.string().nullable().optional(),
  experiment_id: z.string().nullable().optional(),
  catalog_id: z.string().nullable().optional(),
  trial_idx: z.number().nullable().optional(),
  fold_idx: z.number().nullable().optional(),
  config_hash: z.string().nullable().optional(),
  manifest_hash: z.string().nullable().optional(),
  /** Nested copy of the type-specific payload (transition form — the flat
   *  top-level copy is still authoritative for v1 consumers). */
  data: z.record(z.unknown()).optional(),
}).passthrough();

export type EnvelopeFields = z.infer<typeof EnvelopeFieldsSchema>;

/** Envelope keys the server can fill in when the runner did not emit them. */
const SYNTHESIZED_KEYS = [
  'run_id',
  'experiment_id',
  'catalog_id',
  'config_hash',
  'manifest_hash',
] as const;

// ─── Zod schemas — discriminated union over the well-known event shapes ───

const MetricDeclarationSchema = z.object({
  renderer: z.string(),
  mission: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  group: z.string().optional(),
  order: z.number().optional(),
});

const MetricDeclarationsEventSchema = z.object({
  type: z.literal('metric_declarations'),
  declarations: z.record(MetricDeclarationSchema.passthrough()),
});

const ConfigEventSchema = z.object({
  type: z.literal('config'),
  scope: z.string().optional(),
  trial: z.number().nullable().optional(),
  fold: z.number().nullable().optional(),
  label: z.string().optional(),
  config: z.record(z.unknown()),
}).passthrough();

const EpochMetricEventSchema = z.object({
  type: z.literal('epoch_metric'),
  iteration: z.number().optional(),
  total: z.number().optional(),
  epoch: z.number().optional(),
  fold: z.number().optional(),
  metrics: z.record(z.union([z.number(), z.string(), z.boolean(), z.null()])).optional(),
}).passthrough();

/**
 * `fold_complete` — the row-commit signal for <ExperimentLedger>.
 *
 * `fold_idx` is the canonical key and stays REQUIRED here, because a fold
 * row without its coordinate is not a ledger row. Tolerance for the `fold`
 * spelling is applied *before* validation by `normalizeFoldCompleteAliases`
 * (see below), so by the time a line reaches this schema the alias has
 * already been folded into `fold_idx`.
 */
const FoldCompleteEventSchema = z.object({
  type: z.literal('fold_complete'),
  fold_idx: z.number(),
  metrics: z.record(z.union([z.number(), z.string(), z.boolean(), z.null()])).optional(),
}).passthrough();

const MetricEventSchema = z.object({
  type: z.literal('metric'),
  name: z.string(),
  value: z.number(),
  iteration: z.number().optional(),
  total: z.number().optional(),
}).passthrough();

const LogEventSchema = z.object({
  type: z.literal('log'),
  level: z.string().optional(),
  message: z.string(),
}).passthrough();

const ProgressEventSchema = z.object({
  type: z.literal('progress'),
  iteration: z.number(),
  total: z.number(),
  phase: z.string().optional(),
}).passthrough();

const OverlayEventSchema = z.object({
  type: z.literal('overlay'),
  overlayType: z.string(),
  timestamps: z.array(z.number()).optional(),
  assignments: z.array(z.number()).optional(),
  payload: z.unknown().optional(),
}).passthrough();

const ModelStateEventSchema = z.object({
  type: z.literal('model_state'),
  iteration: z.number().optional(),
  total: z.number().optional(),
  snapshot: z.record(z.unknown()),
}).passthrough();

const SamplerDiagnosticsEventSchema = z.object({
  type: z.literal('sampler_diagnostics'),
  iteration: z.number().optional(),
  total: z.number().optional(),
  diagnostics: z.record(z.unknown()),
}).passthrough();

const DoneEventSchema = z.object({
  type: z.literal('done'),
  modelPath: z.string().optional(),
  modelId: z.string().optional(),
  elapsedSec: z.number().optional(),
  diagnostics: z.unknown().optional(),
}).passthrough();

const ErrorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  details: z.string().optional(),
}).passthrough();

const GeneratedEventUnionSchema = z.discriminatedUnion('type', [
  MetricDeclarationsEventSchema,
  ConfigEventSchema,
  EpochMetricEventSchema,
  FoldCompleteEventSchema,
  MetricEventSchema,
  LogEventSchema,
  ProgressEventSchema,
  OverlayEventSchema,
  ModelStateEventSchema,
  SamplerDiagnosticsEventSchema,
  DoneEventSchema,
  ErrorEventSchema,
]);

/** Every `type` literal the union knows about — used to tell a drifted
 *  known event apart from a genuinely custom one when validation fails. */
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(
  GeneratedEventUnionSchema.options.map(
    (option) => (option.shape.type as z.ZodLiteral<string>).value,
  ),
);

/**
 * Fold-coordinate alias tolerance for `fold_complete`.
 *
 * `src/ml/shared/protocol.py::emit_fold_complete` emits `fold_idx`. The
 * diverged fork at `Trading/quant/model/src/ml/shared/protocol.py:1201`
 * emits `fold` (plus `total_folds`), and it is the emitter behind the
 * registered runner `online_rls_mtf+online_direction_skill`. That fork has
 * its own consumers, so the tolerance lives here rather than there: accept
 * either spelling on the wire, normalise to `fold_idx` before validation.
 *
 * Precedence: a numeric `fold_idx` always wins. The envelope stamps
 * `fold_idx: null` when no fold is active (`protocol.py::_envelope`), so
 * "null envelope coordinate + numeric payload `fold`" resolves to the
 * payload's fold — the emitter is closer to the truth than the envelope
 * default. The nested `data` copy (the documented v1 transition form) is
 * normalised alongside the flat copy so the two never disagree.
 *
 * Pure: returns a new object rather than mutating the caller's payload.
 */
export function normalizeFoldCompleteAliases(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;
  if (obj.type !== 'fold_complete') return input;

  const needsFlat = typeof obj.fold_idx !== 'number' && typeof obj.fold === 'number';

  const nested = obj.data;
  const nestedIsObject = !!nested && typeof nested === 'object' && !Array.isArray(nested);
  const nestedObj = nestedIsObject ? (nested as Record<string, unknown>) : null;
  const needsNested =
    nestedObj !== null &&
    typeof nestedObj.fold_idx !== 'number' &&
    typeof nestedObj.fold === 'number';

  if (!needsFlat && !needsNested) return input;

  const out: Record<string, unknown> = { ...obj };
  if (needsFlat) out.fold_idx = obj.fold;
  if (needsNested && nestedObj) out.data = { ...nestedObj, fold_idx: nestedObj.fold };
  return out;
}

/**
 * The wire contract: envelope fields intersected onto the payload union,
 * behind the alias-normalisation preprocess.
 *
 * Intersection rather than replacement is what keeps legacy runners working —
 * every envelope field is optional, so a pre-envelope line validates exactly
 * as it did before, and an enveloped line validates with its identity fields
 * typed instead of merely passed through.
 *
 * The preprocess sits on the exported schema (not only inside
 * `parseGeneratedLine`) so anything validating a raw line directly gets the
 * same tolerance.
 */
export const GeneratedEventSchema = z.preprocess(
  normalizeFoldCompleteAliases,
  z.intersection(EnvelopeFieldsSchema, GeneratedEventUnionSchema),
);

export type GeneratedEvent = z.infer<typeof GeneratedEventSchema>;

/**
 * Result of attempting to parse a single stdout line. The discriminator
 * `kind` tells the caller (and unit tests) what happened without forcing
 * them to inspect Zod errors.
 */
export type ParsedLine =
  | { kind: 'event'; event: GeneratedEvent }
  | {
      kind: 'unknown';
      raw: Record<string, unknown> & { type?: string };
      /** true when `raw.type` IS a type the union knows — i.e. protocol drift
       *  in a recognised event, not a deliberately custom one. */
      knownType: boolean;
      /** Human-readable Zod failure: `path: message; path: message`. */
      validationError: string;
    }
  | { kind: 'log'; message: string }
  /**
   * A Model Cycle `cycle_*` event (`@shared/cycle/schema` `CYCLE_EVENT_SCHEMAS`)
   * that validated. `event` is the schema's parsed output — envelope fields it
   * declares (`seq`, `run_id`, `ts`) survive; other raw envelope keys
   * (`v`, `mono_ns`, `trial_idx`, ...) are stripped by the schema's default
   * strip mode, same as every other event shape here.
   */
  | { kind: 'cycle_event'; eventType: CycleEventType; event: Record<string, unknown> }
  /**
   * A `cycle_*`-typed line whose payload failed its schema. Kept distinct
   * from `unknown` because a `cycle_bars` line carries up to ~2000 bars
   * (~200 KB) — the generic `unknown` path's raw-payload log dump would
   * flood the terminal panel and the SQLite log table with it, so this path
   * carries only the first Zod issue, capped.
   */
  | { kind: 'cycle_invalid'; eventType: CycleEventType; firstIssue: string };

/** Compact, single-line rendering of a Zod failure for a log message. */
function formatValidationError(error: z.ZodError): string {
  const issues = error.issues.slice(0, 6).map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '<root>';
    return `${path}: ${issue.message}`;
  });
  if (error.issues.length > issues.length) {
    issues.push(`(+${error.issues.length - issues.length} more)`);
  }
  return issues.join('; ');
}

/** The first Zod issue only, as `path: message`, capped at 300 characters. */
function formatFirstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const message = issue ? `${issue.path.length ? issue.path.join('.') : '<root>'}: ${issue.message}` : 'unknown validation error';
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

/**
 * Pure-function parser used by both the live runner pipeline and the
 * Vitest suite. Never throws.
 */
export function parseGeneratedLine(line: string): ParsedLine {
  if (!line) return { kind: 'log', message: '' };
  if (!line.startsWith('{')) {
    return { kind: 'log', message: line };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: 'log', message: line };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'log', message: line };
  }

  const obj = parsed as Record<string, unknown> & { type?: string };

  // Model Cycle events are dispatched on the wire contract in
  // `@shared/cycle/schema` (the single source of truth shared with the
  // Python emitters and the client store) rather than the generic union
  // above — they carry thousands of bars per line and use their own,
  // narrower envelope.
  if (typeof obj.type === 'string' && isCycleEventType(obj.type)) {
    const eventType = obj.type;
    const cycleResult = CYCLE_EVENT_SCHEMAS[eventType].safeParse(obj);
    if (cycleResult.success) {
      return { kind: 'cycle_event', eventType, event: cycleResult.data as Record<string, unknown> };
    }
    return { kind: 'cycle_invalid', eventType, firstIssue: formatFirstIssue(cycleResult.error) };
  }

  const result = GeneratedEventSchema.safeParse(obj);
  if (result.success) {
    return { kind: 'event', event: result.data as GeneratedEvent };
  }
  // Recognised JSON shape but not in our discriminated union (or a known
  // type whose payload didn't validate). Either way, preserve the payload
  // — the frontend may still consume custom event types we don't know
  // about, and we don't drop diagnostic detail on the floor. The Zod failure
  // travels with it so the downgrade is explainable rather than mute.
  return {
    kind: 'unknown',
    raw: obj,
    knownType: typeof obj.type === 'string' && KNOWN_EVENT_TYPES.has(obj.type),
    validationError: formatValidationError(result.error),
  };
}

/**
 * Fill in envelope identity fields the runner did not emit, from the spawn
 * record the orchestrator registered before `spawn`.
 *
 * Only *absent* keys are filled — a value the runner emitted is never
 * overwritten, because the runner is closer to the truth (an HPO driver can
 * legitimately re-stamp events with a per-trial identity). `trial_idx` and
 * `fold_idx` are deliberately NOT synthesized: they are coordinates only the
 * training process knows, and guessing them would fabricate provenance.
 */
export function withSynthesizedEnvelope(
  payload: Record<string, unknown>,
  modelId: string | undefined,
): Record<string, unknown> {
  const ctx = getRunContext(modelId);
  if (!ctx) return payload;

  const source: Record<(typeof SYNTHESIZED_KEYS)[number], string> = {
    run_id: ctx.runId,
    experiment_id: ctx.experimentId,
    catalog_id: ctx.catalogId,
    config_hash: ctx.configHash,
    manifest_hash: ctx.manifestHash,
  };

  for (const key of SYNTHESIZED_KEYS) {
    if (payload[key] === undefined || payload[key] === null) {
      payload[key] = source[key];
    }
  }
  return payload;
}

/**
 * Server-terminal half of the drift signal, deduplicated per
 * (session, event type) so a runner emitting one bad line per epoch does not
 * flood stdout — the first occurrence is the one that matters.
 */
const warnedDrift = new Set<string>();

function warnOnce(sessionId: string, eventType: string, message: string): void {
  const key = `${sessionId}:${eventType}`;
  if (warnedDrift.has(key)) return;
  warnedDrift.add(key);
  console.warn(`[GeneratedParser] ${message}`);
}

/** Test hook — clears the per-session warn dedupe table. */
export function resetDriftWarnings(): void {
  warnedDrift.clear();
}

export class GeneratedParser implements IOutputParser {
  parseLine(session: TrainingSession, line: string, _ctx: ParserContext): boolean {
    const result = parseGeneratedLine(line);

    if (result.kind === 'log') {
      if (result.message) {
        emitSessionEvent(session, 'log', { message: result.message });
      }
      return true;
    }

    if (result.kind === 'unknown') {
      // Forward as a log event so the verbose panel keeps the raw payload,
      // but say WHY it was downgraded. Before this, a `fold_complete` whose
      // payload failed Zod arrived as a bare JSON blob — indistinguishable
      // from a deliberately custom event, with no trace of the validation
      // error. Protocol drift has to be loud.
      const eventType = typeof result.raw.type === 'string' ? result.raw.type : '(none)';
      const headline = result.knownType
        ? `Protocol drift: "${eventType}" event failed validation and was downgraded to a log line — ${result.validationError}`
        : `Unrecognised protocol event "${eventType}" forwarded verbatim — ${result.validationError}`;

      warnOnce(session.sessionId, eventType, headline);

      emitSessionEvent(session, 'log', {
        level: 'warn',
        message: `${headline} | raw: ${JSON.stringify(result.raw)}`,
        unknownType: result.raw.type ?? null,
        validationError: result.validationError,
        knownType: result.knownType,
      });
      return true;
    }

    if (result.kind === 'cycle_event') {
      const payload: Record<string, unknown> = { ...result.event };
      delete payload.type;
      withSynthesizedEnvelope(payload, _ctx.modelId);
      // `result.eventType` is one of the seven `cycle_*` literals, which are
      // not part of `TrainingEventType` (owned outside this file) — the same
      // cast the generic `event` branch below uses for its own `type`.
      emitSessionEvent(session, result.eventType as Parameters<typeof emitSessionEvent>[1], payload);
      return true;
    }

    if (result.kind === 'cycle_invalid') {
      // A `cycle_bars` line failing validation is never dumped whole (it can
      // carry ~2000 bars) — only the event type and the first Zod issue.
      const headline = `Protocol drift: "${result.eventType}" cycle event failed validation — ${result.firstIssue}`;
      warnOnce(session.sessionId, result.eventType, headline);
      emitSessionEvent(session, 'log', {
        level: 'warn',
        message: headline,
        unknownType: result.eventType,
        validationError: result.firstIssue,
        knownType: true,
      });
      return true;
    }

    // result.kind === 'event'
    const event = result.event;
    const { type } = event;
    const payload: Record<string, unknown> = { ...event };
    delete (payload as { type?: unknown }).type;
    withSynthesizedEnvelope(payload, _ctx.modelId);

    if (type === 'done') {
      emitSessionEvent(session, 'done', payload);
      (session as TrainingSession & { parserHandledDone?: boolean }).parserHandledDone = true;
      return true;
    }

    if (type === 'error') {
      emitSessionEvent(session, 'error', payload);
      // Terminal-state signal for `PythonRunner`: an error the process reported
      // itself is `failed`, not `crashed`.
      (session as TrainingSession & { parserHandledError?: boolean }).parserHandledError = true;
      return true;
    }

    emitSessionEvent(
      session,
      type as Parameters<typeof emitSessionEvent>[1],
      payload,
    );
    return true;
  }
}
