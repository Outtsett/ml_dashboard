/**
 * Trainable model types — the contract for `/api/model-catalog/trainable`.
 *
 * Surface emitted by `getTrainableModels()` (server-side `catalogBridge.ts`)
 * and consumed by `useTrainableCatalog()` (client-side `useModelCatalog.ts`).
 *
 * Owned by frontend-lead per W2.d cross-domain contract; backend-lead's W2.a
 * implementation MUST match this shape.
 *
 * Badge taxonomy (W2.d):
 *   - `runnerSource: 'wired'`        → emerald `WIRED` badge          (ready-to-train, hand-configured runner)
 *   - `runnerSource: 'generate'`     → amber/blue `GENERATE-<family>` (template-generated runner needs review)
 *   - `runnerSource: 'browse-only'`  → muted gray `BROWSE-ONLY`       (catalog spec with no template match)
 */

import type { ModelRegistryEntry } from "./trainingTypes";

/**
 * Template identifiers from `src/config/model-templates.json`.
 *
 * Used by:
 *   - Server-side `catalogBridge.ts` to map catalog specs → training scripts
 *   - Client-side `ModelCatalogPicker` to render `GENERATE-<family>` badges
 *   - W4 `ArchitectureComposer` to filter sub-pickers by allowed families
 */
export type TemplateId =
  | "sklearn"
  | "tree"
  | "gmm"
  | "pytorch_mlp"
  | "pytorch_cnn"
  | "pytorch_autoencoder"
  | "pytorch_vae"
  | "transformer_seq"
  | "hmm"
  | "composite_moe"
  | "composite_stacking"
  | "composite_voting"
  | "composite_multimodal"
  | "rl_dqn"
  | "rl_ppo"
  | "rl_a2c";

/**
 * Source classification for the runner backing a trainable model.
 *
 *   - `wired`       — explicit entry in `src/config/models.json` with a real
 *                     script path that exists on disk. Always trainable.
 *   - `generate`    — catalog spec matched to a template in
 *                     `src/config/model-templates.json`; runner will be
 *                     auto-generated on save. Trainable after preview review.
 *   - `browse-only` — catalog spec with no template match. Documentation only.
 */
export type RunnerSource = "wired" | "generate" | "browse-only";

/**
 * Single record returned by `GET /api/model-catalog/trainable`.
 *
 * Extends the existing `ModelRegistryEntry` with the three discriminator
 * fields the picker needs: `trainable`, `source`, plus the W2 additions
 * `templateId` (already-typed on `ModelRegistryEntry`) and `runnerSource`
 * (new — drives the 3-state badge).
 */
export interface TrainableModel extends ModelRegistryEntry {
  /** True iff a working runner script exists OR can be generated from a template. */
  trainable: boolean;
  /** Whether the entry came from the hand-configured registry or the auto-scanned catalog. */
  source: "registry" | "catalog";
  /** Template that backs this entry (null when no template matched and no wired script). */
  templateId: TemplateId | null;
  /** Discriminator for the 3-state badge — see W2.d badge taxonomy comment above. */
  runnerSource: RunnerSource;
}

/**
 * Response shape for `GET /api/model-catalog/trainable`.
 *
 * Map keyed by catalog/registry id (e.g. "transformer_seq+direction_classifier",
 * "two_stream_transformer", "regime_hmm"). Order is not guaranteed; clients
 * sort/filter as needed.
 */
export type TrainableCatalogResponse = Record<string, TrainableModel>;
