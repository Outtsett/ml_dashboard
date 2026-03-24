/**
 * MotiveWave Integration API Routes
 *
 * Endpoints:
 *   GET  /motivewave/status     — Watcher state, watched files, recent imports
 *   POST /motivewave/configure  — Set watch directory, enable/disable
 *   POST /motivewave/import     — Manual single-file import
 *   POST /motivewave/start      — Start the file watcher
 *   POST /motivewave/stop       — Stop the file watcher
 */

import { Router } from "express";
import multer from "multer";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { getMotiveWaveWatcher, parseMotiveWaveFilename, parseMotiveWaveCSV } from "../lib/motivewave";
import { detectInstrumentType, getBaseTableForType } from "../database/questdb/marketData";
import { getQuestDBSender } from "../database/questdb/connection";

const router = Router();
const UPLOAD_DIR = resolve(process.cwd(), "tmp", "motivewave");
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const fs = require("node:fs");
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._\-]/g, "_")}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

// ── GET /motivewave/status ──────────────────────────────────────────────────

router.get("/motivewave/status", (_req, res) => {
  const watcher = getMotiveWaveWatcher();
  res.json(watcher.getStatus());
});

// ── POST /motivewave/configure ──────────────────────────────────────────────

router.post("/motivewave/configure", (req, res) => {
  const { watchDir, enabled, debounceMs } = req.body;

  if (watchDir !== undefined && typeof watchDir !== "string") {
    res.status(400).json({ error: "watchDir must be a string" });
    return;
  }
  if (watchDir && !existsSync(watchDir)) {
    res.status(400).json({ error: `Directory does not exist: ${watchDir}` });
    return;
  }

  const watcher = getMotiveWaveWatcher();
  const update: Record<string, any> = {};
  if (watchDir !== undefined) update.watchDir = watchDir;
  if (enabled !== undefined) update.enabled = !!enabled;
  if (debounceMs !== undefined) update.debounceMs = Math.max(50, Number(debounceMs));

  watcher.configure(update);

  // Auto-start/stop based on enabled flag
  if (update.enabled === true && !watcher.getStatus().running) {
    watcher.start().catch((err) => {
      console.error("[motivewave] Failed to start:", err.message);
    });
  } else if (update.enabled === false && watcher.getStatus().running) {
    watcher.stop().catch((err) => {
      console.error("[motivewave] Failed to stop:", err.message);
    });
  }

  res.json({ message: "Configuration updated", config: watcher.getConfig() });
});

// ── POST /motivewave/start ──────────────────────────────────────────────────

router.post("/motivewave/start", async (req, res) => {
  const watcher = getMotiveWaveWatcher();
  const config = watcher.getConfig();

  if (!config.watchDir) {
    res.status(400).json({ error: "No watch directory configured. POST /motivewave/configure first." });
    return;
  }

  try {
    await watcher.start();
    res.json({ message: "Watcher started", status: watcher.getStatus() });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to start watcher: ${err.message}` });
  }
});

// ── POST /motivewave/stop ───────────────────────────────────────────────────

router.post("/motivewave/stop", async (_req, res) => {
  const watcher = getMotiveWaveWatcher();
  await watcher.stop();
  res.json({ message: "Watcher stopped", status: watcher.getStatus() });
});

// ── POST /motivewave/import ─────────────────────────────────────────────────

router.post("/motivewave/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const start = performance.now();
  const filename = req.file.originalname;
  const tempPath = req.file.path;

  try {
    // Parse metadata from filename or body
    const meta = parseMotiveWaveFilename(filename);
    const symbol = (req.body.symbol as string) || meta?.symbol;
    if (!symbol) {
      res.status(400).json({
        error: "Cannot determine symbol. Provide 'symbol' in body or use MotiveWave filename pattern.",
      });
      return;
    }

    const content = await readFile(tempPath, "utf-8");
    const { rows, format, errors } = parseMotiveWaveCSV(content, symbol);

    if (rows.length === 0) {
      res.status(400).json({ error: "No valid OHLCV rows found in file", parseErrors: errors });
      return;
    }

    // Determine table
    const instrumentType = detectInstrumentType(symbol);
    const tableName = getBaseTableForType(instrumentType);

    // ILP ingest
    const sender = await getQuestDBSender();
    const BATCH_SIZE = 1000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      for (const row of batch) {
        await sender
          .table(tableName)
          .symbol("symbol", row.symbol)
          .floatColumn("open", row.open)
          .floatColumn("high", row.high)
          .floatColumn("low", row.low)
          .floatColumn("close", row.close)
          .floatColumn("volume", row.volume)
          .at(row.timestamp.getTime(), "ms");
      }
      await sender.flush();
    }

    const durationMs = performance.now() - start;

    console.log(
      `[motivewave] Manual import: ${filename} → ${rows.length} rows → ${tableName} in ${durationMs.toFixed(0)}ms`,
    );

    res.json({
      message: "Import successful",
      filename,
      symbol,
      timeframe: meta?.timeframe || "unknown",
      format,
      rowsImported: rows.length,
      parseErrors: errors,
      table: tableName,
      durationMs: Math.round(durationMs),
    });
  } catch (err: any) {
    console.error(`[motivewave] Import error for ${filename}:`, err.message);
    res.status(500).json({ error: `Import failed: ${err.message}` });
  } finally {
    // Clean up temp file
    await unlink(tempPath).catch(() => {});
  }
});

// ── POST /motivewave/import-path ────────────────────────────────────────────
// Import a file from a local path (no upload needed)

router.post("/motivewave/import-path", async (req, res) => {
  const { filePath, symbol: overrideSymbol } = req.body;

  if (!filePath || typeof filePath !== "string") {
    res.status(400).json({ error: "filePath is required" });
    return;
  }

  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    res.status(404).json({ error: `File not found: ${resolved}` });
    return;
  }

  const watcher = getMotiveWaveWatcher();
  const filename = basename(resolved);
  const meta = parseMotiveWaveFilename(filename);
  const symbol = overrideSymbol || meta?.symbol;

  if (!symbol) {
    res.status(400).json({
      error: "Cannot determine symbol. Provide 'symbol' in body or use MotiveWave filename pattern.",
    });
    return;
  }

  try {
    const result = await watcher.processFile(resolved, meta ? { ...meta, symbol } : { symbol, timeframe: "unknown", session: "ALL" });
    if (!result) {
      res.json({ message: "File unchanged since last import, skipped" });
      return;
    }
    res.json({
      message: "Import successful",
      filename,
      symbol: result.symbol,
      timeframe: result.timeframe,
      format: result.format,
      rowsImported: result.rows.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Import failed: ${err.message}` });
  }
});

export default router;
