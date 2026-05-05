import { Router, Request, Response } from "express";
import { readFile } from "fs/promises";
import { join } from "path";
import { getString } from "./helpers";

const router = Router();

const ARTIFACTS_DIR = join("E:", "source", "MotiveWave", "trading_models", "checkpoints", "artifacts");

// GET /api/training/artifacts/:phase/:name
// Serves JSON artifact files (confusion matrices, heatmaps, reliability bins, etc.)
router.get("/training/artifacts/:phase/:name", async (req: Request, res: Response) => {
  const phase = getString(req.params.phase);
  const name = getString(req.params.name);

  // Validate phase
  if (!phase || !/^[A-E]$/.test(phase)) {
    return res.status(400).json({ error: "Invalid phase. Must be A-E." });
  }

  // Validate artifact name (alphanumeric, underscores, hyphens)
  if (!name || !/^[a-z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: "Invalid artifact name" });
  }

  try {
    const filePath = join(ARTIFACTS_DIR, phase, `${name}.json`);
    const raw = await readFile(filePath, "utf-8");
    res.json(JSON.parse(raw));
  } catch {
    res.status(404).json({ error: "Artifact not found" });
  }
});

export default router;
