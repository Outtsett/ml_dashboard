/**
 * Data Management Router — REST endpoints for dataset lifecycle management.
 *
 * Endpoints:
 *   GET    /api/data/datasets     — List cached dataset snapshots
 *   DELETE /api/data/datasets/:id — Purge a specific dataset snapshot
 *   GET    /api/data/disk-usage   — Report storage consumption per category
 *   POST   /api/data/cleanup      — Trigger cleanup of stale run artifacts
 */
import { Router, type Request, type Response } from "express";
import { getDataManager } from "./dataManager";

/** Narrow an unknown thrown value to a message. `catch (e: any)` hides the
  * case where what was thrown is not an Error at all — a string, or undefined
  * from a rejected promise — and `e.message` is then silently undefined. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const router = Router();

/** List all cached dataset snapshots */
router.get("/data/datasets", (_req: Request, res: Response) => {
  try {
    const dm = getDataManager();
    const datasets = dm.listDatasets();
    res.json({ datasets });
  } catch (e: unknown) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

/** Delete a cached dataset snapshot */
router.delete("/data/datasets/:id", (req: Request, res: Response) => {
  try {
    const dm = getDataManager();
    const id = req.params.id as string;
    const deleted = dm.deleteDataset(id);
    if (deleted) {
      res.json({ success: true, message: `Dataset ${req.params.id} deleted` });
    } else {
      res.status(404).json({ error: `Dataset ${req.params.id} not found` });
    }
  } catch (e: unknown) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

/** Report disk usage per data category */
router.get("/data/disk-usage", (_req: Request, res: Response) => {
  try {
    const dm = getDataManager();
    const usage = dm.getDiskUsage();
    const totalBytes = usage.reduce((sum, u) => sum + u.sizeBytes, 0);
    res.json({ usage, totalBytes });
  } catch (e: unknown) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

/** Trigger cleanup of stale run artifacts */
router.post("/data/cleanup", (_req: Request, res: Response) => {
  try {
    const dm = getDataManager();
    const cleaned = dm.cleanupStaleRuns();
    res.json({ success: true, cleanedRuns: cleaned });
  } catch (e: unknown) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

export default router;
