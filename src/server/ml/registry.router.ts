/**
 * Model Registry Routes (W7.c)
 *
 * SRP: parse + Zod-validate, dispatch to Drizzle/promotionGates, format response.
 *      No business logic inline.
 *
 * Routes:
 *   POST /api/model-versions
 *      Register a new candidate row. Called by orchestrator on training
 *      completion (orchestrator wiring deferred to W7.d follow-up; route
 *      is callable today via curl/HTTP).
 *
 *   GET  /api/model-versions
 *      Filtered, cursor-paginated list. Filters: status, catalog_id, symbol,
 *      timeframe. Cursor is the last `version_id` of the previous page
 *      (versions sort DESC by trained_at, ties broken by version_id).
 *
 *   GET  /api/model-versions/:id
 *      Full lineage card — version row + ancestor chain via parent_version_id
 *      + child versions.
 *
 *   POST /api/model-versions/:id/promote
 *      Body: { to_status, dryRun?, override?, reason? }
 *      Calls evaluateGates() unless override=true. dryRun returns gate results
 *      without committing. override requires non-empty reason and is
 *      audit-logged to `notes` with [OVERRIDE iso by user: ...] prefix.
 *
 *   POST /api/model-versions/:id/rollback
 *      Body: { to_version_id }
 *      Switches the active deployment for this (symbol, timeframe, mode) back
 *      to a prior version_id. Stops the current deployment, starts a new one
 *      pointed at the rollback target.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { db } from '../infrastructure/database/db';
import {
  modelVersions,
  deployments,
  type ModelVersion,
} from '@shared/schema';
import { mlRateLimiter } from '../infrastructure/lib/rateLimiter';
import { evaluateGates } from '../infrastructure/lib/promotionGates';

const router = Router();

// ─── Zod schemas ────────────────────────────────────────────────────────────

const StatusSchema = z.enum(['candidate', 'shadow', 'paper', 'live', 'retired']);

/** Same timeframe enum used elsewhere in the API. */
const TimeframeSchema = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']);

const RegisterModelVersionRequest = z.object({
  catalogId: z.string().min(1),
  runnerKey: z.string().min(1),
  status: StatusSchema.default('candidate'),
  dataHash: z.string().min(1),
  symbol: z.string().min(1),
  timeframe: TimeframeSchema,
  dateRangeStart: z.string().min(1),
  dateRangeEnd: z.string().min(1),
  featurePipeline: z.string().min(1),
  labelConfig: z.record(z.unknown()),
  hyperparameters: z.record(z.union([z.number(), z.string(), z.boolean(), z.null()])),
  walkForwardConfig: z.object({
    trainMonths: z.number().int().positive(),
    testMonths: z.number().int().positive(),
    purgeBars: z.number().int().min(0),
    embargoBars: z.number().int().min(0),
    anchored: z.boolean().optional(),
    nFolds: z.number().int().positive().optional(),
  }).nullable().optional(),
  hpoStudyId: z.string().nullable().optional(),
  modelArtifactPath: z.string().min(1),
  diagnosticsPath: z.string().min(1),
  metricsSummary: z.object({
    headline: z.object({ name: z.string(), value: z.number() }),
  }).passthrough(),
  trainedAt: z.string().min(1),
  parentVersionId: z.number().int().positive().nullable().optional(),
});

const ListQuerySchema = z.object({
  status: StatusSchema.optional(),
  catalog_id: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  timeframe: TimeframeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.coerce.number().int().positive().optional(),
});

const PromoteRequest = z.object({
  to_status: StatusSchema,
  dryRun: z.boolean().default(false),
  override: z.boolean().default(false),
  reason: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.override && (!data.reason || data.reason.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'override=true requires non-empty reason',
    });
  }
});

const RollbackRequest = z.object({
  to_version_id: z.number().int().positive(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatZodErrors(error: z.ZodError): { error: string; details: unknown } {
  return {
    error: 'Invalid request',
    details: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    })),
  };
}

