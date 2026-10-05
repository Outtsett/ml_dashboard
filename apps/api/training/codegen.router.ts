/**
 * Codegen Routes — HTTP layer for the model-code generator.
 *
 * SRP: parse + validate via Zod, dispatch to `lib/codeGenerator`, format
 *      response. No business logic inline.
 * DIP: depends on `codeGenerator` abstraction; never spawns Python directly.
 *
 * Routes:
 *   POST /api/training/generate-code   — Render templates, return file map
 *                                        (dry-run; nothing written to disk)
 *   POST /api/training/save-generated  — Materialize files to disk + patch
 *                                        runners.json (Python-side)
 *   GET  /api/training/templates       — List available .j2 templates under
 *                                        src/templates/architectures/
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CACHE_SEMI } from '../infrastructure/cache/headers';
import { mlRateLimiter } from '../infrastructure/lib/rateLimiter';
import {
  generatePreview,
  saveAndRegister,
  withPurgeCoveringHorizon,
  CodeGeneratorError,
  type GeneratorPayload,
  type SavePayload,
} from '../infrastructure/lib/codeGenerator';

const router = Router();

// ─── Zod schemas (exported via z.infer for frontend reuse) ──────────────────

const TimeframeSchema = z.enum([
  '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w',
]);

/**
 * Any label generator id, or `none`. The four kernel strategies
 * (`triple_barrier`, `next_close_direction`, `range_bucket`, `structural`) can
 * be generated inside the trainer; every other generator trains from a landed
 * label set (`labelSetId` on the training request), which the trainer refuses
 * to run without.
 */
const LabelStrategySchema = z.string().regex(/^[a-z0-9_]+$/, 'labelStrategy must be a generator id');

const HyperparametersSchema = z.record(
  z.union([z.number(), z.string(), z.boolean()]),
);

const LabelParamsSchema = z.record(
  z.union([z.number(), z.string(), z.boolean()]),
);

const WalkForwardSchema = z.object({
  trainMonths: z.number().int().positive(),
  testMonths: z.number().int().positive(),
  stepMonths: z.number().int().positive(),
  purgeBars: z.number().int().min(0).default(0),
});

/** Slug constraint shared by modelId / catalogId. */
const ModelIdSchema = z.string().regex(/^[a-z0-9_]+$/, 'modelId must be [a-z0-9_]+');

/**
 * POST /api/training/generate-code
 * Body: GenerateCodeRequest
 * Resp: GeneratorResult ({ files, templateUsed, warnings, hash })
 */
export const GenerateCodeRequest = z.object({
  catalogId: z.string().min(1),
  modelId: ModelIdSchema.optional(),
  hyperparameters: HyperparametersSchema,
  walkForward: WalkForwardSchema.nullable(),
  labelStrategy: LabelStrategySchema,
  labelParams: LabelParamsSchema,
  featurePipeline: z.string().min(1),
  featureCategories: z.array(z.string()),
  symbol: z.string().min(1),
  timeframe: TimeframeSchema,
});
export type GenerateCodeRequestInput = z.infer<typeof GenerateCodeRequest>;

/**
 * POST /api/training/save-generated
 * Body: SaveGeneratedRequest (extends GenerateCodeRequest, modelId required)
 * Resp: SaveResult ({ savedPaths, runnerKey, templateUsed, warnings })
 */
export const SaveGeneratedRequest = GenerateCodeRequest.extend({
  modelId: ModelIdSchema,
  files: z.record(z.string()).optional(),
  registerInRunners: z.boolean().default(true),
});
export type SaveGeneratedRequestInput = z.infer<typeof SaveGeneratedRequest>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatZodErrors(error: z.ZodError): { error: string; details: unknown } {
  return {
    error: 'Invalid request body',
    details: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    })),
  };
}

// ─── POST /training/generate-code ───────────────────────────────────────────

router.post('/training/generate-code', mlRateLimiter, async (req: Request, res: Response) => {
  const parsed = GenerateCodeRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }

  // The Zod schema returns a value compatible with GeneratorPayload but
  // typed without the brand; cast through the structurally-equivalent
  // interface so the generator sees the right shape.
  // The purge is never below the label horizon (see `withPurgeCoveringHorizon`).
  const clamped = withPurgeCoveringHorizon(parsed.data);
  const payload: GeneratorPayload = clamped.payload;

  try {
    const result = await generatePreview(payload);
    res.json(clamped.warning ? { ...result, warnings: [...(result.warnings ?? []), clamped.warning] } : result);
  } catch (err) {
    if (err instanceof CodeGeneratorError) {
      return res.status(500).json({
        error: err.message,
        details: { stderr: err.stderr, exitCode: err.exitCode },
      });
    }
    res.status(500).json({
      error: (err as Error)?.message ?? String(err),
    });
  }
});

// ─── POST /training/save-generated ──────────────────────────────────────────

router.post('/training/save-generated', mlRateLimiter, async (req: Request, res: Response) => {
  const parsed = SaveGeneratedRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json(formatZodErrors(parsed.error));
  }

  const clamped = withPurgeCoveringHorizon(parsed.data);
  const payload: SavePayload = { ...parsed.data, walkForward: clamped.payload.walkForward };

  try {
    const result = await saveAndRegister(payload);
    res.status(201).json(clamped.warning ? { ...result, warnings: [...(result.warnings ?? []), clamped.warning] } : result);
  } catch (err) {
    if (err instanceof CodeGeneratorError) {
      return res.status(500).json({
        error: err.message,
        details: { stderr: err.stderr, exitCode: err.exitCode },
      });
    }
    res.status(500).json({
      error: (err as Error)?.message ?? String(err),
    });
  }
});

// ─── GET /training/templates ────────────────────────────────────────────────

interface TemplateEntry {
  id: string;
  filename: string;
}

/**
 * Read template filenames from `src/templates/architectures/`. Templates whose
 * filename starts with `_` are includes-only (e.g. `_base.py.j2`,
 * `_walk_forward.py.j2`) and are excluded from this list — they are not
 * directly selectable by the user, only `{% include %}`d by other templates.
 */
function listTemplates(): TemplateEntry[] {
  const dir = path.resolve(process.cwd(), 'src', 'templates', 'architectures');
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const result: TemplateEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.py.j2')) continue;
    if (entry.name.startsWith('_')) continue; // include-only
    const id = entry.name.replace(/\.py\.j2$/, '');
    result.push({ id, filename: entry.name });
  }
  // Stable order so the frontend doesn't see flapping
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

router.get('/training/templates', CACHE_SEMI, (_req: Request, res: Response) => {
  try {
    res.json({ templates: listTemplates() });
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message ?? String(err) });
  }
});

export default router;
