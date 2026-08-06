/**
 * XAI Methods — Barrel Export
 *
 * Each method is in its own file (SRP). Add new methods by creating
 * a new file and re-exporting here (OCP).
 */

export { computeSHAP, generateSHAPSummary } from './shap';
export { computePermutationImportance, generatePermutationSummary } from './permutation';
export { computeGradCAM, generateGradCAMSummary } from './gradcam';
export { computeIntegratedGradients, generateIntegratedGradientsSummary } from './integratedGradients';
export { computeSaliency, generateSaliencySummary } from './saliency';
export { computeLIME, generateLIMESummary } from './lime';
export { computeFeatureInteractions, generateInteractionSummary } from './featureInteractions';
export { computeCalibration, generateCalibrationSummary } from './calibration';
export { computeCounterfactuals, generateCounterfactualSummary } from './counterfactuals';