function parseId(idParam: string | string[] | undefined): number | null {
  const raw = typeof idParam === 'string' ? idParam : Array.isArray(idParam) ? idParam[0] : undefined;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function appendNote(existing: ModelVersion['notes'], entry: { ts: string; author: string; text: string }) {
  const arr = Array.isArray(existing) ? [...existing] : [];
  arr.push(entry);
  return arr;
}

// ─── POST /api/model-versions ───────────────────────────────────────────────

router.post('/model-versions', mlRateLimiter, (req: Request, res: Response) => {
  const parsed = RegisterModelVersionRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }

  try {
    const inserted = db
      .insert(modelVersions)
      .values({
        catalogId: parsed.data.catalogId,
        runnerKey: parsed.data.runnerKey,
        status: parsed.data.status,
        dataHash: parsed.data.dataHash,
        symbol: parsed.data.symbol,
        timeframe: parsed.data.timeframe,
        dateRangeStart: parsed.data.dateRangeStart,
        dateRangeEnd: parsed.data.dateRangeEnd,
        featurePipeline: parsed.data.featurePipeline,
        labelConfig: parsed.data.labelConfig as ModelVersion['labelConfig'],
        hyperparameters: parsed.data.hyperparameters,
        walkForwardConfig: (parsed.data.walkForwardConfig ?? null) as ModelVersion['walkForwardConfig'],
        hpoStudyId: parsed.data.hpoStudyId ?? null,
        modelArtifactPath: parsed.data.modelArtifactPath,
        diagnosticsPath: parsed.data.diagnosticsPath,
        metricsSummary: parsed.data.metricsSummary as ModelVersion['metricsSummary'],
        trainedAt: parsed.data.trainedAt,
        parentVersionId: parsed.data.parentVersionId ?? null,
      })
      .returning()
      .all();

    return res.status(201).json(inserted[0]);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (msg.includes('UNIQUE') && msg.includes('model_artifact_path')) {
      return res.status(409).json({ error: 'duplicate model_artifact_path', details: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

// ─── GET /api/model-versions ────────────────────────────────────────────────

router.get('/model-versions', (req: Request, res: Response) => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }

  const { status, catalog_id, symbol, timeframe, limit, cursor } = parsed.data;

  const conditions = [];
  if (status) conditions.push(eq(modelVersions.status, status));
  if (catalog_id) conditions.push(eq(modelVersions.catalogId, catalog_id));
  if (symbol) conditions.push(eq(modelVersions.symbol, symbol));
  if (timeframe) conditions.push(eq(modelVersions.timeframe, timeframe));
  if (cursor) conditions.push(lt(modelVersions.versionId, cursor));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db
    .select()
    .from(modelVersions)
    .where(whereClause)
    .orderBy(desc(modelVersions.trainedAt), desc(modelVersions.versionId))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.versionId : null;

  return res.json({ items, nextCursor, hasMore });
});

// ─── GET /api/model-versions/:id ────────────────────────────────────────────

router.get('/model-versions/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid id' });

  const [version] = db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.versionId, id))
    .all();
  if (!version) return res.status(404).json({ error: 'model version not found' });

  // Walk parent chain (cap at 50 to avoid runaway loops on accidental cycles)
  const ancestors: ModelVersion[] = [];
  let cur: ModelVersion | undefined = version;
  const seen = new Set<number>([version.versionId]);
  while (cur?.parentVersionId && ancestors.length < 50) {
    const [parent] = db
      .select()
      .from(modelVersions)
      .where(eq(modelVersions.versionId, cur.parentVersionId))
      .all();
    if (!parent || seen.has(parent.versionId)) break;
    seen.add(parent.versionId);
    ancestors.push(parent);
    cur = parent;
  }

  const children = db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.parentVersionId, id))
    .orderBy(asc(modelVersions.trainedAt))
    .all();

  const versionDeployments = db
    .select()
    .from(deployments)
    .where(eq(deployments.versionId, id))
    .orderBy(desc(deployments.startedAt))
    .all();

  return res.json({ version, ancestors, children, deployments: versionDeployments });
});

// ─── POST /api/model-versions/:id/promote ───────────────────────────────────

