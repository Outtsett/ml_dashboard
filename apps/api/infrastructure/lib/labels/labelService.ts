/**
 * Label Service — Barrel re-export
 *
 * All implementation has been split into:
 *   - labelHelpers.ts    — lake queries, timestamp handling, timeframe mapping
 *   - labelServiceCore.ts — Generation, preview, management, contrastive pairs
 */

// Re-export everything from the core module
export {
  generateLabels,
  previewLabels,
  getLabelSets,
  getLabelSetById,
  getContrastivePairsForLabelSet,
  deleteLabelSet,
  labelService,
} from './labelServiceCore';

export type {
  LabelGenerationRequest,
  LabelGenerationResult,
  LabelPreviewRequest,
} from './labelServiceCore';

// Re-export helpers for consumers that need lake label queries
export {
  queryLabels,
  getTimeframeTable,
  buildMetaLabelSQL,
} from './labelHelpers';

export type { LoadOHLCVOptions } from './labelHelpers';

