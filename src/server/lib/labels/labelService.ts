/**
 * Label Service — Barrel re-export
 *
 * All implementation has been split into:
 *   - labelHelpers.ts    — DuckDB access, OHLCV loading, synthetic data
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

// Re-export helpers for consumers that need direct DuckDB/OHLCV access
export {
  getDuckDB,
  queryDuckDB,
  generateSyntheticOHLCV,
  loadOHLCVIntoDuckDB,
} from './labelHelpers';

export type { LoadOHLCVOptions } from './labelHelpers';
