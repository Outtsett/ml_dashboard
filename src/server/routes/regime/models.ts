/**
 * HDP-HMM Regime Detection — Model CRUD Routes
 *
 * Routes:
 *   GET    /api/regime/models            — list trained regime models
 *   GET    /api/regime/diagnostics/:id   — diagnostics JSON for a model
 *   GET    /api/regime/convergence/:id   — convergence JSON for a model
 *   GET    /api/regime/assignments/:id   — per-bar regime assignments (parquet)
 *   DELETE /api/regime/models/:id        — delete a trained model
 */

import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { MODELS_DIR } from "./jobManager";

const router = Router();

// ─── List trained regime models ──────────────────────────────────────────────

router.get("/regime/models", async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(MODELS_DIR)) {
      return res.json({ models: [] });
    }

    const dirs = fs.readdirSync(MODELS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const models = [];
    for (const dir of dirs) {
      const diagPath = path.join(MODELS_DIR, dir, "diagnostics.json");
      if (fs.existsSync(diagPath)) {
        try {
          const diag = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
          models.push({
            id: dir,
            symbol: diag.symbol,
            timeframe: diag.timeframe,
            n_regimes: diag.n_regimes,
            n_bars: diag.n_bars || diag.n_bars_total,
            n_bars_total: diag.n_bars_total,
            n_bars_train_val: diag.n_bars_train_val,
            n_bars_test: diag.n_bars_test,
            quality_score: diag.quality_score,
            date_range: diag.date_range,
            training_config: diag.training_config,
            training_time_sec: diag.training_time_sec,
            trained_at: diag.trained_at,
          });
        } catch {
          // Skip corrupted diagnostics
        }
      }
    }

    models.sort((a, b) => (b.trained_at || "").localeCompare(a.trained_at || ""));
    res.json({ models });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Get diagnostics for a model ─────────────────────────────────────────────

router.get("/regime/diagnostics/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const diagPath = path.join(MODELS_DIR, id, "diagnostics.json");

    if (!fs.existsSync(diagPath)) {
      return res.status(404).json({ error: `Model '${id}' not found` });
    }

    const diag = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
    res.json(diag);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Get convergence data for a model ────────────────────────────────────────

router.get("/regime/convergence/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const convPath = path.join(MODELS_DIR, id, "convergence.json");

    if (!fs.existsSync(convPath)) {
      return res.status(404).json({ error: `Convergence data for '${id}' not found` });
    }

    const conv = JSON.parse(fs.readFileSync(convPath, "utf-8"));
    res.json(conv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Get per-bar regime assignments ──────────────────────────────────────────

router.get("/regime/assignments/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const parquetPath = path.join(MODELS_DIR, id, "regimes.parquet");

    if (!fs.existsSync(parquetPath)) {
      return res.status(404).json({ error: `Regime assignments not found for '${id}'` });
    }

    const { questdbMarketQuery: marketQuery } = await import("../../lib/questdbMarketQuery");
    const forwardPath = parquetPath.replace(/\\/g, "/");

    const limit = Math.min(Number(req.query.limit) || 50000, 100000);
    const offset = Number(req.query.offset) || 0;

    // Read diagnostics to get symbol + timeframe for OHLCV join
    const diagPath = path.join(MODELS_DIR, id, "diagnostics.json");
    let symbol: string | null = null;
    let timeframe: string | null = null;
    if (fs.existsSync(diagPath)) {
      try {
        const diag = JSON.parse(fs.readFileSync(diagPath, "utf-8"));
        symbol = diag.symbol || null;
        timeframe = diag.timeframe || null;
      } catch { /* ignore */ }
    }

    // Map timeframe string to DuckDB interval
    const tfMap: Record<string, string> = {
      "1m": "1 MINUTE", "5m": "5 MINUTES", "15m": "15 MINUTES",
      "30m": "30 MINUTES", "1H": "1 HOUR", "4H": "4 HOURS",
      "1D": "1 DAY", "1W": "7 DAYS",
    };
    const interval = timeframe ? tfMap[timeframe] || "30 MINUTES" : "30 MINUTES";

    let rows: Record<string, unknown>[];
    if (symbol) {
      const isRoot = symbol.length <= 3 && /^[A-Za-z]+$/.test(symbol);
      const symbolFilter = isRoot
        ? `symbol ~ '^${symbol}[FGHJKMNQUVXZ][0-9]{1,2}$'`
        : `symbol = '${symbol}'`;

      const ohlcvCte = `agg AS (
             SELECT time_bucket(INTERVAL '${interval}', ts) AS bucket_ts,
                    FIRST(open ORDER BY ts) AS open, MAX(high) AS high,
                    MIN(low) AS low, LAST(close ORDER BY ts) AS close,
                    CAST(SUM(volume) AS DOUBLE) AS volume
             FROM ohlcv
             WHERE ${symbolFilter}
             GROUP BY bucket_ts
           )`;

      rows = await marketQuery<Record<string, unknown>>(
        `WITH ${ohlcvCte}
         SELECT r.ts,
                CAST(COALESCE(a.open,  r.close) AS DOUBLE) as open,
                CAST(COALESCE(a.high,  r.close) AS DOUBLE) as high,
                CAST(COALESCE(a.low,   r.close) AS DOUBLE) as low,
                CAST(r.close AS DOUBLE) as close,
                CAST(COALESCE(a.volume, 0) AS DOUBLE) as volume,
                CAST(r.regime AS INTEGER) as regime,
                r.regime_label,
                r.split
         FROM read_parquet('${forwardPath}') r
         LEFT JOIN agg a ON a.bucket_ts = r.ts
         ORDER BY r.ts ASC LIMIT ${limit} OFFSET ${offset}`
      );
    } else {
      rows = await marketQuery<Record<string, unknown>>(
        `SELECT ts, CAST(close AS DOUBLE) as close, CAST(regime AS INTEGER) as regime, regime_label, split
         FROM read_parquet('${forwardPath}') ORDER BY ts ASC LIMIT ${limit} OFFSET ${offset}`
      );
    }

    const total = await marketQuery<{ cnt: number }>(
      `SELECT CAST(COUNT(*) AS DOUBLE) as cnt FROM read_parquet('${forwardPath}')`
    );

    res.json({ rows, total: total[0]?.cnt || rows.length, limit, offset });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Delete a model ──────────────────────────────────────────────────────────

router.delete("/regime/models/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const modelDir = path.join(MODELS_DIR, id);

    if (!fs.existsSync(modelDir)) {
      return res.status(404).json({ error: `Model '${id}' not found` });
    }

    const files = fs.readdirSync(modelDir);
    for (const file of files) {
      fs.unlinkSync(path.join(modelDir, file));
    }
    fs.rmdirSync(modelDir);

    res.json({ message: `Deleted model '${id}'` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