router.post('/model-versions/:id/promote', mlRateLimiter, async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid id' });

  const parsed = PromoteRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }

  const { to_status, dryRun, override, reason } = parsed.data;

  const [version] = db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.versionId, id))
    .all();
  if (!version) return res.status(404).json({ error: 'model version not found' });

  // Override path bypasses gate evaluation entirely.
  if (override) {
    if (dryRun) {
      return res.json({
        allowed: true,
        results: [],
        override: true,
        dryRun: true,
        message: 'override path — gates bypassed',
      });
    }
    const ts = new Date().toISOString();
    const author = String(req.headers['x-user'] ?? 'unknown');
    const overrideNote = `[OVERRIDE ${ts} by ${author}: ${reason}]`;
    const updatedNotes = appendNote(version.notes, {
      ts,
      author,
      text: overrideNote,
    });
    const [updated] = db
      .update(modelVersions)
      .set({
        status: to_status,
        promotedAt: ts,
        notes: updatedNotes,
      })
      .where(eq(modelVersions.versionId, id))
      .returning()
      .all();
    return res.json({
      allowed: true,
      results: [],
      override: true,
      dryRun: false,
      version: updated,
    });
  }

  // Standard path: evaluate gates
  let evaluation;
  try {
    evaluation = await evaluateGates(id, to_status);
  } catch (err) {
    return res.status(500).json({ error: (err as Error)?.message ?? String(err) });
  }

  if (dryRun) {
    return res.json({ ...evaluation, dryRun: true });
  }

  if (!evaluation.allowed) {
    return res.status(409).json({
      error: 'promotion gates failed',
      ...evaluation,
      dryRun: false,
    });
  }

  const ts = new Date().toISOString();
  const [updated] = db
    .update(modelVersions)
    .set({
      status: to_status,
      promotedAt: ts,
    })
    .where(eq(modelVersions.versionId, id))
    .returning()
    .all();

  return res.json({ ...evaluation, dryRun: false, version: updated });
});

// ─── POST /api/model-versions/:id/rollback ──────────────────────────────────

router.post('/model-versions/:id/rollback', mlRateLimiter, (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid id' });

  const parsed = RollbackRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }

  const { to_version_id } = parsed.data;

  const [current] = db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.versionId, id))
    .all();
  if (!current) return res.status(404).json({ error: 'current model version not found' });

  const [target] = db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.versionId, to_version_id))
    .all();
  if (!target) return res.status(404).json({ error: 'rollback target version not found' });

  if (target.symbol !== current.symbol || target.timeframe !== current.timeframe) {
    return res.status(400).json({
      error: 'rollback target must match current symbol + timeframe',
      details: {
        current: { symbol: current.symbol, timeframe: current.timeframe },
        target: { symbol: target.symbol, timeframe: target.timeframe },
      },
    });
  }

  // Find any active deployment for the current version. If none, just record
  // the new deployment for the target — the rollback is still meaningful (the
  // operator is selecting which version is "active").
  const activeDeployments = db
    .select()
    .from(deployments)
    .where(and(eq(deployments.versionId, id), eq(deployments.status, 'running')))
    .all();

  const ts = new Date().toISOString();

  // Stop active deployments for the from-version
  for (const dep of activeDeployments) {
    db.update(deployments)
      .set({ status: 'stopped', stoppedAt: ts, notes: `rolled back to v${to_version_id}` })
      .where(eq(deployments.deploymentId, dep.deploymentId))
      .run();
  }

  // Start a paper deployment for the target (rollback is conservative — never
  // jumps directly to live; promotion path through gates is required).
  const [newDeployment] = db
    .insert(deployments)
    .values({
      versionId: to_version_id,
      mode: 'paper',
      status: 'running',
      symbol: target.symbol,
      timeframe: target.timeframe,
      startedAt: ts,
      predictionsEmitted: 0,
      notes: `rollback from v${id}`,
    })
    .returning()
    .all();

  return res.json({
    rolledBackFrom: id,
    rolledBackTo: to_version_id,
    stoppedDeployments: activeDeployments.map((d) => d.deploymentId),
    newDeployment,
  });
});

export default router;
