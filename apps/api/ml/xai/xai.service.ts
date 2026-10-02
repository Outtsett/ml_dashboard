import { Injectable } from '@nestjs/common';
import { xaiService as xaiSingleton } from '../../infrastructure/lib/xai/xaiServiceCore';
import type { XAIConfig, PredictionWithExplanation } from '../../infrastructure/lib/xai/xaiTypes';

@Injectable()
export class XaiService {

  /** Load a TensorFlow.js model by ID (caches after first load). */
  loadModel(modelId: number): Promise<boolean> {
    return xaiSingleton.loadModel(modelId);
  }

  /** Generate an explanation for a single input sample. */
  explainPrediction(
    input: number[][],
    config: XAIConfig,
    modelId: number,
  ): Promise<PredictionWithExplanation> {
    return xaiSingleton.explainPrediction(input, config, modelId);
  }

  /** List all available XAI methods. */
  listMethods() {
    return xaiSingleton.listMethods();
  }
}
