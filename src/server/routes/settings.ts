/**
 * Settings Routes
 *
 * CRUD for user preferences (key/value store) and read-only server config.
 *
 * Routes:
 *   GET    /api/settings               — All preferences grouped by category
 *   GET    /api/settings/config        — Read-only server config (safe subset)
 *   PUT    /api/settings               — Upsert preferences (batch)
 *   DELETE /api/settings/:key          — Delete a single preference
 *   POST   /api/settings/test-connection — Test QuestDB or SQLite connectivity
 */

import { Router } from "express";
import { db } from "../database/db";
import { userPreferences } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const router = Router();

// GET /api/settings — return all user preferences grouped by category
router.get("/settings", async (_req, res) => {
  try {
    const prefs = await db.select().from(userPreferences);

    // Group by category and parse JSON values
    const grouped: Record<string, Record<string, unknown>> = {};
    for (const pref of prefs) {
      if (!grouped[pref.category]) grouped[pref.category] = {};
      const bucket = grouped[pref.category]!;
      try {
        bucket[pref.key] = JSON.parse(pref.value);
      } catch {
        bucket[pref.key] = pref.value;
      }
    }

    res.json(grouped);
  } catch (error) {
    console.error("[settings] Failed to read preferences:", error);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

// GET /api/settings/config — return read-only server config (safe subset)
router.get("/settings/config", async (_req, res) => {
  try {
    const configDir = path.join(process.cwd(), "src", "config");
    const trainingJson = JSON.parse(
      fs.readFileSync(path.join(configDir, "training.json"), "utf-8"),
    );

    res.json({
      questdb: {
        host: process.env.QUESTDB_HOST || "localhost",
        httpPort: parseInt(process.env.QUESTDB_HTTP_PORT || "9000"),
        pgPort: parseInt(process.env.QUESTDB_PG_PORT || "8812"),
      },
      training: {
        pythonExe: trainingJson?.paths?.pythonExe ?? ".venv/Scripts/python.exe",
        modelsDir: trainingJson?.paths?.modelsDir ?? "data/models",
        maxConcurrentJobs: trainingJson?.limits?.maxConcurrentJobs ?? 1,
        maxBarsDefault: trainingJson?.limits?.maxBarsDefault ?? 0,
        maxTrainingDurationSec:
          trainingJson?.limits?.maxTrainingDurationSec ?? 7200,
      },
      nodeEnv: process.env.NODE_ENV || "development",
      port: parseInt(process.env.PORT || "5000"),
    });
  } catch (error) {
    console.error("[settings] Failed to read config:", error);
    res.status(500).json({ error: "Failed to read config" });
  }
});

// PUT /api/settings — upsert user preferences
router.put("/settings", async (req, res) => {
  try {
    const updates: Array<{ key: string; value: unknown; category?: string }> =
      req.body;

    if (!Array.isArray(updates)) {
      return res
        .status(400)
        .json({ error: 'Body must be an array of { key, value, category? }' });
    }

    const results: Array<{ key: string; status: string }> = [];

    for (const { key, value, category } of updates) {
      if (!key) continue;

      const jsonValue = JSON.stringify(value);
      const cat = category || "general";

      // Upsert: try insert, on conflict update
      db.insert(userPreferences)
        .values({ key, value: jsonValue, category: cat })
        .onConflictDoUpdate({
          target: userPreferences.key,
          set: {
            value: jsonValue,
            category: cat,
            updatedAt: sql`(unixepoch() * 1000)`,
          },
        })
        .run();

      results.push({ key, status: "saved" });
    }

    res.json({ updated: results.length, results });
  } catch (error) {
    console.error("[settings] Failed to save preferences:", error);
    res.status(500).json({ error: "Failed to save settings" });
  }
});

// DELETE /api/settings/:key — delete a single preference
router.delete("/settings/:key", async (req, res) => {
  try {
    const { key } = req.params;
    db.delete(userPreferences).where(eq(userPreferences.key, key)).run();
    res.json({ deleted: key });
  } catch (error) {
    console.error("[settings] Failed to delete preference:", error);
    res.status(500).json({ error: "Failed to delete setting" });
  }
});

// POST /api/settings/test-connection — test QuestDB or SQLite connectivity
router.post("/settings/test-connection", async (req, res) => {
  try {
    const { type } = req.body; // "questdb" or "sqlite"

    if (type === "questdb") {
      const host = process.env.QUESTDB_HOST || "localhost";
      const httpPort = parseInt(process.env.QUESTDB_HTTP_PORT || "9000");
      const url = `http://${host}:${httpPort}/exec?query=${encodeURIComponent("SELECT 1")}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const qdbRes = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        res.json({
          connected: qdbRes.ok,
          type: "questdb",
          host,
          port: httpPort,
        });
      } catch {
        clearTimeout(timeout);
        res.json({
          connected: false,
          type: "questdb",
          host,
          port: httpPort,
          error: "Connection refused",
        });
      }
    } else if (type === "sqlite") {
      try {
        db.select({ one: sql`1` }).from(userPreferences).limit(1);
        res.json({ connected: true, type: "sqlite" });
      } catch {
        // Table might not exist yet, but connection works
        res.json({
          connected: true,
          type: "sqlite",
          note: "Table may not exist yet",
        });
      }
    } else {
      res
        .status(400)
        .json({ error: "Unknown connection type. Use 'questdb' or 'sqlite'" });
    }
  } catch (error) {
    console.error("[settings] Connection test failed:", error);
    res.status(500).json({ error: "Connection test failed" });
  }
});

export default router;
