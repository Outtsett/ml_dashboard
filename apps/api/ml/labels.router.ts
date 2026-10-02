import { Router, Request, Response } from "express";
import { mlRateLimiter } from "../infrastructure/lib/rateLimiter";
import { getString } from "../infrastructure/lib/routeHelpers";

const router = Router();

// ============================================================
// LABEL GENERATION API
// ============================================================

let labelServiceModule: typeof import("../infrastructure/lib/labels/labelService") | null = null;

async function getLabelService() {
  if (!labelServiceModule) {
    labelServiceModule = await import('../infrastructure/lib/labels/labelService');
  }
  return labelServiceModule.labelService;
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * POST /api/labels/generate — request a label set.
 *
 * Answers 202 with the ledger row while the job runs (generate → validate →
 * land → catalog); poll `GET /labels/:id` or `GET /labels/lifecycle` for the
 * stage. The same recipe (generator, symbol, timeframe, parameters, window)
 * answers 200 with the existing set; `force: true` regenerates it in place.
 * `?wait=1` runs the job inline (scripts, tests) — Express's 30 s API timeout
 * still applies, so it suits short windows only.
 */
router.post("/labels/generate", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const labelService = await getLabelService();
    const { name, generatorType, symbol, modelId, params, timeframeMinutes, startTimestamp, endTimestamp, force } = req.body;

    if (!name || !generatorType || !symbol) {
      return res.status(400).json({
        error: "Missing required fields: name, generatorType, symbol"
      });
    }

    const wait = req.query.wait === '1' || req.query.wait === 'true';
    const result = await labelService.generateLabels({
      name,
      generatorType,
      symbol,
      modelId,
      params: params || {},
      timeframeMinutes: timeframeMinutes || 1,
      startTimestamp: numberOrUndefined(startTimestamp),
      endTimestamp: numberOrUndefined(endTimestamp),
      force: Boolean(force),
    }, { wait });

    if (!result.success) {
      return res.status(500).json({ error: result.error, labelSetId: result.labelSetId });
    }
    if (result.existing) return res.status(200).json(result);
    res.status(result.accepted ? 202 : 201).json(result);
  } catch (error) {
    console.error("Error generating labels:", error);
    res.status(500).json({ error: "Failed to generate labels" });
  }
});

// Preview labels without storing
router.post("/labels/preview", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const labelService = await getLabelService();
    const { generatorType, symbol, params, limit, startTimestamp, endTimestamp, timeframeMinutes } = req.body;

    if (!generatorType || !symbol) {
      return res.status(400).json({
        error: "Missing required fields: generatorType, symbol"
      });
    }

    const result = await labelService.previewLabels({
      generatorType,
      symbol,
      params: params || {},
      limit: limit || 500,
      startTimestamp,
      endTimestamp,
      timeframeMinutes: timeframeMinutes || 1,
    });

    res.json(result);
  } catch (error) {
    console.error("Error previewing labels:", error);
    res.status(500).json({ error: "Failed to preview labels" });
  }
});

// Get all label sets
router.get("/labels", async (req: Request, res: Response) => {
  try {
    const labelService = await getLabelService();
    const labelSets = await labelService.getLabelSets({
      symbol: getString(req.query.symbol as string) || undefined,
      generatorType: getString(req.query.generatorType as string) || undefined,
      modelId: req.query.modelId ? parseInt(getString(req.query.modelId as string)) : undefined,
      status: getString(req.query.status as string) || undefined,
      stage: getString(req.query.stage as string) || undefined,
      limit: req.query.limit ? parseInt(getString(req.query.limit as string)) : 50,
    });
    res.json(labelSets);
  } catch (error) {
    console.error("Error fetching label sets:", error);
    res.status(500).json({ error: "Failed to fetch label sets" });
  }
});

