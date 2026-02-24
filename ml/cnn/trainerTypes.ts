/**
 * Trainer Types
 *
 * Shared type definitions for the MLTrainer class and its consumers.
 * Extracted to keep trainer.ts focused on training logic.
 */

import * as path from 'path';
import type * as tf from '@tensorflow/tfjs-node';
import type { CNNConfig } from './cnn';
import type { DataConfig } from './dataPipeline';
import type { UniversalDataConfig } from './universalPipeline';

export const MODELS_DIR = path.join(process.cwd(), 'data', 'models');

export interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  valLoss: number;
  accuracy: number;
  valAccuracy: number;
  learningRate: number;
  batchSize: number;
  status: 'training' | 'completed' | 'error' | 'stopped';
  message?: string;
  elapsedMs?: number;
}

export interface TrainingSession {
  id: string;
  symbol: string;
  config: CNNConfig;
  dataConfig: DataConfig;
  startTime: number;
  progress: TrainingProgress[];
  status: 'running' | 'completed' | 'error' | 'stopped';
  model?: tf.Sequential;
  savedModelId?: number;
  modelPath?: string;
  featureNames?: string[];
  universalConfig?: Partial<UniversalDataConfig>;
}
