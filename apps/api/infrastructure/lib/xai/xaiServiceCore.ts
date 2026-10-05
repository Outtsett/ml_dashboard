/**
 * XAI Service Core
 *
 * Slim XAIService class that holds model state and delegates
 * to standalone method implementations in xaiMethods.ts.
 */

import * as tf from '@tensorflow/tfjs-node';
import path from 'path';
import { XAI_METHODS, type XAIExplanation } from '@shared/mlTaxonomy';
import { storage } from '../../storage';
import { getModelDiagnostics } from '../modelResults';
import type { XAIConfig, PredictionWithExplanation, FeatureContribution, CalibrationBin, CounterfactualExample } from './xaiTypes';
import { logInfo } from "../log";
import {
  softmax,
  computeSHAP,
  computePermutationImportance,
  computeGradCAM,
  computeIntegratedGradients,
  computeSaliency,
  computeLIME,
  computeFeatureInteractions,
  computeCalibration,
  computeCounterfactuals,
  generateSHAPSummary,
  generatePermutationSummary,
  generateGradCAMSummary,
  generateIntegratedGradientsSummary,
  generateSaliencySummary,
  generateLIMESummary,
  generateInteractionSummary,
  generateCalibrationSummary,
  generateCounterfactualSummary,
} from './xaiMethods';

// ─── XAI Method Registry (OCP: add new method = add entry here) ─────────────

type Prediction = { class: number; confidence: number; probabilities: number[]; direction: 'up' | 'down' | 'neutral' };

interface XAIMethodResult {
  featureContributions: FeatureContribution[];
  attentionWeights?: number[];
  calibration?: { expectedConfidence: number; actualAccuracy: number; reliabilityDiagram: CalibrationBin[] };
  counterfactuals?: CounterfactualExample[];
  summary: string;
}

type XAIMethodHandler = (input: number[][], prediction: Prediction, params: Record<string, unknown>) => XAIMethodResult;

const XAI_METHOD_HANDLERS: Record<string, XAIMethodHandler> = {
  shap: (input, prediction, params) => {
    const fc = computeSHAP(input, prediction, params);
    return { featureContributions: fc, summary: generateSHAPSummary(fc, prediction) };
  },
  permutation: (input, prediction, params) => {
    const fc = computePermutationImportance(input, prediction, params);
    return { featureContributions: fc, summary: generatePermutationSummary(fc) };
  },
  gradcam: (input, _prediction, params) => {
    const aw = computeGradCAM(input, params);
    return { featureContributions: [], attentionWeights: aw, summary: generateGradCAMSummary(aw) };
  },
  integratedGradients: (input, prediction, params) => {
    const fc = computeIntegratedGradients(input, prediction, params);
    return { featureContributions: fc, summary: generateIntegratedGradientsSummary(fc, prediction) };
  },
  saliency: (input, prediction, params) => {
    const fc = computeSaliency(input, prediction, params);
    return { featureContributions: fc, summary: generateSaliencySummary(fc) };
  },
  lime: (input, prediction, params) => {
    const fc = computeLIME(input, prediction, params);
    return { featureContributions: fc, summary: generateLIMESummary(fc, prediction) };
  },
  featureInteraction: (input, prediction, params) => {
    const fc = computeFeatureInteractions(input, prediction, params);
    return { featureContributions: fc, summary: generateInteractionSummary(fc) };
  },
  confidenceCalibration: (_input, prediction, params) => {
    const cal = computeCalibration(prediction, params);
    return { featureContributions: [], calibration: cal, summary: generateCalibrationSummary(cal) };
  },
  counterfactual: (input, prediction, params) => {
    const cf = computeCounterfactuals(input, prediction, params);
    return { featureContributions: [], counterfactuals: cf, summary: generateCounterfactualSummary(cf, prediction) };
  },
};


export class XAIService {
  private model: tf.LayersModel | null = null;
  private modelId: number | null = null;

  async loadModel(modelId: number): Promise<boolean> {
    if (this.modelId === modelId && this.model) {
      return true;
    }

    const savedModel = await storage.getMlModel(modelId);
    // Same absent column as modelInference.ts: `ml_models` has no artifact-path
    // field, nothing writes one, and there is no TensorFlow.js model in the tree
    // to point at — this repo's models are Python artifacts under data/models/.
    // Casting MlModel to `{ modelPath?: string }` would only restate the fiction,
    // so this refuses instead. The SHAP served from data/models/ is unaffected.
    if (!savedModel) {
      logInfo(`[XAI] Model ${modelId} not found in storage`);
      return false;
    }
    logInfo(
      `[XAI] Model ${modelId} has no TensorFlow.js artifact: ml_models stores no path ` +
        `and this build ships no .js models. SHAP read from data/models/ is unaffected.`,
    );
    return false;

  }