// Get label history (MUST be before /:id to avoid route shadowing)
router.get("/labels/history", async (req: Request, res: Response) => {
  try {
    const labelService = await getLabelService();
    const labelSets = await labelService.getLabelSets({
      symbol: getString(req.query.symbol as string) || undefined,
      limit: req.query.limit ? parseInt(getString(req.query.limit as string)) : 50,
    });
    res.json({ history: labelSets ?? [] });
  } catch (error) {
    console.error("Error fetching label history:", error);
    res.json({ history: [] });
  }
});

// Get available label generators (MUST be before /:id to avoid route shadowing)
router.get("/labels/generators", async (_req: Request, res: Response) => {
  try {
    const { LABEL_GENERATORS } = await import('@shared/mlTaxonomy');
    res.json(LABEL_GENERATORS);
  } catch (error) {
    console.error("Error fetching generators:", error);
    res.status(500).json({ error: "Failed to fetch generators" });
  }
});

/**
 * GET /api/labels/lifecycle — where every label set stands (contract in
 * `packages/shared/src/labels/contract.ts`). `?probe=0` skips the source-coverage probe
 * that detects staleness.
 */
router.get("/labels/lifecycle", async (req: Request, res: Response) => {
  try {
    const { getLabelLifecycle } = await import('../infrastructure/lib/labels/labelLifecycle');
    res.json(await getLabelLifecycle({ probeSources: req.query.probe !== '0' }));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/** Re-read the manifests and redefine the derived-dataset views (after a landing from another process). */
router.post("/labels/catalog/refresh", async (_req: Request, res: Response) => {
  try {
    const { refreshDerivedViews } = await import('../infrastructure/database/lake');
    const views = await refreshDerivedViews();
    res.json({ views: views.length, labels: views.includes('derived_labels') });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/** The canonical suite: its entries and the state of the last run. */
router.get("/labels/suite", async (_req: Request, res: Response) => {
  try {
    const { LABEL_SUITE, suiteState } = await import('../infrastructure/lib/labels/labelSuite');
    res.json({ entries: LABEL_SUITE, state: suiteState() });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/** Start the suite in the background (idempotent through recipes). Body: { force?, symbol?, timeframeMinutes?, generatorType? }. */
router.post("/labels/suite", mlRateLimiter, async (req: Request, res: Response) => {
  try {
    const { runLabelSuite, suiteState } = await import('../infrastructure/lib/labels/labelSuite');
    if (suiteState().running) return res.status(409).json({ error: 'The label suite is already running', state: suiteState() });
    const { force, symbol, timeframeMinutes, generatorType } = req.body ?? {};
    const only = (entry: { symbol: string; timeframeMinutes: number; generatorType: string }) =>
      (!symbol || entry.symbol === String(symbol).toUpperCase()) &&
      (!timeframeMinutes || entry.timeframeMinutes === Number(timeframeMinutes)) &&
      (!generatorType || entry.generatorType === generatorType);
    const run = runLabelSuite({ force: Boolean(force), only });
    run.catch((error) => console.error('[labels] suite failed:', error));
    res.status(202).json({ accepted: true, state: suiteState() });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get specific label set
router.get("/labels/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const labelService = await getLabelService();
    const id = parseInt(req.params.id);
    const labelSet = await labelService.getLabelSetById(id);

    if (!labelSet) {
      return res.status(404).json({ error: "Label set not found" });
    }

    res.json(labelSet);
  } catch (error) {
    console.error("Error fetching label set:", error);
    res.status(500).json({ error: "Failed to fetch label set" });
  }
});

/**
 * GET /api/labels/:id/rows — the persisted rows of a label set, read back
 * from the lake. Query: from / to (unix ms), limit (default 5000),
 * usable (default 1: only rows the contract marks usable).
 *
 * This is what makes a saved set usable: the chart overlays it, a notebook
 * queries the same parquet, and a training run receives its path.
 */
router.get("/labels/:id/rows", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const labelService = await getLabelService();
    const id = parseInt(req.params.id);
    const labelSet = await labelService.getLabelSetById(id);
    if (!labelSet) return res.status(404).json({ error: "Label set not found" });
    if (!labelSet.parquetPath) {
      return res.status(409).json({
        error: `Label set ${id} has no persisted rows (status '${labelSet.status}', stage '${labelSet.stage}').`,
      });
    }
    // A set that failed a gate sits under `derived/labels/_rejected/` for
    // inspection only; its rows are served solely when asked for by name.
    if (!labelSet.landedAt && req.query.rejected !== '1') {
      return res.status(409).json({
        error: `Label set ${id} did not land: ${labelSet.errorMessage ?? 'validation failed'}. Add ?rejected=1 to inspect its rows anyway.`,
        rejected: true,
      });
    }
    const { readLabelSetRows } = await import('../infrastructure/lib/labels/labelSetStore');
    const fromMs = Number(req.query.from);
    const toMs = Number(req.query.to);
    const limit = Number(req.query.limit);
    const rows = await readLabelSetRows(labelSet.parquetPath, {
      startMs: Number.isFinite(fromMs) ? fromMs : undefined,
      endMs: Number.isFinite(toMs) ? toMs : undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 5000,
      usableOnly: req.query.usable !== '0',
    });
    res.json({ labelSetId: id, parquetPath: labelSet.parquetPath, count: rows.length, rows });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get contrastive pairs for a label set
router.get("/labels/:id/pairs", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const labelService = await getLabelService();
    const id = parseInt(req.params.id);
    const limitStr = req.query.limit;
    const limit = limitStr ? parseInt(typeof limitStr === 'string' ? limitStr : String(limitStr)) : 1000;

    const pairs = await labelService.getContrastivePairsForLabelSet(id, limit);
    res.json(pairs);
  } catch (error) {
    console.error("Error fetching contrastive pairs:", error);
    res.status(500).json({ error: "Failed to fetch contrastive pairs" });
  }
});

/** Regenerate a set in place (same recipe, new rows), e.g. after the source bars moved. */
router.post("/labels/:id/regenerate", mlRateLimiter, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const labelService = await getLabelService();
    const id = parseInt(req.params.id);
    const labelSet = await labelService.getLabelSetById(id);
    if (!labelSet) return res.status(404).json({ error: "Label set not found" });
    const config = JSON.parse(labelSet.config) as Record<string, unknown>;
    const { timeframeMinutes, startTimestamp, endTimestamp, ...params } = config;
    const result = await labelService.generateLabels({
      name: labelSet.name,
      generatorType: labelSet.generatorType,
      symbol: labelSet.symbol,
      params,
      timeframeMinutes: Number(timeframeMinutes ?? labelSet.timeframeMinutes ?? 1),
      startTimestamp: numberOrUndefined(startTimestamp),
      endTimestamp: numberOrUndefined(endTimestamp),
      force: true,
    });
    res.status(result.success ? 202 : 500).json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/** Retire a set: it stays in the ledger and the lake, marked retired. */
router.post("/labels/:id/retire", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const { retireLabelSet } = await import('../infrastructure/lib/labels/labelRepository');
    const id = parseInt(req.params.id);
    await retireLabelSet(id, typeof req.body?.reason === 'string' ? req.body.reason : undefined);
    res.json({ success: true, labelSetId: id, stage: 'retired' });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * DELETE /api/labels/:id — retires the set. `?purge=1` also removes the ledger
 * row; the lake object is never deleted from here (deleting data is a person's
 * decision, made in the lake, not a dashboard button).
 */
router.delete("/labels/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const labelService = await getLabelService();
    const { retireLabelSet } = await import('../infrastructure/lib/labels/labelRepository');
    const id = parseInt(req.params.id);
    if (req.query.purge === '1') {
      await labelService.deleteLabelSet(id);
      return res.json({ success: true, purged: true });
    }
    await retireLabelSet(id, 'retired from the dashboard');
    res.json({ success: true, stage: 'retired' });
  } catch (error) {
    console.error("Error deleting label set:", error);
    res.status(500).json({ error: "Failed to delete label set" });
  }
});

export default router;
