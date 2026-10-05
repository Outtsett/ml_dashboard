/**
 * apps/api/tests/lens.test.ts
 *
 * Coverage for apps/api/lens/{lens.router,store,build}.ts:
 *   - modelId validation (400 on traversal/bad chars, mirrors anatomy.test.ts)
 *   - 404 on an unbuilt manifest (no lens/ dir)
 *   - 400 on malformed evaluation/bars query params
 *   - 400 on an out-of-range bars row window
 *   - a REAL evaluation over a small hand-built bars.parquet fixture, read
 *     through store.ts's DuckDB loader and packages/shared/src/lens's evaluateLens —
 *     no mocking below the HTTP layer, so this is the actual parquet -> HTTP
 *     response path. Trade count is hand-derived from the fixture (see
 *     comment at buildFixtureBars) and cross-checked against the shared
 *     compute's own simulateTrades semantics.
 *   - GET /models: mocked `python -m ml.lens.main --inspect-all`, including a
 *     "ready" entry that resolves through the SAME real fixture so its
 *     attached headline is a real evaluateLens() result, not a stub.
 *   - POST /build: mocked spawn — success (200 {manifest}), refusal (409),
 *     concurrent build on the same modelId (409), spawn failure (500).
 *
 * Strategy: child_process is mocked (EventEmitter shim, mirrors
 * apps/api/tests/anatomy.test.ts) ONLY for the /models and /build tests.
 * Everything else uses real files under a throwaway data/models/<id>/lens/
 * directory, because store.ts's DuckDB reader needs real parquet on disk —
 * mocking fs/promises would not reach it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { LENS_QUANTILE_COLUMNS } from "@shared/lens";

// ── Mock child_process BEFORE importing the route module ────────────────────

type SpawnMockHandler = (args: string[]) => {
  stdout: string;
  stderr?: string;
  exitCode?: number | null;
  error?: Error;
  /** Delay the close event past a microtask — used for the concurrency test. */
  deferMs?: number;
};

let spawnHandler: SpawnMockHandler = () => ({ stdout: JSON.stringify({ models: [] }) + "\n", exitCode: 0 });
const spawnCalls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv | undefined }> = [];

vi.mock("child_process", () => {
  return {
    spawn: vi.fn((command: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: (data: string) => void; end: () => void };
        kill: (sig?: string) => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        write: () => {},
        end: () => {
          queueMicrotask(() => {
            spawnCalls.push({ command, args, env: opts?.env });
            const result = spawnHandler(args);
            const emit = () => {
              if (result.error) {
                child.emit("error", result.error);
                return;
              }
              if (result.stdout) child.stdout.emit("data", Buffer.from(result.stdout, "utf8"));
              if (result.stderr) child.stderr.emit("data", Buffer.from(result.stderr, "utf8"));
              child.emit("close", result.exitCode ?? 0);
            };
            if (result.deferMs) setTimeout(emit, result.deferMs);
            else emit();
          });
        },
      };
      child.kill = () => {};
      return child;
    }),
  };
});

// ── Now import the route module (after the mock is registered) ─────────────

import {
  clearLensBuildsInFlight,
  clearLensRouteCaches,
  handleBarsRequest,
  handleBuildRequest,
  handleEvaluationRequest,
  handleManifestRequest,
  handleModelsRequest,
  isValidModelId,
} from "../lens/lens.router";
import { clearLensStoreCache } from "../lens/store";
import type {
  LensBarWindow,
  LensEvaluation,
  LensManifest,
  LensModelEntry,
  LensModelList,
} from "@shared/lens";

// ── Fixture: a real bars.parquet under data/models/<id>/lens/ ───────────────

const ROOT = path.resolve(process.cwd(), "data", "models");
const FIXTURE_MODEL_ID = "__lens_test_fixture__";
const MISSING_MODEL_ID = "__lens_test_missing__";
const FIXTURE_LENS_DIR = path.join(ROOT, FIXTURE_MODEL_ID, "lens");
const FIXTURE_MANIFEST_PATH = path.join(FIXTURE_LENS_DIR, "manifest.json");
const FIXTURE_BARS_PATH = path.join(FIXTURE_LENS_DIR, "bars.parquet");

