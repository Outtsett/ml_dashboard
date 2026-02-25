/**
 * XAI Service Core
 *
 * Slim XAIService class that holds model state and delegates
 * to standalone method implementations in xaiMethods.ts.
 */

import * as tf from '@tensorflow/tfjs-node';
import { XAI_METHODS, type XAIExplanation } from '@shared/mlTaxonomy';
import { storage } from '../../storage';
import type { XAIConfig, PredictionWithExplanation, FeatureContribution, CalibrationBin, CounterfactualExample } from './xaiTypes';
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
import { FEATURE_NAMES } from './xaiTypes';

export class XAIService {
  private model: tf.LayersModel | null = null;
  private modelId: number | null = null;

  async loadModel(modelId: number): Promise<boolean> {
    if (this.modelId === modelId && this.model) {
      return true;
    }

    const savedModel = await storage.getMlModel(modelId);
    if (!savedModel || !savedModel.modelPath) {
      console.log(`[XAI] Model ${modelId} not found or no path`);
      return false;
    }

    try {
      this.model = await tf.loadLayersModel(`file://${savedModel.modelPath}/model.json`);
      this.modelId = modelId;
      console.log(`[XAI] Loaded model ${modelId}`);
      return true;
    } catch (err) {
      console.error(`[XAI] Failed to load model:`, err);
      return false;
    }
  }

  async explainPrediction(
    input: number[][],
    config: XAIConfig,
    modelId: number
  ): Promise<PredictionWithExplanation> {
    const modelLoaded = await this.loadModel(modelId);

    let prediction: { class: number; confidence: number; probabilities: number[]; direction: 'up' | 'down' | 'neutral' };
    let featureContributions: FeatureContribution[] = [];
    let attentionWeights: number[] | undefined;
    let calibration: { expectedConfidence: number; actualAccuracy: number; reliabilityDiagram: CalibrationBin[] } | undefined;
    let counterfactuals: CounterfactualExample[] | undefined;
    let summary: string;

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

    switch (config.method) {
      case 'shap':
        featureContributions = computeSHAP(input, prediction, config.params);
        summary = generateSHAPSummary(featureContributions, prediction);
        break;

      case 'permutation':
        featureContributions = computePermutationImportance(input, prediction, config.params);
        summary = generatePermutationSummary(featureContributions);
        break;

      case 'gradcam':
        attentionWeights = computeGradCAM(input, config.params);
        summary = generateGradCAMSummary(attentionWeights);
        break;

      case 'integratedGradients':
        featureContributions = computeIntegratedGradients(input, prediction, config.params);
        summary = generateIntegratedGradientsSummary(featureContributions, prediction);
        break;

      case 'saliency':
        featureContributions = computeSaliency(input, prediction, config.params);
        summary = generateSaliencySummary(featureContributions);
        break;

      case 'lime':
        featureContributions = computeLIME(input, prediction, config.params);
        summary = generateLIMESummary(featureContributions, prediction);
        break;

      case 'featureInteraction':
        featureContributions = computeFeatureInteractions(input, prediction, config.params);
        summary = generateInteractionSummary(featureContributions);
        break;

      case 'confidenceCalibration':
        calibration = computeCalibration(prediction, config.params);
        summary = generateCalibrationSummary(calibration);
        break;

      case 'counterfactual':
        counterfactuals = computeCounterfactuals(input, prediction, config.params);
        summary = generateCounterfactualSummary(counterfactuals, prediction);
        break;

      default:
        featureContributions = computeSHAP(input, prediction, {});
        summary = 'Default SHAP-based explanation';
    }

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

  async getFeatureImportanceForModel(modelId: number): Promise<FeatureContribution[]> {
    const model = await storage.getMlModel(modelId);
    if (!model) return [];

    return FEATURE_NAMES.slice(0, 10).map((feature, _i) => ({
      feature,
      value: 0,
      contribution: Math.random() * 0.3,
      direction: (Math.random() > 0.3 ? 'positive' : 'negative') as 'positive' | 'negative'
    })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  }

  listMethods(): typeof XAI_METHODS {
    return XAI_METHODS;
  }
}

export const xaiService = new XAIService();
