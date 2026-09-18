/**
 * Catalog lifecycle join — one catalog spec, five places its history lives.
 *
 * Think of it as: the clerk who walks a model's paperwork through the building.
 * The spec is in the library (the markdown corpus), the runner is in the
 * workshop (`runners.json`), the training runs are in the ledger (SQLite),
 * the artifact is in the warehouse (`data/models/`), and the deployment is on
 * the floor (`deployments`). No one of those knows about the others' ids, so
 * the join is spelled out here, once.
 *
 * The id spaces, and how each hop is made:
 *
 *   spec id  -> runner keys   a composed registry entry whose `catalogId` is the
 *                             spec id (wired runners, via `algorithms.json`
 *                             `catalogSpec`), or a generated runner that recorded
 *                             the spec id when it was registered.
 *   runner   -> sessions      `training_sessions.model_type` equals the runner
 *                             key, or the runner's `legacyId` (pre-2026-05-09
 *                             rows wrote `xgb_classifier`, not the composite key).
 *   session  -> artifact      `versioned_model_id` IS the `data/models/` directory
 *                             name, which is also the Model Lens model id.
 *   spec     -> versions      `model_versions.catalog_id` / `.runner_key` —
 *                             explicit columns, no parsing.
 *
 * SRP: `buildCatalogLifecycle` is pure (tested against fixtures);
 * `getCatalogLifecycle` only gathers its inputs.
 */

import fs from 'fs';
import path from 'path';
import type {
  CatalogLifecycle,
  CatalogLifecycleResponse,
  LifecycleStage,
} from '@shared/catalogLifecycle';
import { modelVersions, deployments } from '@shared/schema';
import { db } from '../infrastructure/database/db';
import { listSessions } from '../infrastructure/storage/trainingStorage';
import { getCatalogModels } from '../infrastructure/lib/modelImport';
import { getTrainableModels } from '../infrastructure/lib/catalogBridge';
import { listModels, listRunners, getTrainingConfig } from '../training/registry';

// ─── Inputs (narrow on purpose — ISP) ───────────────────────────────────────

export interface LifecycleSpec {
  id: string;
  hasContent: boolean;
}

export interface LifecycleTrainable {
  runnerSource: 'wired' | 'generate' | 'browse-only';
  /** Catalog spec this entry trains, when it names one. */
  catalogId?: string;
}

export interface LifecycleRunner {
  catalogId?: string;
  legacyId?: string;
}

export interface LifecycleSession {
  modelType: string | null;
  status: string;
  startedAtMilliseconds: number | null;
  versionedModelId: string | null;
}

export interface LifecycleVersion {
  versionId: number;
  catalogId: string;
  runnerKey: string;
}

export interface LifecycleDeployment {
  versionId: number;
  status: string;
}

export interface LifecycleInputs {
  specs: LifecycleSpec[];
  /** Keyed by ML Studio model key. */
  trainable: Record<string, LifecycleTrainable>;
  /** Keyed by runner key (`${algorithm}+${task}`, sometimes `+${modelId}`). */
  runners: Record<string, LifecycleRunner>;
  sessions: LifecycleSession[];
  versions: LifecycleVersion[];
  deployments: LifecycleDeployment[];
  /** True when `data/models/<id>` holds a built Model Lens record. */
  isLensReady: (versionedModelId: string) => boolean;
}

// ─── The join ───────────────────────────────────────────────────────────────