/**
 * 10 bars, horizon 2, threshold 0.6/0.4 (short side 1 - 0.6).
 * probability_up = [0.8, 0.9, 0.1, 0.5, 0.8, 0.5, 0.1, 0.9, 0.8, 0.5]
 *
 * Hand-walking packages/shared/src/lens/simulate.ts's semantics (offset < lastExit
 * skipped, exit row itself re-openable):
 *   offset 0: 0.8 >= 0.6 -> LONG  entry row0 exit row2  (lastExit=2)
 *   offset 1: 1 < 2      -> skip
 *   offset 2: 0.1 <= 0.4 -> SHORT entry row2 exit row4  (lastExit=4)
 *   offset 3: 3 < 4      -> skip
 *   offset 4: 0.8 >= 0.6 -> LONG  entry row4 exit row6  (lastExit=6)
 *   offset 5: 5 < 6      -> skip
 *   offset 6: 0.1 <= 0.4 -> SHORT entry row6 exit row8  (lastExit=8)
 *   offset 7: 7 < 8      -> skip (lastEntryOffset = 10-2 = 8, loop stops at 7)
 * -> 4 trades, 2 long, 2 short.
 */
const FIXTURE_CLOSE = [100, 101, 99, 102, 98, 103, 97, 104, 96, 105];
const FIXTURE_PROBABILITY_UP = [0.8, 0.9, 0.1, 0.5, 0.8, 0.5, 0.1, 0.9, 0.8, 0.5];
const FIXTURE_START_TS = 1_700_000_000;
const FIXTURE_BAR_SECONDS = 60;
const FIXTURE_HORIZON_BARS = 2;
const FIXTURE_THRESHOLD = 0.6;

function buildFixtureManifest(): LensManifest {
  return {
    modelId: FIXTURE_MODEL_ID,
    builderVersion: 1,
    builtAtIso: "2026-09-15T00:00:00.000Z",
    sourceSchema: "probability_parquet",
    sourceFiles: [],
    symbol: "FIXTURE",
    timeframe: "1m",
    barSeconds: FIXTURE_BAR_SECONDS,
    horizonBars: FIXTURE_HORIZON_BARS,
    horizonSource: "fixture",
    labelDefinition: "fixture — no real label",
    defaultThreshold: FIXTURE_THRESHOLD,
    cost: { roundTripPoints: 2, pointValueUsd: 1, tickSize: 0.25, source: "fixture" },
    barCount: FIXTURE_CLOSE.length,
    firstTimestampSeconds: FIXTURE_START_TS,
    lastTimestampSeconds: FIXTURE_START_TS + (FIXTURE_CLOSE.length - 1) * FIXTURE_BAR_SECONDS,
    interval: {
      method: "fixture",
      binCount: 0,
      recalibrationStepBars: 0,
      historyBars: 0,
      minimumBinObservations: 0,
      quantiles: [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95],
      coveredBarCount: 0,
    },
    attribution: { available: false, reason: "fixture carries no SHAP artifact" },
    reference: {
      tradeCount: null,
      cumulativeNetUsd: null,
      longCount: null,
      shortCount: null,
      hitRateAtHalf: null,
      areaUnderCurve: null,
    },
    verification: [],
    notes: ["synthetic fixture for apps/api/tests/lens.test.ts"],
  };
}

