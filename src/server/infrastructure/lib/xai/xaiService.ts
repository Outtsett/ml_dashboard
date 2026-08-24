/**
 * XAI Service — Barrel re-export
 *
 * All implementation has been split into:
 *   - xaiTypes.ts       — Interfaces and types
 *   - xaiMethods.ts     — Standalone XAI compute & summary functions
 *   - xaiServiceCore.ts — XAIService class + singleton instance
 */

// Re-export the class and singleton
export { XAIService, xaiService } from './xaiServiceCore';

// Re-export types
export type {
  FeatureContribution,
  CalibrationBin,
  CounterfactualExample,
  XAIConfig,
  PredictionWithExplanation,
} from './xaiTypes';

// Re-export method functions for direct use
export {
  computeSHAP,
  computePermutationImportance,
  computeGradCAM,
  computeIntegratedGradients,
  computeSaliency,
  computeLIME,
  computeFeatureInteractions,
  computeCalibration,
  computeCounterfactuals,
  softmax,
} from './xaiMethods';
