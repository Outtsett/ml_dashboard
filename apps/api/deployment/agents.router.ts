/**
 * Agents Routes (W8.c) — HTTP layer for the Claude Agent SDK dispatcher.
 *
 * SRP: parse + Zod-validate, dispatch to lib/agentDispatcher, format response.
 *      No business logic inline.
 * DIP: depends on agentDispatcher abstraction; never spawns the SDK directly.
 *
 * Routes:
 *   POST /api/agents/dispatch
 *     body: { agentId, contextBlob }
 *     202 { runId }                 — queued, async execution
 *
 *   GET  /api/agents/runs/:runId
 *     200 { runId, agentId, status, requestedAt, startedAt,
 *           completedAt, output, error }
 *     404                            — runId not found
 *
 * The SSE channel `/api/events/agents/:runId` is owned by routes/eventsAgents
 * (W8.d). It consumes `getReplayBuffer()` / `getAgentRun()` from the
 * dispatcher to support reconnect-replay.
 *
 * Per backend §10 risk row 6, SDK 429 / rate-limit failures are surfaced as
 * structured JSON in `agent_runs.error`:
 *   {"code":"rate_limit","retry_after":<seconds>,"message":<text>}
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { mlRateLimiter } from '../infrastructure/lib/rateLimiter';
import {
  dispatch,
  getAgentRun,
  isValidAgentId,
  type AgentContextBlob,
} from '../infrastructure/lib/agentDispatcher';
import type { AgentId } from '@shared/pg_schema';

const router = Router();

// ─── Zod schemas (exported via z.infer for frontend reuse) ──────────────────

const AgentIdSchema = z.enum([
  'feature-curator',
  'arch-designer',
  'hpo-strategist',
  'eval-reviewer',
]);

/**
 * Context blob is intentionally permissive — each agent's enrichment
 * function reads what it needs. We require an object (not array, not null)
 * and cap raw size to keep abusive payloads out of the queue.
 */
const ContextBlobSchema = z
  .record(z.unknown())
  .refine(
    (v) => v !== null && !Array.isArray(v),
    { message: 'contextBlob must be a JSON object' },
  )
  .refine(
    (v) => JSON.stringify(v).length <= 100_000,
    { message: 'contextBlob exceeds 100kb size cap' },
  );

export const DispatchRequest = z.object({
  agentId: AgentIdSchema,
  contextBlob: ContextBlobSchema,
});
export type DispatchRequestInput = z.infer<typeof DispatchRequest>;

const RunIdParamSchema = z.object({
  runId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_\-]+$/, {
    message: 'runId must be alphanumeric (with _ or -)',
  }),
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

// ─── POST /api/agents/dispatch ──────────────────────────────────────────────

router.post('/agents/dispatch', mlRateLimiter, (req: Request, res: Response) => {
  const parsed = DispatchRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }

  const { agentId, contextBlob } = parsed.data;

  // Defense-in-depth — Zod already enums this.
  if (!isValidAgentId(agentId)) {
    return res.status(400).json({ error: 'Invalid agentId' });
  }

  try {
    const runId = dispatch(agentId as AgentId, contextBlob as AgentContextBlob);
    return res.status(202).json({ runId });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (msg.includes('no such table')) {
      return res.status(503).json({
        error: 'agent_runs table not yet migrated',
        details: msg,
        hint: 'apply migrations/0003_agent_runs.sql',
      });
    }
    return res.status(500).json({ error: msg });
  }
});

// ─── GET /api/agents/runs/:runId ────────────────────────────────────────────

router.get('/agents/runs/:runId', (req: Request, res: Response) => {
  const parsed = RunIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }

  let row;
  try {
    row = getAgentRun(parsed.data.runId);
  } catch (err) {
    return res.status(500).json({ error: (err as Error)?.message ?? String(err) });
  }

  if (!row) {
    return res.status(404).json({ error: 'agent run not found', runId: parsed.data.runId });
  }

  return res.json({
    runId: row.runId,
    agentId: row.agentId,
    status: row.status,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    output: row.output,
    error: row.error,
  });
});

export default router;