async function writeFixtureBarsParquet(): Promise<void> {
  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  try {
    const columns = [
      "row_index",
      "timestamp_seconds",
      "open",
      "high",
      "low",
      "close",
      "volume",
      "probability_up",
      "label",
      "realized_return_basis_points",
      ...LENS_QUANTILE_COLUMNS,
    ];
    const nullQuantiles = LENS_QUANTILE_COLUMNS.map(() => "CAST(NULL AS DOUBLE)").join(", ");
    const rows = FIXTURE_CLOSE.map((closePrice, rowIndex) => {
      const ts = FIXTURE_START_TS + rowIndex * FIXTURE_BAR_SECONDS;
      const prob = FIXTURE_PROBABILITY_UP[rowIndex];
      return (
        `(${rowIndex}, ${ts}, ${closePrice}, ${closePrice}, ${closePrice}, ${closePrice}, ` +
        `CAST(NULL AS DOUBLE), ${prob}, CAST(NULL AS TINYINT), CAST(NULL AS DOUBLE), ${nullQuantiles})`
      );
    }).join(",\n");
    const literal = FIXTURE_BARS_PATH.replace(/\\/g, "/").replace(/'/g, "''");
    await con.run(
      `COPY (SELECT * FROM (VALUES\n${rows}\n) AS t(${columns.join(", ")})) TO '${literal}' (FORMAT PARQUET)`,
    );
  } finally {
    con.closeSync();
  }
}

beforeAll(async () => {
  await rm(path.join(ROOT, FIXTURE_MODEL_ID), { recursive: true, force: true });
  await mkdir(FIXTURE_LENS_DIR, { recursive: true });
  await writeFile(FIXTURE_MANIFEST_PATH, JSON.stringify(buildFixtureManifest(), null, 2), "utf8");
  await writeFixtureBarsParquet();
});

afterAll(async () => {
  await rm(path.join(ROOT, FIXTURE_MODEL_ID), { recursive: true, force: true });
});

beforeEach(() => {
  spawnCalls.length = 0;
  spawnHandler = () => ({ stdout: JSON.stringify({ models: [] }) + "\n", exitCode: 0 });
  clearLensRouteCaches();
  clearLensStoreCache();
  clearLensBuildsInFlight();
});

// ── modelId validation ───────────────────────────────────────────────────────

describe("isValidModelId", () => {
  it("accepts contract-conformant ids", () => {
    expect(isValidModelId("xgb_baseline_post")).toBe(true);
    expect(isValidModelId("MNQ_1m_cnn-transformer_20260328T064526")).toBe(true);
  });

  it("rejects traversal and bad characters", () => {
    expect(isValidModelId("..")).toBe(false);
    expect(isValidModelId(".")).toBe(false);
    expect(isValidModelId("../xgb_baseline_post")).toBe(false);
    expect(isValidModelId("foo/bar")).toBe(false);
    expect(isValidModelId("foo\\bar")).toBe(false);
    expect(isValidModelId("has space")).toBe(false);
    expect(isValidModelId("")).toBe(false);
    expect(isValidModelId("x".repeat(129))).toBe(false);
    expect(isValidModelId(undefined)).toBe(false);
  });
});

// ── GET /lens/models/:id/manifest ────────────────────────────────────────────

describe("handleManifestRequest", () => {
  it("400 on traversal modelId (no fs probe)", async () => {
    const result = await handleManifestRequest("..");
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/modelId/i);
  });

  it("404 when lens/manifest.json does not exist", async () => {
    const result = await handleManifestRequest(MISSING_MODEL_ID);
    expect(result.status).toBe(404);
    expect((result.body as { error: string }).error).toContain(MISSING_MODEL_ID);
  });

  it("200 with the manifest for a built model", async () => {
    const result = await handleManifestRequest(FIXTURE_MODEL_ID);
    expect(result.status).toBe(200);
    const manifest = result.body as LensManifest;
    expect(manifest.modelId).toBe(FIXTURE_MODEL_ID);
    expect(manifest.barCount).toBe(10);
    expect(manifest.defaultThreshold).toBe(FIXTURE_THRESHOLD);
  });
});

// ── GET /lens/models/:id/evaluation ──────────────────────────────────────────

