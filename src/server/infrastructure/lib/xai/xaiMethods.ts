/**
 * XAI Methods — Backward-Compatibility Barrel
 *
 * Re-exports all XAI compute methods and math utilities from their
 * single-responsibility modules. Consumers importing from this file
 * continue to work unchanged.
 */

// Math utilities
export { softmax } from './xaiMath';

// All 9 XAI methods + their summary generators
export {
  computeSHAP,
  generateSHAPSummary,
  computePermutationImportance,
  generatePermutationSummary,
  computeGradCAM,
  generateGradCAMSummary,
  computeIntegratedGradients,
  generateIntegratedGradientsSummary,
  computeSaliency,
  generateSaliencySummary,
  computeLIME,
  generateLIMESummary,
  computeFeatureInteractions,
  generateInteractionSummary,
  computeCalibration,
  generateCalibrationSummary,
  computeCounterfactuals,
  generateCounterfactualSummary,
} from './methods/index';
