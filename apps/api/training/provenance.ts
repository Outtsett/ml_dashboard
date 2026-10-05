/**
 * Run Provenance — identity minting, config/code hashing, run manifests.
 *
 * Stage 1 of the ML Studio provenance redesign: **write-only**. This module
 * mints the identifiers, writes `data/runs/<experiment_id>/<run_id>/manifest.json`
 * and inserts the `experiments` / `runs` rows. Nothing in the app reads those
 * tables yet — the app behaves identically with this module present.
 *
 * Identity hierarchy (design plan §2.1):
 *
 *   catalog_id     stable slug, no timestamp, no symbol   ("xgboost")
 *   experiment_id  "exp_" + ULID, minted by the orchestrator
 *   run_id         "run_" + ULID, minted by the orchestrator BEFORE spawn
 *   trial_idx /    integer *coordinates*, not identifiers — owned by Python
 *   fold_idx
 *
 * `legacy_model_id` (`versioning.ts::generateVersionedModelId`) is retained
 * verbatim as a NON-UNIQUE column and remains the artifact directory name, so
 * every one of the existing `data/models/*` directories stays exactly where it
 * is and stays readable. `artifact_dir` in the manifest is the indirection.
 *
 * Two deliberate structural choices:
 *
 * 1. **No top-level `db` import.** `infrastructure/database/db` opens the
 *    SQLite file and runs the invariant enforcer as an import side effect.
 *    `runners/parsers/generated.ts` imports this module purely to read the
 *    in-memory run context, and its unit tests must not open a database. The
 *    database handle is therefore loaded lazily, inside the write paths only.
 * 2. **`ulid()` is implemented here rather than added as a dependency.** It is
 *    ~30 lines (48-bit millisecond timestamp + 80 bits of CSPRNG entropy in
 *    Crockford base32) and this is the only consumer.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { Logger } from "@nestjs/common";
// Type-only: `@shared/pg_schema` is a pure Drizzle declaration module with no
// import side effects. The *values* (table objects) are still loaded lazily
// alongside the database handle below.
import type { RunStatus, ExperimentStatus } from "@shared/pg_schema";

export type { RunStatus, ExperimentStatus };

const logger = new Logger("Provenance");

// ─── ULID ────────────────────────────────────────────────────────────────────

/** Crockford base32 alphabet — excludes I, L, O, U to survive transcription. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const TIME_CHARS = 10; // 50 bits of alphabet space holding a 48-bit ms timestamp
const RANDOM_CHARS = 16; // 80 bits of entropy

function encodeTime(ms: number): string {
  let remaining = Math.floor(ms);
  let out = "";
  for (let i = 0; i < TIME_CHARS; i++) {
    out = CROCKFORD[remaining % 32]! + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function encodeRandom(): string {
  // 16 base32 chars = 80 bits. One CSPRNG byte per char, masked to 5 bits:
  // rejection-free and unbiased because 256 is not a multiple of 32 only in
  // the high bits we discard.
  const bytes = crypto.randomBytes(RANDOM_CHARS);
  let out = "";
  for (let i = 0; i < RANDOM_CHARS; i++) {
    out += CROCKFORD[bytes[i]! & 0x1f];
  }
  return out;
}

/**
 * Generate a ULID (Universally Unique Lexicographically Sortable Identifier).
 *
 * 26 Crockford-base32 characters: 10 of millisecond timestamp followed by 16
 * of entropy. Lexicographic sort equals chronological sort, which is why this
 * replaces the second-resolution `SYMBOL_TF_TYPE_YYYYMMDDTHHMMSS` key that
 * collides when two runs start in the same second.
 */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

/** Mint an experiment identifier: `exp_` + ULID. */
export function mintExperimentId(now?: number): string {
  return `exp_${ulid(now)}`;
}

/** Mint a run identifier: `run_` + ULID. */
export function mintRunId(now?: number): string {
  return `run_${ulid(now)}`;
}

// ─── Canonical JSON + hashing ────────────────────────────────────────────────

