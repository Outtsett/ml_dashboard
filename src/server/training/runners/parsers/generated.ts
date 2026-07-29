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

/**
 * The wire contract: envelope fields intersected onto the payload union.
 *
 * Intersection rather than replacement is what keeps legacy runners working —
 * every envelope field is optional, so a pre-envelope line validates exactly
 * as it did before, and an enveloped line validates with its identity fields
 * typed instead of merely passed through.
 */
export const GeneratedEventSchema = z.intersection(
  EnvelopeFieldsSchema,
  GeneratedEventUnionSchema,
);

export type GeneratedEvent = z.infer<typeof GeneratedEventSchema>;

/**
 * Result of attempting to parse a single stdout line. The discriminator
 * `kind` tells the caller (and unit tests) what happened without forcing
 * them to inspect Zod errors.
 */
export type ParsedLine =
  | { kind: 'event'; event: GeneratedEvent }
  | { kind: 'unknown'; raw: Record<string, unknown> & { type?: string } }
  | { kind: 'log'; message: string };

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
  const result = GeneratedEventSchema.safeParse(obj);
  if (result.success) {
    return { kind: 'event', event: result.data };
  }
  // Recognised JSON shape but not in our discriminated union (or a known
  // type whose payload didn't validate). Either way, preserve the payload
  // — the frontend may still consume custom event types we don't know
  // about, and we don't drop diagnostic detail on the floor.
  return { kind: 'unknown', raw: obj };
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
      // but include the original `type` for client-side filtering.
      emitSessionEvent(session, 'log', {
        message: JSON.stringify(result.raw),
        unknownType: result.raw.type ?? null,
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