export function buildCatalogLifecycle(inputs: LifecycleInputs): CatalogLifecycleResponse {
  const { specs, trainable, runners, sessions, versions, isLensReady } = inputs;

  // spec id -> runner keys
  const runnerKeysBySpec = new Map<string, string[]>();
  for (const [key, runner] of Object.entries(runners)) {
    if (!runner.catalogId) continue;
    const keys = runnerKeysBySpec.get(runner.catalogId) ?? [];
    keys.push(key);
    runnerKeysBySpec.set(runner.catalogId, keys);
  }

  // session model type -> runner key (the key itself, or the runner's old alias)
  const runnerKeyByModelType = new Map<string, string>();
  for (const [key, runner] of Object.entries(runners)) {
    runnerKeyByModelType.set(key, key);
    if (runner.legacyId) runnerKeyByModelType.set(runner.legacyId, key);
  }

  const sessionsByRunner = new Map<string, LifecycleSession[]>();
  let unattachedSessionCount = 0;
  for (const session of sessions) {
    const runnerKey = session.modelType ? runnerKeyByModelType.get(session.modelType) : undefined;
    if (!runnerKey) {
      unattachedSessionCount++;
      continue;
    }
    const rows = sessionsByRunner.get(runnerKey) ?? [];
    rows.push(session);
    sessionsByRunner.set(runnerKey, rows);
  }

  const runningByVersion = new Map<number, number>();
  for (const deployment of inputs.deployments) {
    if (deployment.status !== 'running') continue;
    runningByVersion.set(deployment.versionId, (runningByVersion.get(deployment.versionId) ?? 0) + 1);
  }

  // A wired entry is keyed by its runner key and names its spec in `catalogId`;
  // a catalog-derived entry is keyed by the spec id itself. Wired wins the
  // deep-link target: it is the tested runner, the other is a template.
  const wiredKeyBySpec = new Map<string, string>();
  for (const [key, entry] of Object.entries(trainable)) {
    if (entry.runnerSource === 'wired' && entry.catalogId && !wiredKeyBySpec.has(entry.catalogId)) {
      wiredKeyBySpec.set(entry.catalogId, key);
    }
  }

  const lifecycle: Record<string, CatalogLifecycle> = {};

  for (const spec of specs) {
    const runnerKeys = runnerKeysBySpec.get(spec.id) ?? [];
    const own = trainable[spec.id];
    const wiredKey = wiredKeyBySpec.get(spec.id) ?? null;

    let runnerSource: CatalogLifecycle['runnerSource'] = null;
    let trainableKey: string | null = null;
    if (wiredKey) {
      runnerSource = 'wired';
      trainableKey = wiredKey;
    } else if (own && own.runnerSource !== 'browse-only') {
      runnerSource = own.runnerSource;
      trainableKey = spec.id;
    }

    const specSessions = runnerKeys.flatMap(key => sessionsByRunner.get(key) ?? []);
    const completed = specSessions.filter(s => s.status === 'completed');

    let lastSessionAtMilliseconds: number | null = null;
    for (const s of specSessions) {
      if (s.startedAtMilliseconds !== null && (lastSessionAtMilliseconds === null || s.startedAtMilliseconds > lastSessionAtMilliseconds)) {
        lastSessionAtMilliseconds = s.startedAtMilliseconds;
      }
    }

    // Newest completed artifact that carries a lens record.
    const lensModelId =
      completed
        .filter(s => s.versionedModelId !== null && isLensReady(s.versionedModelId))
        .sort((a, b) => (b.startedAtMilliseconds ?? 0) - (a.startedAtMilliseconds ?? 0))[0]
        ?.versionedModelId ?? null;

    const specVersions = versions.filter(v => v.catalogId === spec.id || runnerKeys.includes(v.runnerKey));
    const runningDeploymentCount = specVersions.reduce(
      (total, v) => total + (runningByVersion.get(v.versionId) ?? 0),
      0,
    );

    let stage: LifecycleStage = spec.hasContent ? 'spec' : 'unwritten';
    if (runnerSource) stage = 'trainable';
    if (completed.length > 0) stage = 'trained';
    if (lensModelId) stage = 'lens_ready';
    if (runningDeploymentCount > 0) stage = 'deployed';

    lifecycle[spec.id] = {
      stage,
      runnerSource,
      trainableKey,
      runnerKeys,
      sessionCount: specSessions.length,
      completedSessionCount: completed.length,
      lastSessionAtMilliseconds,
      lensModelId,
      versionCount: specVersions.length,
      runningDeploymentCount,
    };
  }

  return { lifecycle, unattachedSessionCount, sessionCount: sessions.length };
}

// ─── Gathering ──────────────────────────────────────────────────────────────

export function getCatalogLifecycle(): CatalogLifecycleResponse {
  const specs = getCatalogModels({ includeEmpty: true }).models.map(m => ({
    id: m.id,
    hasContent: m.hasContent,
  }));

  // A runner's spec comes from the composed registry entry (wired: the
  // algorithm's `catalogSpec`) or from the runner itself (generated: the spec
  // id `generate_model.py --register` wrote). The runner's own record wins —
  // it was written at the moment the spec was turned into code.
  const composed = listModels();
  const runners: Record<string, LifecycleRunner> = {};
  for (const [key, runner] of Object.entries(listRunners())) {
    runners[key] = {
      catalogId: runner.catalogId ?? composed[key]?.catalogId,
      legacyId: runner.legacyId,
    };
  }

  const sessions = listSessions().map(s => ({
    modelType: s.modelType,
    status: s.status,
    startedAtMilliseconds: s.startedAt ? s.startedAt.getTime() : null,
    versionedModelId: s.versionedModelId,
  }));

  const modelsDir = path.resolve(process.cwd(), getTrainingConfig().paths.modelsDir);
  const isLensReady = (versionedModelId: string): boolean => {
    // `path.basename` keeps a hand-edited row from walking out of modelsDir.
    const manifest = path.join(modelsDir, path.basename(versionedModelId), 'lens', 'manifest.json');
    return fs.existsSync(manifest);
  };

  return buildCatalogLifecycle({
    specs,
    trainable: getTrainableModels(),
    runners,
    sessions,
    versions: db
      .select({
        versionId: modelVersions.versionId,
        catalogId: modelVersions.catalogId,
        runnerKey: modelVersions.runnerKey,
      })
      .from(modelVersions)
      .all(),
    deployments: db
      .select({ versionId: deployments.versionId, status: deployments.status })
      .from(deployments)
      .all(),
    isLensReady,
  });
}
