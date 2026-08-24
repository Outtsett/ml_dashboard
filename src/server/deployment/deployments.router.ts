/**
 * Deployments Routes (W7.c)
 *
 * SRP: HTTP layer only. Validate, dispatch to Drizzle, format response.
 *
 * Routes:
 *   GET  /api/deployments?status=         List deployments (default no filter).
 *                                         Optional filters: status, mode,
 *                                         version_id, symbol, timeframe.
 *
 *   POST /api/deployments                 Start a new deployment.
 *                                         Body: { version_id, mode, symbol, timeframe }
 *                                         - mode='live' is gated on env
 *                                           ENABLE_LIVE_DEPLOY=1; absent/false
 *                                           returns 403 (W9 wires the actual
 *                                           MLBridge ZMQ socket; for now
 *                                           paper/shadow are functional).
 *                                         - Belt-and-suspenders runtime check
 *                                           re-queries the partial-unique
 *                                           constraint (one running live per
 *                                           (symbol, timeframe)) before insert,
 *                                           since drizzle-kit cannot generate
 *                                           the partial index.
 *
 *   POST /api/deployments/:id/pause       Transition running -> paused.
 *   POST /api/deployments/:id/stop        Transition running|paused -> stopped.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../infrastructure/database/db';
import {
  deployments,
  modelVersions,
  type Deployment,
  type DeploymentStatus,
} from '@shared/schema';
import { mlRateLimiter } from '../infrastructure/lib/rateLimiter';
import {
  startLiveDeployment,
  pauseLiveDeployment,
  stopLiveDeployment,
} from './lifecycle';

const router = Router();

// ─── Zod schemas ────────────────────────────────────────────────────────────

const ModeSchema = z.enum(['shadow', 'paper', 'live']);
const StatusSchema = z.enum(['running', 'paused', 'stopped', 'failed']);
const TimeframeSchema = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']);

const ListQuerySchema = z.object({
  status: StatusSchema.optional(),
  mode: ModeSchema.optional(),
  version_id: z.coerce.number().int().positive().optional(),
  symbol: z.string().min(1).optional(),
  timeframe: TimeframeSchema.optional(),
});

const StartDeploymentRequest = z.object({
  version_id: z.number().int().positive(),
  mode: ModeSchema,
  symbol: z.string().min(1),
  timeframe: TimeframeSchema,
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
  if (idParam === undefined) return null;
  // Express 5 may surface repeated route params as string[]; take the first.
  const raw = Array.isArray(idParam) ? idParam[0] : idParam;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isLiveDeployEnabled(): boolean {
  const v = process.env.ENABLE_LIVE_DEPLOY;
  return v === '1' || v?.toLowerCase() === 'true';
}

// ─── GET /api/deployments ───────────────────────────────────────────────────

router.get('/deployments', (req: Request, res: Response) => {
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }
  const { status, mode, version_id, symbol, timeframe } = parsed.data;

  const conditions = [];
  if (status) conditions.push(eq(deployments.status, status));
  if (mode) conditions.push(eq(deployments.mode, mode));
  if (version_id) conditions.push(eq(deployments.versionId, version_id));
  if (symbol) conditions.push(eq(deployments.symbol, symbol));
  if (timeframe) conditions.push(eq(deployments.timeframe, timeframe));

  const rows = db
    .select()
    .from(deployments)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(deployments.startedAt))
    .all();

  return res.json({ items: rows });
});

// ─── POST /api/deployments ──────────────────────────────────────────────────

router.post('/deployments', mlRateLimiter, (req: Request, res: Response) => {
  const parsed = StartDeploymentRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }
  const { version_id, mode, symbol, timeframe } = parsed.data;

  // Live mode env gate
  if (mode === 'live' && !isLiveDeployEnabled()) {
    return res.status(403).json({
      error: 'live deployments disabled',
      details: 'set ENABLE_LIVE_DEPLOY=1 to enable, with the MLBridge ZMQ scoring engine reachable at MLBRIDGE_ENDPOINT.',
    });
  }

  // Verify the model version exists (FK is RESTRICT but a 404 is friendlier than a 500)
  const [version] = db
    .select({ versionId: modelVersions.versionId, status: modelVersions.status })
    .from(modelVersions)
    .where(eq(modelVersions.versionId, version_id))
    .all();
  if (!version) {
    return res.status(404).json({ error: 'model version not found' });
  }

  // Belt-and-suspenders: re-query for an existing running live deployment for
  // this (symbol, timeframe). The partial unique index in the migration would
  // catch a duplicate too, but a clean 409 is better than a SQLITE_CONSTRAINT.
  if (mode === 'live') {
    const existing = db
      .select({ id: deployments.deploymentId })
      .from(deployments)
      .where(and(
        eq(deployments.symbol, symbol),
        eq(deployments.timeframe, timeframe),
        eq(deployments.mode, 'live'),
        eq(deployments.status, 'running'),
      ))
      .all();
    if (existing.length > 0) {
      return res.status(409).json({
        error: 'a live deployment is already running for this (symbol, timeframe)',
        details: { existingDeploymentId: existing[0]!.id },
      });
    }
  }

  const ts = new Date().toISOString();
  try {
    const [inserted] = db
      .insert(deployments)
      .values({
        versionId: version_id,
        mode,
        status: 'running',
        symbol,
        timeframe,
        startedAt: ts,
        predictionsEmitted: 0,
      })
      .returning()
      .all();

    // W9.b: live deployments spawn a background polling loop that talks to
    // MLBridge. Fire-and-forget — HTTP response should not block on socket
    // setup, but loop errors must be logged so a failed start doesn't go
    // silent.
    if (inserted && mode === 'live' && isLiveDeployEnabled()) {
      startLiveDeployment(inserted.deploymentId).catch((err) => {
        console.error(
          `[deployments] failed to start live deployment ${inserted.deploymentId}:`,
          err,
        );
      });
    }

    return res.status(201).json(inserted);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (msg.includes('UNIQUE') || msg.includes('CONSTRAINT')) {
      return res.status(409).json({ error: 'deployment constraint violation', details: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

// ─── State transitions: pause / stop ────────────────────────────────────────

function transition(req: Request, res: Response, target: DeploymentStatus): void {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const [current] = db
    .select()
    .from(deployments)
    .where(eq(deployments.deploymentId, id))
    .all();
  if (!current) {
    res.status(404).json({ error: 'deployment not found' });
    return;
  }

  // Validate transition
  const allowed: Record<DeploymentStatus, DeploymentStatus[]> = {
    running: ['paused', 'stopped', 'failed'],
    paused:  ['running', 'stopped', 'failed'],
    stopped: [],
    failed:  [],
  };
  if (!allowed[current.status].includes(target)) {
    res.status(409).json({
      error: `cannot transition ${current.status} -> ${target}`,
      details: `terminal states (stopped, failed) cannot be re-transitioned`,
    });
    return;
  }

  const ts = new Date().toISOString();
  const update: Partial<Deployment> = { status: target };
  if (target === 'stopped' || target === 'failed') {
    update.stoppedAt = ts;
  }

  const [updated] = db
    .update(deployments)
    .set(update)
    .where(eq(deployments.deploymentId, id))
    .returning()
    .all();

  // W9.b: when transitioning a live deployment, tear down (or pause) the
  // polling loop. Non-live deployments (shadow / paper) have no loop yet —
  // those modes land in W9.e. Errors are logged but never block the HTTP
  // response since the SQLite state is already committed.
  if (current.mode === 'live' && isLiveDeployEnabled()) {
    if (target === 'paused') {
      pauseLiveDeployment(id).catch((err) => {
        console.error(`[deployments] failed to pause live deployment ${id}:`, err);
      });
    } else if (target === 'stopped' || target === 'failed') {
      stopLiveDeployment(id).catch((err) => {
        console.error(`[deployments] failed to stop live deployment ${id}:`, err);
      });
    }
  }

  res.json(updated);
}

router.post('/deployments/:id/pause', mlRateLimiter, (req: Request, res: Response) => {
  transition(req, res, 'paused');
});

router.post('/deployments/:id/stop', mlRateLimiter, (req: Request, res: Response) => {
  transition(req, res, 'stopped');
});

export default router;