describe("handleEvaluationRequest", () => {
  it("400 on traversal modelId", async () => {
    expect((await handleEvaluationRequest("../x", {})).status).toBe(400);
  });

  it("400 on malformed query params (non-numeric threshold)", async () => {
    const result = await handleEvaluationRequest(FIXTURE_MODEL_ID, { threshold: "not-a-number" });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/invalid/i);
  });

  it("400 on an intervalCoverage outside {0.5, 0.8, 0.9}", async () => {
    const result = await handleEvaluationRequest(FIXTURE_MODEL_ID, { intervalCoverage: "0.7" });
    expect(result.status).toBe(400);
  });

  it("404 for an unbuilt model", async () => {
    const result = await handleEvaluationRequest(MISSING_MODEL_ID, {});
    expect(result.status).toBe(404);
  });

  it("200 at default params: real evaluation over the fixture parquet reproduces the hand-derived trade count", async () => {
    const result = await handleEvaluationRequest(FIXTURE_MODEL_ID, {});
    expect(result.status).toBe(200);
    const evaluation = result.body as LensEvaluation;
    expect(evaluation.modelId).toBe(FIXTURE_MODEL_ID);
    expect(evaluation.params.threshold).toBe(FIXTURE_THRESHOLD); // manifest.defaultThreshold
    expect(evaluation.headline.tradeCount).toBe(4);
    expect(evaluation.headline.longCount).toBe(2);
    expect(evaluation.headline.shortCount).toBe(2);
    expect(evaluation.headline.barCount).toBe(10);
    expect(evaluation.trades).toHaveLength(4);
    expect(evaluation.trades[0]!.direction).toBe(1);
    expect(evaluation.trades[0]!.entryRowIndex).toBe(0);
    expect(evaluation.trades[0]!.exitRowIndex).toBe(2);
  });

  it("costMultiplier=0 changes total net (cost plumbing reaches the compute)", async () => {
    const withCost = (await handleEvaluationRequest(FIXTURE_MODEL_ID, {})).body as LensEvaluation;
    const noCost = (await handleEvaluationRequest(FIXTURE_MODEL_ID, { costMultiplier: "0" })).body as LensEvaluation;
    expect(noCost.headline.totalNetUsd).not.toBeCloseTo(withCost.headline.totalNetUsd, 6);
    // 4 trades * (roundTripPoints=2 * pointValueUsd=1) = 8 USD of cost removed.
    expect(noCost.headline.totalNetUsd - withCost.headline.totalNetUsd).toBeCloseTo(8, 6);
  });

  it("evaluation is cached — a second identical request does not reload the parquet (no throw, same object identity)", async () => {
    const first = await handleEvaluationRequest(FIXTURE_MODEL_ID, {});
    const second = await handleEvaluationRequest(FIXTURE_MODEL_ID, {});
    expect(second.body).toBe(first.body); // same cached LensEvaluation reference
  });
});

// ── GET /lens/models/:id/bars ─────────────────────────────────────────────────

describe("handleBarsRequest", () => {
  it("400 on traversal modelId", async () => {
    expect((await handleBarsRequest("..", { startRowIndex: "0", endRowIndex: "1" })).status).toBe(400);
  });

  it("400 when startRowIndex/endRowIndex are missing", async () => {
    const result = await handleBarsRequest(FIXTURE_MODEL_ID, {});
    expect(result.status).toBe(400);
  });

  it("400 when the row window is out of range (end >= barCount)", async () => {
    const result = await handleBarsRequest(FIXTURE_MODEL_ID, { startRowIndex: "0", endRowIndex: "10" });
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/row window out of range/i);
  });

  it("400 when startRowIndex > endRowIndex", async () => {
    const result = await handleBarsRequest(FIXTURE_MODEL_ID, { startRowIndex: "5", endRowIndex: "2" });
    expect(result.status).toBe(400);
  });

  it("404 for an unbuilt model", async () => {
    const result = await handleBarsRequest(MISSING_MODEL_ID, { startRowIndex: "0", endRowIndex: "1" });
    expect(result.status).toBe(404);
  });

  it("200 with all 10 bars for the full range, features null (no attribution)", async () => {
    const result = await handleBarsRequest(FIXTURE_MODEL_ID, { startRowIndex: "0", endRowIndex: "9" });
    expect(result.status).toBe(200);
    const window = result.body as LensBarWindow;
    expect(window.bars).toHaveLength(10);
    expect(window.totalBarsInRange).toBe(10);
    expect(window.truncated).toBe(false);
    expect(window.features).toBeNull();
    expect(window.bars[0]!.close).toBe(100);
    expect(window.bars[0]!.probabilityUp).toBeCloseTo(0.8);
    expect(window.bars[9]!.rowIndex).toBe(9);
  });

  it("200 with maxBars truncation", async () => {
    const result = await handleBarsRequest(FIXTURE_MODEL_ID, { startRowIndex: "0", endRowIndex: "9", maxBars: "3" });
    expect(result.status).toBe(200);
    const window = result.body as LensBarWindow;
    expect(window.bars).toHaveLength(3);
    expect(window.truncated).toBe(true);
    expect(window.totalBarsInRange).toBe(10);
  });
});

// ── GET /lens/models ──────────────────────────────────────────────────────────