/**
 * Deterministic JSON serialization: object keys sorted at every depth, array
 * order preserved (array order is data, object key order is not).
 *
 * Two structurally identical configs must produce byte-identical output or
 * `config_hash` is meaningless.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    // JSON.stringify turns undefined/NaN/Infinity into undefined/null; normalize
    // non-finite numbers to null so the hash never depends on a JS-only token.
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    out[key] = canonicalize(source[key]);
  }
  return out;
}

/** Full 64-character sha256 hex digest of a UTF-8 string. */
export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * 16-character hash — the width the envelope declares for `config_hash` /
 * `manifest_hash`. 64 bits: collision-resistant far past the run counts this
 * project will ever produce, and short enough to read in a log line.
 */
export function shortHash(input: string | Buffer): string {
  return sha256Hex(input).slice(0, 16);
}

/**
 * Keys excluded from `config_hash` because they change on every run by
 * construction. Without a *named* exclusion list every run hashes uniquely and
 * the "3 runs share this config" affordance is dead on arrival.
 *
 * Matching is case-insensitive on the key name, applied at every depth, and
 * additionally drops any key ending in `_path` / `Path`.
 */
export const VOLATILE_CONFIG_KEYS: readonly string[] = [
  "run_id",
  "runid",
  "experiment_id",
  "experimentid",
  "model_id",
  "modelid",
  "out_dir",
  "outdir",
  "output_dir",
  "outputdir",
  "trained_at",
  "trainedat",
  "started_at",
  "startedat",
  "timestamp",
];

function isVolatileKey(key: string, extra: ReadonlySet<string>): boolean {
  const lower = key.toLowerCase();
  if (extra.has(lower)) return true;
  if (VOLATILE_CONFIG_KEYS.includes(lower)) return true;
  return lower.endsWith("_path") || lower.endsWith("path");
}

/** Recursively drop volatile keys so structurally-equal configs hash equal. */
export function stripVolatileKeys(
  value: unknown,
  extraVolatileKeys: readonly string[] = [],
): unknown {
  const extra = new Set(extraVolatileKeys.map((k) => k.toLowerCase()));
  const walk = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(walk);
    const source = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (isVolatileKey(key, extra)) continue;
      out[key] = walk(source[key]);
    }
    return out;
  };
  return walk(value);
}

/**
 * `config_hash` — 16-char sha256 over canonical JSON of the resolved config
 * with volatile keys removed.
 *
 * Pass `seed` in `extraVolatileKeys` when running a seed sweep, so the sweep's
 * members are recognised as one configuration measured N times.
 */
export function computeConfigHash(
  config: unknown,
  extraVolatileKeys: readonly string[] = [],
): string {
  return shortHash(canonicalJson(stripVolatileKeys(config, extraVolatileKeys)));
}

// ─── Code identity ───────────────────────────────────────────────────────────

export interface GitIdentity {
  /** Commit sha, or null with `error` explaining why it could not be read. */
  commit_sha: string | null;
  /** True when the working tree has tracked modifications — the normal state here. */
  dirty: boolean | null;
  error?: string;
}

/**
 * Repository lineage. The commit sha alone does NOT identify the code that
 * ran — this repository habitually carries hundreds of uncommitted changes —
 * which is why `code_tree_hash` below is the primary identifier and this is
 * lineage metadata.
 */
