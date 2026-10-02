/**
 * Model Lens — Python builder spawn.
 *
 * Two entry points into `python -m ml.lens.main`:
 *   --inspect-all --json      -> { models: LensModelEntry[] } (read-only survey)
 *   --model-id <id> --json    -> builds/refreshes that model's lens artifacts,
 *                                 prints the resulting LensManifest as the last
 *                                 stdout line.
 *
 * Spawn plumbing mirrors apps/api/ml/anatomy.router.ts (hard timeout +
 * SIGKILL, last-JSON-line stdout contract), with two differences: the
 * interpreter is the project's own uv venv from packages/config/training.json
 * paths.pythonExe (PYTHON_BIN env overrides it, matching anatomy's
 * PYTHON_BIN/ML_PYTHON convention), and PYTHONPATH is extended with `src` and
 * `packages/ml-engine/src` so `-m ml.lens.main` resolves — the module is `ml.lens.main`, not
 * `src.ml.lens.main` (the convention packages/ml-engine/packages/shared/src/hpo_runner.py uses).
 *
 * Refusal contract (documented here because packages/ml-engine/src/lens/main.py owns the
 * other side of it): the builder signals a refusal — unsupported source
 * schema, the row_index=0..N-1 template bug, a regime model that is not a
 * direction classifier — by printing a last JSON line shaped
 * `{ status: "refused", reason: string }`, independent of exit code, so a
 * refusal can still carry stderr diagnostics. Any other non-zero exit is a
 * failure, not a refusal.
 */

import { spawn } from "child_process";
import path from "path";
import { Logger } from "@nestjs/common";
import trainingConfig from "../../../packages/config/training.json";
import type { LensManifest, LensModelList } from "@shared/lens";

const logger = new Logger("LensBuild");

export class LensBuildError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "LensBuildError";
  }
}

/** The builder refused this model — a 409, not a failure. */
export class LensBuildRefusedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "LensBuildRefusedError";
  }
}

function resolvePythonExecutable(): string {
  const override = process.env.PYTHON_BIN || process.env.ML_PYTHON;
  if (override) return override;
  const configured = trainingConfig.paths.pythonExe;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function buildEnv(): NodeJS.ProcessEnv {
  const repoRoot = process.cwd();
  const extra = [path.join(repoRoot, "src"), path.join(repoRoot, "src", "ml")];
  const existing = process.env.PYTHONPATH;
  const pythonPath = existing ? [...extra, existing].join(path.delimiter) : extra.join(path.delimiter);
  return { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", PYTHONPATH: pythonPath };
}

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killedByTimeout: boolean;
}

function spawnLens(args: string[], timeoutMs: number): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const py = resolvePythonExecutable();
    const repoRoot = process.cwd();

    logger.log(`Spawning ml.lens.main: ${py} -m ml.lens.main ${args.join(" ")}`);

    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;

    let child;
    try {
      child = spawn(py, ["-m", "ml.lens.main", ...args], {
        cwd: repoRoot,
        env: buildEnv(),
        windowsHide: true,
      });
    } catch (err) {
      return reject(new LensBuildError(`Failed to spawn Python: ${(err as Error).message}`, "", null));
    }

    const timer = setTimeout(() => {
      killedByTimeout = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }, timeoutMs);

    // Neither CLI mode reads stdin — close it immediately so the child never
    // blocks waiting for EOF.
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(new LensBuildError(`Failed to spawn Python: ${err.message}`, stderr, null));
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, killedByTimeout });
    });
  });
}

/** Reverse-scan stdout for the last JSON object line — the uv venv can emit
 *  noise lines (warnings, numba JIT chatter) before the single result line. */
function extractJsonLine(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] as string;
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not JSON — keep scanning
    }
  }
  return null;
}

const INSPECT_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;

/** GET /api/lens/models source: a read-only survey of every model directory. */
export async function runInspectAll(): Promise<LensModelList> {
  const outcome = await spawnLens(["--inspect-all", "--json"], INSPECT_TIMEOUT_MS);

  if (outcome.killedByTimeout) {
    throw new LensBuildError(
      `ml.lens.main --inspect-all timed out (>${INSPECT_TIMEOUT_MS / 1000}s)`,
      outcome.stderr.slice(-2000),
      null,
    );
  }

  const parsed = extractJsonLine(outcome.stdout);

  if (outcome.exitCode !== 0) {
    const scriptError = parsed && typeof parsed.error === "string" ? `: ${parsed.error}` : "";
    throw new LensBuildError(
      `ml.lens.main --inspect-all exited with code ${outcome.exitCode}${scriptError}`,
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  if (!parsed || !Array.isArray(parsed.models)) {
    throw new LensBuildError(
      "ml.lens.main --inspect-all exited 0 but produced no { models: [...] } result line",
      outcome.stderr.slice(-2000),
      outcome.exitCode,
    );
  }

  return parsed as unknown as LensModelList;
}

/** POST /api/lens/models/:id/build source. See module docblock for the
 *  refusal contract. */
export async function runBuild(modelId: string): Promise<LensManifest> {
  const outcome = await spawnLens(["--model-id", modelId, "--json"], BUILD_TIMEOUT_MS);

  if (outcome.killedByTimeout) {
    throw new LensBuildError(
      `ml.lens.main build timed out (>${BUILD_TIMEOUT_MS / 60_000}min) for '${modelId}'`,
      outcome.stderr.slice(-4000),
      null,
    );
  }

  const parsed = extractJsonLine(outcome.stdout);

  if (parsed && parsed.status === "refused" && typeof parsed.reason === "string") {
    throw new LensBuildRefusedError(parsed.reason);
  }

  if (outcome.exitCode !== 0) {
    const scriptError = parsed && typeof parsed.error === "string" ? `: ${parsed.error}` : "";
    throw new LensBuildError(
      `ml.lens.main build exited with code ${outcome.exitCode}${scriptError} for '${modelId}'`,
      outcome.stderr.slice(-4000),
      outcome.exitCode,
    );
  }

  if (!parsed) {
    throw new LensBuildError(
      `ml.lens.main build exited 0 but produced no parseable JSON result line for '${modelId}'`,
      outcome.stderr.slice(-4000),
      outcome.exitCode,
    );
  }

  const manifest = (typeof parsed.manifest === "object" && parsed.manifest !== null ? parsed.manifest : parsed) as LensManifest;
  return manifest;
}