describe("handleModelsRequest", () => {
  it("spawns --inspect-all and returns the model list", async () => {
    const notBuilt: LensModelEntry = {
      modelId: "ghmm_smoke",
      status: "refused",
      reason: "regime model, not a direction classifier",
      sourceSchema: null,
      symbol: null,
      timeframe: null,
      barCount: null,
      firstTimestampSeconds: null,
      lastTimestampSeconds: null,
      duplicateOf: null,
      notes: [],
      headline: null,
    };
    spawnHandler = () => ({ stdout: JSON.stringify({ models: [notBuilt] }) + "\n", exitCode: 0 });

    const result = await handleModelsRequest();
    expect(result.status).toBe(200);
    const body = result.body as LensModelList;
    expect(body.models).toHaveLength(1);
    expect(body.models[0]!.status).toBe("refused");
    expect(body.models[0]!.headline).toBeNull();

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.args).toContain("--inspect-all");
    // PYTHONPATH is extended so `-m ml.lens.main` resolves.
    expect(spawnCalls[0]!.env?.PYTHONPATH).toContain(path.join(process.cwd(), "src"));
  });

  it("attaches a REAL headline for a ready model by loading its manifest + parquet", async () => {
    const ready: LensModelEntry = {
      modelId: FIXTURE_MODEL_ID,
      status: "ready",
      sourceSchema: "probability_parquet",
      symbol: "FIXTURE",
      timeframe: "1m",
      barCount: 10,
      firstTimestampSeconds: FIXTURE_START_TS,
      lastTimestampSeconds: FIXTURE_START_TS + 9 * FIXTURE_BAR_SECONDS,
      duplicateOf: null,
      notes: [],
      headline: null,
    };
    spawnHandler = () => ({ stdout: JSON.stringify({ models: [ready] }) + "\n", exitCode: 0 });

    const result = await handleModelsRequest();
    const body = result.body as LensModelList;
    expect(body.models[0]!.headline).not.toBeNull();
    expect(body.models[0]!.headline!.tradeCount).toBe(4);
  });

  it("caches the list for 30s (second call within the window does not respawn)", async () => {
    await handleModelsRequest();
    expect(spawnCalls).toHaveLength(1);
    await handleModelsRequest();
    expect(spawnCalls).toHaveLength(1); // still 1 — served from cache
  });

  it("500 when --inspect-all exits non-zero", async () => {
    spawnHandler = () => ({ stdout: "", stderr: "Traceback: boom", exitCode: 1 });
    const result = await handleModelsRequest();
    expect(result.status).toBe(500);
  });
});

// ── POST /lens/models/:id/build ───────────────────────────────────────────────

describe("handleBuildRequest", () => {
  it("400 on traversal modelId (no spawn)", async () => {
    const result = await handleBuildRequest("..");
    expect(result.status).toBe(400);
    expect(spawnCalls).toHaveLength(0);
  });

  it("200 {manifest} on success", async () => {
    const manifest = buildFixtureManifest();
    spawnHandler = () => ({ stdout: JSON.stringify(manifest) + "\n", exitCode: 0 });
    const result = await handleBuildRequest("some_model");
    expect(result.status).toBe(200);
    expect((result.body as { manifest: LensManifest }).manifest.modelId).toBe(FIXTURE_MODEL_ID);
    expect(spawnCalls[0]!.args).toEqual(["-m", "ml.lens.main", "--model-id", "some_model", "--json"]);
  });

  it("409 with the reason on refusal", async () => {
    spawnHandler = () => ({
      stdout: JSON.stringify({ status: "refused", reason: "row_index written as 0..N-1 timestamps (template bug)" }) + "\n",
      exitCode: 1,
    });
    const result = await handleBuildRequest("rf_w2_smoke");
    expect(result.status).toBe(409);
    expect((result.body as { error: string }).error).toContain("template bug");
  });

  it("409 when a build is already running for the same modelId", async () => {
    spawnHandler = () => ({
      stdout: JSON.stringify(buildFixtureManifest()) + "\n",
      exitCode: 0,
      deferMs: 20,
    });
    const first = handleBuildRequest("slow_model");
    // second request arrives while the first is still spawning/running
    const second = await handleBuildRequest("slow_model");
    expect(second.status).toBe(409);
    expect((second.body as { error: string }).error).toContain("already running");
    const firstResult = await first;
    expect(firstResult.status).toBe(200);
  });

  it("500 with stderr surfaced on a genuine failure", async () => {
    spawnHandler = () => ({ stdout: "", stderr: "ImportError: no module named ml.lens", exitCode: 1 });
    const result = await handleBuildRequest("broken_model");
    expect(result.status).toBe(500);
    const body = result.body as { error: string; details: { stderr: string } };
    expect(body.details.stderr).toContain("ImportError");
  });
});