  async explainPrediction(
    input: number[][],
    config: XAIConfig,
    modelId: number
  ): Promise<PredictionWithExplanation> {
    const modelLoaded = await this.loadModel(modelId);

    let prediction: { class: number; confidence: number; probabilities: number[]; direction: 'up' | 'down' | 'neutral' };
    let featureContributions: FeatureContribution[] = [];

    if (modelLoaded && this.model) {
      const inputTensor = tf.tensor3d([input]);
      const outputTensor = this.model.predict(inputTensor) as tf.Tensor;
      const probs = await outputTensor.data();
      const probabilities = Array.from(probs);
      const maxIdx = probabilities.indexOf(Math.max(...probabilities));

      prediction = {
        class: maxIdx,
        confidence: probabilities[maxIdx]!,
        probabilities,
        direction: maxIdx === 0 ? 'down' : maxIdx === 2 ? 'up' : 'neutral'
      };

      inputTensor.dispose();
      outputTensor.dispose();
    } else {
      prediction = this.generateMockPrediction();
    }

    // OCP: dispatch via registry — adding a new XAI method = add entry to XAI_METHOD_HANDLERS
    const handler = XAI_METHOD_HANDLERS[config.method];
    const result = handler
      ? handler(input, prediction, config.params ?? {})
      : { featureContributions: computeSHAP(input, prediction, {}), summary: 'Default SHAP-based explanation' };

    featureContributions = result.featureContributions;
    const attentionWeights = result.attentionWeights;
    const calibration = result.calibration;
    const counterfactuals = result.counterfactuals;
    const summary = result.summary;

    const explanation: XAIExplanation = {
      method: config.method,
      timestamp: Date.now(),
      prediction: {
        class: prediction.class,
        confidence: prediction.confidence,
        probabilities: prediction.probabilities,
      },
      featureContributions: featureContributions.length > 0 ? featureContributions : undefined,
      attentionWeights,
      calibration,
      counterfactuals,
      summary,
    };

    return { prediction, explanation };
  }

  private generateMockPrediction() {
    const probabilities = softmax([Math.random(), Math.random(), Math.random()]);
    const maxIdx = probabilities.indexOf(Math.max(...probabilities));
    return {
      class: maxIdx,
      confidence: probabilities[maxIdx]!,
      probabilities,
      direction: (maxIdx === 0 ? 'down' : maxIdx === 2 ? 'up' : 'neutral') as 'up' | 'down' | 'neutral'
    };
  }

  /**
   * Real SHAP importance for a trained regime model (e.g. "MNQ_1m").
   * Reads diagnostics.json shap_summary and aggregates mean |SHAP|
   * across all regimes per feature — same analytical SHAP values
   * computed by packages/ml-engine/src/model_io/shap.py during training.
   */
  getRegimeModelImportance(modelId: string): FeatureContribution[] {
    const modelsDir = path.join(process.cwd(), "data", "models");
    const diag = getModelDiagnostics(modelsDir, modelId) as Record<string, unknown> | null;
    if (!diag) return [];

    const shapSummary = diag.shap_summary as Array<{
      regime_id: number;
      top_features: Array<{ feature: string; mean_abs_shap: number; mean_shap: number }>;
    }> | undefined;
    const featureNames = diag.feature_names as string[] | undefined;

    if (!shapSummary?.length || !featureNames?.length) return [];

    // Aggregate mean_abs_shap across all regimes per feature
    const importanceMap = new Map<string, { absShap: number; meanShap: number }>();
    for (const regime of shapSummary) {
      for (const feat of regime.top_features) {
        const existing = importanceMap.get(feat.feature) ?? { absShap: 0, meanShap: 0 };
        existing.absShap += feat.mean_abs_shap;
        existing.meanShap += feat.mean_shap;
        importanceMap.set(feat.feature, existing);
      }
    }

    const nRegimes = shapSummary.length;
    return featureNames
      .map((name) => {
        const data = importanceMap.get(name) ?? { absShap: 0, meanShap: 0 };
        const importance = data.absShap / nRegimes;
        return {
          feature: name,
          value: importance,
          contribution: data.meanShap / nRegimes,
          direction: (data.meanShap >= 0 ? 'positive' : 'negative') as 'positive' | 'negative',
        };
      })
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }

  listMethods(): typeof XAI_METHODS {
    return XAI_METHODS;
  }
}

export const xaiService = new XAIService();
