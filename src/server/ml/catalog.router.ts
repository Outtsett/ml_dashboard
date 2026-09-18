/**
 * Model Catalog route — HTTP layer ONLY for browsing algo_model specs.
 *
 * SRP: Parse params, call service, return JSON. No business logic inline.
 * DIP: Depends on catalogService abstraction, never touches parser or fs.
 *
 * GET  /api/model-catalog              — filtered model list
 * GET  /api/model-catalog/stats        — summary counts
 * GET  /api/model-catalog/taxonomy     — category → subcategory tree
 * GET  /api/model-catalog/lifecycle    — per-spec stage: trainable, trained, lens-ready, deployed
 * GET  /api/model-catalog/:id          — single model detail (raw markdown)
 * POST /api/model-catalog/refresh      — force cache refresh
 */
import { Router, Request, Response } from 'express';
import {
  getCatalogStats,
  getCatalogTaxonomy,
  getCatalogModels,
  getModelById,
  refreshCatalog,
} from '../infrastructure/lib/modelImport';
import { getTrainableModels } from '../infrastructure/lib/catalogBridge';
import { CACHE_SEMI } from '../infrastructure/cache/headers';
import { getCatalogLifecycle } from './lifecycle';

const router = Router();

// ─── GET /model-catalog/stats ───────────────────────────────────────────────

router.get('/model-catalog/stats', CACHE_SEMI, (_req: Request, res: Response) => {
  try {
    res.json(getCatalogStats());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ─── GET /model-catalog/taxonomy ────────────────────────────────────────────

router.get('/model-catalog/taxonomy', CACHE_SEMI, (_req: Request, res: Response) => {
  try {
    res.json(getCatalogTaxonomy());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ─── GET /model-catalog/trainable ───────────────────────────────────────────
//
// Returns the unified trainable-model registry (hand-configured + catalog-
// generated) enriched with `templateId` and `runnerSource` so the frontend
// picker can badge each entry as WIRED / GENERATE-* / BROWSE-ONLY.
//
// Owned by W2.a (backend integration plan §6).  Frontend's
// `useTrainableCatalog()` hook is the canonical consumer.

router.get('/model-catalog/trainable', CACHE_SEMI, (_req: Request, res: Response) => {
  try {
    res.json(getTrainableModels());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ─── GET /model-catalog/lifecycle ───────────────────────────────────────────
//
// Not CACHE_SEMI: a session finishing or a lens record being built changes the
// answer, and the page that reads it is the one you return to after training.

router.get('/model-catalog/lifecycle', (_req: Request, res: Response) => {
  try {
    res.json(getCatalogLifecycle());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ─── GET /model-catalog — filtered list ─────────────────────────────────────

router.get('/model-catalog', (req: Request, res: Response) => {
  try {
    const result = getCatalogModels({
      category: req.query.category as string | undefined,
      subcategory: req.query.subcategory as string | undefined,
      search: req.query.search as string | undefined,
      includeEmpty: req.query.includeEmpty === 'true',
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ─── GET /model-catalog/:id — single model detail ──────────────────────────

router.get('/model-catalog/:id', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? '');
    if (!id) return res.status(400).json({ error: 'id param required' });

    const model = getModelById(id);
    if (!model) {
      return res.status(404).json({ error: `Model "${id}" not found` });
    }
    res.json(model);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ─── POST /model-catalog/refresh ────────────────────────────────────────────

router.post('/model-catalog/refresh', (_req: Request, res: Response) => {
  try {
    res.json(refreshCatalog());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