export function readGitIdentity(cwd: string = process.cwd()): GitIdentity {
  const run = (args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    const commit = run(["rev-parse", "HEAD"]);
    // `--untracked-files=no`: untracked files (build output, data) are not the
    // code that ran, and enumerating them on this tree is slow.
    const status = run(["status", "--porcelain", "--untracked-files=no"]);
    return { commit_sha: commit, dirty: status.length > 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { commit_sha: null, dirty: null, error: `git unavailable or not a repository: ${message}` };
  }
}

const CODE_TREE_ROOTS = ["packages/ml-engine/src", "packages/config"] as const;
const CODE_TREE_EXTENSIONS = new Set([".py", ".json", ".j2", ".yaml", ".yml"]);

function listFilesRecursive(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__" || entry.name === "node_modules") continue;
      listFilesRecursive(full, out);
    } else if (entry.isFile() && CODE_TREE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * `code_tree_hash` — sha256 over sorted `(relpath, sha256(bytes))` pairs for
 * `packages/ml-engine/src/**` + `packages/config/**`.
 *
 * This is the PRIMARY code identifier, not a fallback for a missing commit
 * sha: with a persistently dirty working tree the commit sha cannot tell two
 * runs apart, and this can.
 */
export function computeCodeTreeHash(repoRoot: string = process.cwd()): string {
  const entries: Array<[string, string]> = [];
  for (const root of CODE_TREE_ROOTS) {
    const absRoot = path.join(repoRoot, root);
    for (const file of listFilesRecursive(absRoot)) {
      const rel = path.relative(repoRoot, file).split(path.sep).join("/");
      entries.push([rel, sha256Hex(fs.readFileSync(file))]);
    }
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(entries.map(([rel, hash]) => `${rel}:${hash}`).join("\n"));
}

/**
 * sha256 of a single file's bytes, or null when the file is absent.
 *
 * `runner_source_hash` uses this on `packages/ml-engine/src/<model_id>/main.py`: it is the only
 * after-the-fact detector for the codegen slot writer silently replacing the
 * source of a model that has already produced runs.
 */
export function hashFileIfPresent(filePath: string): string | null {
  try {
    return sha256Hex(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

// ─── Run directory layout ────────────────────────────────────────────────────

/** `data/runs` — experiment/run metadata. Artifacts stay in `data/models/`. */
export function runsRoot(repoRoot: string = process.cwd()): string {
  return path.join(repoRoot, "data", "runs");
}

/** `data/runs/<experiment_id>/<run_id>` */
export function runDir(experimentId: string, runId: string, repoRoot: string = process.cwd()): string {
  return path.join(runsRoot(repoRoot), experimentId, runId);
}

// ─── Manifest ────────────────────────────────────────────────────────────────

export const MANIFEST_VERSION = 1;

export interface RunManifestIdentity {
  manifest_version: number;
  catalog_id: string;
  experiment_id: string;
  run_id: string;
  trial_idx: number | null;
  fold_idx: number | null;
  legacy_model_id: string;
  runner_key: string;
  /** Relative to the repository root — artifacts do NOT move under data/runs. */
  artifact_dir: string;
}

export interface RunManifest {
  identity: RunManifestIdentity;
  created_at: string;
  config: Record<string, unknown>;
  config_hash: string;
  code: {
    git: GitIdentity;
    code_tree_hash: string;
    runner_source_hash: string | null;
    runner_source_path: string | null;
  };
  features: {
    features_config_hash: string | null;
  };
  costs: {
    cost_model_hash: string | null;
  };
  /** Declared outputs from `runners.json.outputs`; actuals are appended by Python. */
  expected_artifacts: string[];
  /** Set once the manifest bytes are hashed; excluded from its own hash. */
  manifest_hash?: string;
}

export interface BuildManifestInput {
  experimentId: string;
  runId: string;
  catalogId: string;
  runnerKey: string;
  legacyModelId: string;
  artifactDir: string;
  scriptPath?: string | null;
  expectedArtifacts?: string[];
  config: Record<string, unknown>;
  trialIdx?: number | null;
  foldIdx?: number | null;
  extraVolatileKeys?: readonly string[];
  repoRoot?: string;
}

/**
 * Build the manifest skeleton — everything the server can compute honestly
 * before the process starts. Python appends what only it knows (resolved
 * feature names, data content hash, library versions, actual artifacts).
 *
 * The skeleton is written BEFORE spawn on purpose: a runner that dies during
 * import must still leave a provenanced run behind.
 */
export function buildRunManifest(input: BuildManifestInput): RunManifest {
  const repoRoot = input.repoRoot ?? process.cwd();
  const configHash = computeConfigHash(input.config, input.extraVolatileKeys ?? []);
  const scriptAbs = input.scriptPath
    ? path.isAbsolute(input.scriptPath)
      ? input.scriptPath
      : path.join(repoRoot, input.scriptPath)
    : null;

  return {
    identity: {
      manifest_version: MANIFEST_VERSION,
      catalog_id: input.catalogId,
      experiment_id: input.experimentId,
      run_id: input.runId,
      trial_idx: input.trialIdx ?? null,
      fold_idx: input.foldIdx ?? null,
      legacy_model_id: input.legacyModelId,
      runner_key: input.runnerKey,
      artifact_dir: input.artifactDir,
    },
    created_at: new Date().toISOString(),
    config: input.config,
    config_hash: configHash,
    code: {
      git: readGitIdentity(repoRoot),
      code_tree_hash: computeCodeTreeHash(repoRoot),
      runner_source_hash: scriptAbs ? hashFileIfPresent(scriptAbs) : null,
      runner_source_path: scriptAbs
        ? path.relative(repoRoot, scriptAbs).split(path.sep).join("/")
        : null,
    },
    features: {
      // Content hash, NOT the mtime `feature_cache.py` uses: mtime is both
      // over-sensitive (a touch forces a full recompute) and under-sensitive
      // (an mtime-preserving checkout silently reuses stale features).
      features_config_hash: hashFileIfPresent(path.join(repoRoot, "packages", "config", "features.json")),
    },
    costs: {
      cost_model_hash: hashFileIfPresent(path.join(repoRoot, "packages", "config", "cost_model.json")),
    },
    expected_artifacts: input.expectedArtifacts ?? [],
  };
}

/** `manifest_hash` — 16-char sha256 over the manifest's canonical JSON,
 *  computed with the `manifest_hash` key itself excluded. */
export function computeManifestHash(manifest: RunManifest): string {
  const { manifest_hash: _ignored, ...rest } = manifest;
  void _ignored;
  return shortHash(canonicalJson(rest));
}

/**
 * Write `data/runs/<experiment_id>/<run_id>/manifest.json`.
 *
 * Append-only: refuses to overwrite an existing manifest. A run identifier is
 * minted once and never reused, so a collision means a real bug — silently
 * clobbering it would destroy a prior run's provenance.
 */
export function writeRunManifest(
  manifest: RunManifest,
  repoRoot: string = process.cwd(),
): { manifestHash: string; manifestPath: string } {
  const manifestHash = computeManifestHash(manifest);
  const dir = runDir(manifest.identity.experiment_id, manifest.identity.run_id, repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    throw new Error(`Refusing to overwrite an existing run manifest: ${manifestPath}`);
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, manifest_hash: manifestHash }, null, 2)}\n`, "utf-8");
  return { manifestHash, manifestPath };
}

// ─── In-memory run context ───────────────────────────────────────────────────

/**
 * What the spawn record knows about a run. Keyed by `legacyModelId` because
 * that is the only identifier threaded through `ResolvedTrainingConfig`,
 * `ParserContext` and the Python CLI (`--model-id`) today.
 */
export interface RunContext {
  experimentId: string;
  runId: string;
  catalogId: string;
  runnerKey: string;
  legacyModelId: string;
  configHash: string;
  manifestHash: string;
  manifestPath: string;
  artifactDir: string;
  trialIdx: number | null;
  foldIdx: number | null;
}

const runContexts = new Map<string, RunContext>();

export function registerRunContext(legacyModelId: string, ctx: RunContext): void {
  runContexts.set(legacyModelId, ctx);
}

/** Look up the spawn record for a legacy model id. */
export function getRunContext(legacyModelId: string | undefined | null): RunContext | undefined {
  if (!legacyModelId) return undefined;
  return runContexts.get(legacyModelId);
}

export function clearRunContext(legacyModelId: string): void {
  runContexts.delete(legacyModelId);
}

/** Test-only reset so suites don't leak contexts into each other. */
export function resetRunContexts(): void {
  runContexts.clear();
}

/** True once `finishRun` has written a terminal state for this run. */
export function isRunFinalized(runId: string): boolean {
  return finalizedRuns.has(runId);
}

/**
 * Environment variables handed to the child process. `protocol.py` reads these
 * at import and stamps them on every event, which is what makes a headless
 * stdout line self-identifying.
 */
export function runContextEnv(ctx: RunContext): Record<string, string> {
  return {
    ML_RUN_ID: ctx.runId,
    ML_EXPERIMENT_ID: ctx.experimentId,
    ML_CATALOG_ID: ctx.catalogId,
    ML_CONFIG_HASH: ctx.configHash,
    ML_MANIFEST_HASH: ctx.manifestHash,
  };
}

// ─── Persistence (lazy database handle) ──────────────────────────────────────

type DbModule = typeof import("../infrastructure/database/db");
type SchemaModule = typeof import("@shared/pg_schema");

let dbModulePromise: Promise<{ db: DbModule["db"]; schema: SchemaModule }> | null = null;

async function getPersistence(): Promise<{ db: DbModule["db"]; schema: SchemaModule }> {
  dbModulePromise ??= (async () => {
    const [dbModule, schema] = await Promise.all([
      import("../infrastructure/database/db"),
      import("@shared/pg_schema"),
    ]);
    return { db: dbModule.db, schema };
  })();
  return dbModulePromise;
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface BeginExperimentInput {
  catalogId: string;
  runnerKey: string;
  name?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  experimentId?: string;
}

/**
 * Mint an experiment and insert its row. One experiment spans every run of a
 * single user-initiated training action — a walk-forward sweep's N windows and
 * an HPO study's trials all share one `experiment_id`.
 */
export async function beginExperiment(input: BeginExperimentInput): Promise<string> {
  const experimentId = input.experimentId ?? mintExperimentId();
  const { db, schema } = await getPersistence();
  const ts = nowIso();
  db.insert(schema.experiments).values({
    experimentId,
    catalogId: input.catalogId,
    runnerKey: input.runnerKey,
    name: input.name ?? null,
    symbol: input.symbol ?? null,
    timeframe: input.timeframe ?? null,
    status: "running",
    runCount: 0,
    createdAt: ts,
    updatedAt: ts,
  }).execute();
  return experimentId;
}

export interface BeginRunInput {
  experimentId: string;
  catalogId: string;
  runnerKey: string;
  /** `versioning.ts::generateVersionedModelId` output — non-unique, retained. */
  legacyModelId: string;
  /** Relative artifact directory, e.g. `data/models/<legacy_model_id>`. */
  artifactDir: string;
  config: Record<string, unknown>;
  scriptPath?: string | null;
  expectedArtifacts?: string[];
  trialIdx?: number | null;
  foldIdx?: number | null;
  trainingSessionId?: number | null;
  extraVolatileKeys?: readonly string[];
  repoRoot?: string;
}

/**
 * Mint a run, write its manifest skeleton, insert the `runs` row with
 * `status='starting'`, and register the in-memory context.
 *
 * MUST be awaited before `spawn`: a row that only appears once the first
 * stdout line arrives cannot represent a process that died during import,
 * which is precisely the case this exists for.
 */
export async function beginRun(input: BeginRunInput): Promise<RunContext> {
  const repoRoot = input.repoRoot ?? process.cwd();
  const runId = mintRunId();

  const manifest = buildRunManifest({
    experimentId: input.experimentId,
    runId,
    catalogId: input.catalogId,
    runnerKey: input.runnerKey,
    legacyModelId: input.legacyModelId,
    artifactDir: input.artifactDir,
    scriptPath: input.scriptPath ?? null,
    expectedArtifacts: input.expectedArtifacts,
    config: input.config,
    trialIdx: input.trialIdx ?? null,
    foldIdx: input.foldIdx ?? null,
    extraVolatileKeys: input.extraVolatileKeys,
    repoRoot,
  });

  const { manifestHash, manifestPath } = writeRunManifest(manifest, repoRoot);

  const ctx: RunContext = {
    experimentId: input.experimentId,
    runId,
    catalogId: input.catalogId,
    runnerKey: input.runnerKey,
    legacyModelId: input.legacyModelId,
    configHash: manifest.config_hash,
    manifestHash,
    manifestPath: path.relative(repoRoot, manifestPath).split(path.sep).join("/"),
    artifactDir: input.artifactDir,
    trialIdx: input.trialIdx ?? null,
    foldIdx: input.foldIdx ?? null,
  };

  const { db, schema } = await getPersistence();
  const ts = nowIso();

  db.insert(schema.runManifests).values({
    manifestHash,
    manifestVersion: MANIFEST_VERSION,
    runId,
    experimentId: input.experimentId,
    manifestPath: ctx.manifestPath,
    manifest: { ...manifest, manifest_hash: manifestHash },
    createdAt: ts,
  }).onConflictDoNothing().execute();

  db.insert(schema.runs).values({
    runId,
    experimentId: input.experimentId,
    catalogId: input.catalogId,
    runnerKey: input.runnerKey,
    legacyModelId: input.legacyModelId,
    trialIdx: input.trialIdx ?? null,
    foldIdx: input.foldIdx ?? null,
    status: "starting",
    configHash: manifest.config_hash,
    manifestHash,
    manifestPath: ctx.manifestPath,
    artifactDir: input.artifactDir,
    trainingSessionId: input.trainingSessionId ?? null,
    startedAt: ts,
    heartbeatAt: ts,
  }).execute();

  registerRunContext(input.legacyModelId, ctx);
  return ctx;
}

/** Record the child process identifier and flip `starting` → `running`. */
export async function markRunSpawned(runId: string, pid: number | null): Promise<void> {
  const { db, schema } = await getPersistence();
  const { eq } = await import("drizzle-orm");
  const ts = nowIso();
  db.update(schema.runs)
    .set({ status: "running", pid: pid ?? null, heartbeatAt: ts })
    .where(eq(schema.runs.runId, runId))
    .execute();
}

/** Minimum wall-clock gap between heartbeat writes, per run. */
const HEARTBEAT_THROTTLE_MS = 5000;
const lastHeartbeat = new Map<string, number>();

/**
 * Refresh `heartbeat_at` so a boot sweeper can tell a live run from an
 * abandoned one. Throttled: the design calls for a heartbeat per envelope, and
 * a per-metric write on the hot stdout path would put a SQLite UPDATE between
 * every training iteration.
 */
export async function touchRunHeartbeat(runId: string, now: number = Date.now()): Promise<void> {
  const previous = lastHeartbeat.get(runId) ?? 0;
  if (now - previous < HEARTBEAT_THROTTLE_MS) return;
  lastHeartbeat.set(runId, now);
  const { db, schema } = await getPersistence();
  const { eq } = await import("drizzle-orm");
  db.update(schema.runs)
    .set({ heartbeatAt: new Date(now).toISOString() })
    .where(eq(schema.runs.runId, runId))
    .execute();
}

export interface FinishRunInput {
  status: RunStatus;
  exitCode?: number | null;
  errorMessage?: string | null;
}

const finalizedRuns = new Set<string>();

/**
 * Terminal state is owned by the parent process, and written exactly once.
 *
 * The first terminal call for a run wins. `stop()` and the child's `close`
 * handler both fire on a user-initiated kill; without this guard the later
 * `close` would relabel a deliberately stopped run as `crashed`.
 */
export async function finishRun(runId: string, input: FinishRunInput): Promise<void> {
  if (finalizedRuns.has(runId)) return;
  finalizedRuns.add(runId);
  const { db, schema } = await getPersistence();
  const { eq } = await import("drizzle-orm");
  const ts = nowIso();
  db.update(schema.runs)
    .set({
      status: input.status,
      exitCode: input.exitCode ?? null,
      errorMessage: input.errorMessage ?? null,
      finishedAt: ts,
      heartbeatAt: ts,
    })
    .where(eq(schema.runs.runId, runId))
    .execute();
  lastHeartbeat.delete(runId);
}

/** Flip an experiment to a terminal status. */
export async function finishExperiment(
  experimentId: string,
  status: ExperimentStatus,
): Promise<void> {
  const { db, schema } = await getPersistence();
  const { eq } = await import("drizzle-orm");
  const ts = nowIso();
  db.update(schema.experiments)
    .set({ status, finalizedAt: ts, updatedAt: ts })
    .where(eq(schema.experiments.experimentId, experimentId))
    .execute();
}

/** Increment an experiment's run counter (roll-up for the experiment manifest). */
export async function incrementExperimentRunCount(experimentId: string): Promise<void> {
  const { db, schema } = await getPersistence();
  const { eq, sql } = await import("drizzle-orm");
  db.update(schema.experiments)
    .set({ runCount: sql`${schema.experiments.runCount} + 1`, updatedAt: nowIso() })
    .where(eq(schema.experiments.experimentId, experimentId))
    .execute();
}

/**
 * Fire-and-forget wrapper for the synchronous call sites (child-process event
 * handlers). Provenance is observability: a failure here must never take down
 * a training run, but it must never be silent either.
 */
export function detach(promise: Promise<unknown>, what: string): void {
  promise.catch((err: unknown) => {
    logger.error(`Provenance ${what} failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}


