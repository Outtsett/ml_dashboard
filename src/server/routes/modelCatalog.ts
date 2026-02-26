/**
 * Model Catalog route — HTTP layer ONLY for browsing algo_model specs.
 *
 * SRP: Parse params, call service, return JSON. No business logic inline.
 * DIP: Depends on catalogService abstraction, never touches parser or fs.
 *
 * GET  /api/model-catalog              — filtered model list
 * GET  /api/model-catalog/stats        — summary counts
 * GET  /api/model-catalog/taxonomy     — category → subcategory tree
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
} from '../lib/modelImport';

const router = Router();

// ─── GET /model-catalog/stats ───────────────────────────────────────────────

router.get('/model-catalog/stats', (_req: Request, res: Response) => {
  try {
    res.json(getCatalogStats());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /model-catalog/taxonomy ────────────────────────────────────────────

router.get('/model-catalog/taxonomy', (_req: Request, res: Response) => {
  try {
    res.json(getCatalogTaxonomy());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /model-catalog/refresh ────────────────────────────────────────────

router.post('/model-catalog/refresh', (_req: Request, res: Response) => {
  try {
    res.json(refreshCatalog());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
