/**
 * Walk-Forward Validation Engine
 *
 * Think of it as: Instead of training your pilot on Monday and testing on Tuesday once,
 * you train on Mon→Wed, test on Thu. Then train on Mon→Thu, test on Fri.
 * Then train on Mon→Fri, test next Mon. Each window "walks forward" through history.
 *
 * This catches overfitting that a single 80/20 split can't — it reveals whether
 * the model performs consistently across DIFFERENT market conditions (trending,
 * ranging, volatile, calm).
 *
 * Modes:
 * - Anchored: Training window always starts from the same point, growing over time
 * - Rolling: Training window is fixed-size, sliding forward
 * - Expanding: Like anchored, with optional minimum training size
 *
 * Each fold produces: train period, test period, metrics, predictions
 * Aggregate metrics show the model's TRUE expected performance.
 */

import * as tf from '@tensorflow/tfjs-node';
import { createCNNModel, type CNNConfig, defaultConfig } from '@ml/cnn/cnn';
import {
  loadUniversalTrainingData,
  disposeUniversalData,
  getFeatureNames,
  DEFAULT_DATA_CONFIG,
  DEFAULT_FEATURE_CONFIG,
  type UniversalDataConfig,
  type UniversalTrainingData,
  type NormalizationStats,
} from '@ml/cnn/universalPipeline';
import { questdbMarketQuery as marketQuery } from '@server/lib/questdbMarketQuery';
import { EventEmitter } from 'events';

// ============================================================
// TYPES
// ============================================================

export type WalkForwardMode = 'anchored' | 'rolling' | 'expanding';

export interface WalkForwardConfig {
  /** Symbol to validate on */
  symbol: string;
  /** 'anchored' = fixed start, 'rolling' = moving window, 'expanding' = growing window */
  mode: WalkForwardMode;
  /** Number of folds */
  numFolds: number;
  /** Test window size as number of bars (or fraction 0-1 of total) */
  testSize: number | string;
  /** Min training samples (only for expanding mode) */
  minTrainSamples?: number;
  /** Gap between train and test (bars) to prevent leakage */
  gapBars?: number;
  /** Training epochs per fold */
  epochsPerFold?: number;
  /** Batch size */
  batchSize?: number;
  /** Universal pipeline config overrides */
  universalConfig?: Partial<UniversalDataConfig>;
  /** CNN config overrides */
  cnnConfig?: Partial<CNNConfig>;
}

export interface FoldResult {
  foldIndex: number;
  trainRange: { startIdx: number; endIdx: number; startTs?: number; endTs?: number };
  testRange: { startIdx: number; endIdx: number; startTs?: number; endTs?: number };
  trainSamples: number;
  testSamples: number;
  metrics: {
    trainLoss: number;
    trainAccuracy: number;
    testLoss: number;
    testAccuracy: number;
    bestValLoss: number;
    bestEpoch: number;
  };
  predictions: {
    timestamp: number;
    actual: number;
    predicted: number;
    confidence: number;
    probabilities: number[];
  }[];
  trainingTimeMs: number;
}

export interface WalkForwardResult {
  config: WalkForwardConfig;
  folds: FoldResult[];
  aggregateMetrics: {
    meanTestAccuracy: number;
    stdTestAccuracy: number;
    meanTestLoss: number;
    stdTestLoss: number;
    meanTrainAccuracy: number;
    overallAccuracy: number;
    totalPredictions: number;
    /** If testAcc is much lower than trainAcc, the model is overfitting */
    overfitRatio: number;
    /** Variance across folds — high = model is unstable across market conditions */
    stabilityScore: number;
    /** Directional accuracy per class */
    perClassAccuracy: Record<string, number>;
    foldAccuracies: number[];
  };
  totalTimeMs: number;
  symbol: string;
  featureNames: string[];
}

// ============================================================
// WALK-FORWARD ENGINE
// ============================================================

export class WalkForwardValidator extends EventEmitter {
  private shouldStop = false;

  /**
   * Run walk-forward validation.
   * Emits 'fold-start', 'fold-progress', 'fold-complete', 'complete' events.
   */
  async run(config: WalkForwardConfig): Promise<WalkForwardResult> {
    this.shouldStop = false;
    const totalStart = Date.now();

    const epochsPerFold = config.epochsPerFold || 20;
    const batchSize = config.batchSize || 32;
    const gapBars = config.gapBars || 0;
    const numFolds = config.numFolds;

    // Load all data first (we'll slice it into folds)
    console.log(`[WalkForward] Loading data for ${config.symbol}...`);

    this.emit('status', {
      status: 'loading',
      message: `Loading data for ${config.symbol}...`,
    });

    const universalCfg: Partial<UniversalDataConfig> = {
      ...config.universalConfig,
      symbol: config.symbol,
      maxBars: config.universalConfig?.maxBars || 200000, // Load more for walk-forward
    };

    // We need the raw feature data (not tensors) so we can slice manually
    const featureConfig = { ...DEFAULT_FEATURE_CONFIG, ...universalCfg.features };
    const allData = await loadUniversalTrainingData(universalCfg);

    const totalSamples = allData.trainSize + allData.valSize;
    const featureNames = allData.featureNames;
    const numFeatures = allData.numFeatures;
    const numClasses = allData.numClasses;

    // Get raw data as arrays (extract from tensors)
    const allFeatures = await allData.features.array() as number[][][];
    const allLabels = await allData.labels.array() as number[][];

    // Dispose original tensors — we have the arrays now
    disposeUniversalData(allData);

    console.log(`[WalkForward] ${totalSamples} total samples, ${numFolds} folds`);

    // Compute fold boundaries
    let testSizeBars: number;
    if (typeof config.testSize === 'string') {
      testSizeBars = Math.floor(totalSamples * parseFloat(config.testSize));
    } else if (config.testSize < 1) {
      testSizeBars = Math.floor(totalSamples * config.testSize);
    } else {
      testSizeBars = config.testSize;
    }

    testSizeBars = Math.max(50, testSizeBars); // At least 50 test samples

    const folds: FoldResult[] = [];
    const cnnCfg: CNNConfig = {
      ...defaultConfig,
      ...config.cnnConfig,
      numFeatures,
      outputSize: numClasses,
      sequenceLength: universalCfg.sequenceLength || DEFAULT_DATA_CONFIG.sequenceLength,
    };

    for (let fold = 0; fold < numFolds; fold++) {
      if (this.shouldStop) break;

      const foldStart = Date.now();
      console.log(`[WalkForward] ─── Fold ${fold + 1}/${numFolds} ───`);

      this.emit('fold-start', {
        fold: fold + 1,
        totalFolds: numFolds,
        message: `Starting fold ${fold + 1}/${numFolds}`,
      });

      // Compute boundaries based on mode
      let trainStartIdx: number, trainEndIdx: number, testStartIdx: number, testEndIdx: number;

      if (config.mode === 'rolling') {
        // Fixed-size train window that slides forward
        const trainSize = totalSamples - numFolds * testSizeBars;
        testEndIdx = totalSamples - (numFolds - fold - 1) * testSizeBars;
        testStartIdx = testEndIdx - testSizeBars;
        trainEndIdx = testStartIdx - gapBars;
        trainStartIdx = Math.max(0, trainEndIdx - trainSize);
      } else if (config.mode === 'expanding') {
        // Growing train window
        const minTrain = config.minTrainSamples || Math.floor(totalSamples * 0.3);
        testEndIdx = totalSamples - (numFolds - fold - 1) * testSizeBars;
        testStartIdx = testEndIdx - testSizeBars;
        trainEndIdx = testStartIdx - gapBars;
        trainStartIdx = 0;

        if (trainEndIdx < minTrain) {
          console.log(`[WalkForward] Skipping fold ${fold + 1} — not enough training data (${trainEndIdx} < ${minTrain})`);
          continue;
        }
      } else {
        // Anchored (default): fixed start, growing end
        testEndIdx = totalSamples - (numFolds - fold - 1) * testSizeBars;
        testStartIdx = testEndIdx - testSizeBars;
        trainEndIdx = testStartIdx - gapBars;
        trainStartIdx = 0;
      }

      // Bounds check
      if (trainStartIdx < 0) trainStartIdx = 0;
      if (trainEndIdx <= trainStartIdx + 50) {
        console.log(`[WalkForward] Skipping fold ${fold + 1} — insufficient training data`);
        continue;
      }
      if (testEndIdx > totalSamples) testEndIdx = totalSamples;
      if (testStartIdx >= testEndIdx) {
        console.log(`[WalkForward] Skipping fold ${fold + 1} — invalid test range`);
        continue;
      }

      const trainX = allFeatures.slice(trainStartIdx, trainEndIdx);
      const trainY = allLabels.slice(trainStartIdx, trainEndIdx);
      const testX = allFeatures.slice(testStartIdx, testEndIdx);
      const testY = allLabels.slice(testStartIdx, testEndIdx);

      console.log(`[WalkForward] Train: [${trainStartIdx}..${trainEndIdx}] (${trainX.length}), Test: [${testStartIdx}..${testEndIdx}] (${testX.length})`);

      // Create tensors
      const trainFeaturesTensor = tf.tensor3d(trainX);
      const trainLabelsTensor = tf.tensor2d(trainY);
      const testFeaturesTensor = tf.tensor3d(testX);
      const testLabelsTensor = tf.tensor2d(testY);

      // Create model for this fold (fresh model each fold)
      const model = createCNNModel(cnnCfg);

      // Train
      let bestValLoss = Infinity;
      let bestEpoch = 0;
      let lastLoss = 1.0;
      let lastAcc = 0.33;

      for (let epoch = 1; epoch <= epochsPerFold; epoch++) {
        if (this.shouldStop) break;

        const history = await model.fit(trainFeaturesTensor, trainLabelsTensor, {
          epochs: 1,
          batchSize,
          validationData: [testFeaturesTensor, testLabelsTensor],
          verbose: 0,
        });

        lastLoss = history.history.loss![0] as number;
        const valLoss = history.history.val_loss![0] as number;
        lastAcc = (history.history.acc?.[0] as number) || 0.33;
        const valAcc = (history.history.val_acc?.[0] as number) || 0.33;

        if (valLoss < bestValLoss) {
          bestValLoss = valLoss;
          bestEpoch = epoch;
        }

        this.emit('fold-progress', {
          fold: fold + 1,
          epoch,
          totalEpochs: epochsPerFold,
          trainLoss: lastLoss,
          testLoss: valLoss,
          trainAcc: lastAcc,
          testAcc: valAcc,
        });
      }

      // Evaluate on test set
      const evalResult = model.evaluate(testFeaturesTensor, testLabelsTensor) as tf.Scalar[];
      const testLoss = (await evalResult[0]!.data())[0]!;
      const testAccuracy = (await evalResult[1]!.data())[0]!;
      evalResult.forEach(t => t.dispose());

      const trainEvalResult = model.evaluate(trainFeaturesTensor, trainLabelsTensor) as tf.Scalar[];
      const trainLoss = (await trainEvalResult[0]!.data())[0]!;
      const trainAccuracy = (await trainEvalResult[1]!.data())[0]!;
      trainEvalResult.forEach(t => t.dispose());

      // Generate predictions on test set
      const predsTensor = model.predict(testFeaturesTensor) as tf.Tensor;
      const predsArray = await predsTensor.array() as number[][];
      predsTensor.dispose();

      const predictions = predsArray.map((probs, idx) => {
        const actualLabel = testY[idx]!;
        const actualClass = actualLabel.indexOf(Math.max(...actualLabel));
        const predClass = probs.indexOf(Math.max(...probs));

        return {
          timestamp: 0, // We don't have timestamps in this path
          actual: actualClass,
          predicted: predClass,
          confidence: Math.max(...probs),
          probabilities: probs,
        };
      });

      // Clean up this fold
      model.dispose();
      trainFeaturesTensor.dispose();
      trainLabelsTensor.dispose();
      testFeaturesTensor.dispose();
      testLabelsTensor.dispose();

      const foldResult: FoldResult = {
        foldIndex: fold,
        trainRange: { startIdx: trainStartIdx, endIdx: trainEndIdx },
        testRange: { startIdx: testStartIdx, endIdx: testEndIdx },
        trainSamples: trainX.length,
        testSamples: testX.length,
        metrics: {
          trainLoss,
          trainAccuracy,
          testLoss,
          testAccuracy,
          bestValLoss,
          bestEpoch,
        },
        predictions,
        trainingTimeMs: Date.now() - foldStart,
      };

      folds.push(foldResult);

      console.log(
        `[WalkForward] Fold ${fold + 1}: Train Acc ${(trainAccuracy * 100).toFixed(1)}%, ` +
        `Test Acc ${(testAccuracy * 100).toFixed(1)}%, ` +
        `Time ${((Date.now() - foldStart) / 1000).toFixed(1)}s`
      );

      this.emit('fold-complete', {
        fold: fold + 1,
        totalFolds: numFolds,
        trainAccuracy,
        testAccuracy,
        testLoss,
        trainingTimeMs: foldResult.trainingTimeMs,
      });
    }

    // Compute aggregate metrics
    const aggregateMetrics = this.computeAggregateMetrics(folds);
    const totalTimeMs = Date.now() - totalStart;

    const result: WalkForwardResult = {
      config,
      folds,
      aggregateMetrics,
      totalTimeMs,
      symbol: config.symbol,
      featureNames,
    };

    console.log(`[WalkForward] Complete: ${folds.length} folds in ${(totalTimeMs / 1000).toFixed(1)}s`);
    console.log(`[WalkForward] Mean Test Acc: ${(aggregateMetrics.meanTestAccuracy * 100).toFixed(1)}% ± ${(aggregateMetrics.stdTestAccuracy * 100).toFixed(1)}%`);
    console.log(`[WalkForward] Overfit Ratio: ${aggregateMetrics.overfitRatio.toFixed(2)} (1.0 = good, >1.5 = overfitting)`);
    console.log(`[WalkForward] Stability: ${(aggregateMetrics.stabilityScore * 100).toFixed(1)}%`);

    this.emit('complete', result);
    return result;
  }

  stop(): void {
    this.shouldStop = true;
  }

  private computeAggregateMetrics(folds: FoldResult[]): WalkForwardResult['aggregateMetrics'] {
    if (folds.length === 0) {
      return {
        meanTestAccuracy: 0,
        stdTestAccuracy: 0,
        meanTestLoss: 0,
        stdTestLoss: 0,
        meanTrainAccuracy: 0,
        overallAccuracy: 0,
        totalPredictions: 0,
        overfitRatio: 0,
        stabilityScore: 0,
        perClassAccuracy: {},
        foldAccuracies: [],
      };
    }

    const testAccs = folds.map(f => f.metrics.testAccuracy);
    const testLosses = folds.map(f => f.metrics.testLoss);
    const trainAccs = folds.map(f => f.metrics.trainAccuracy);

    const meanTestAcc = testAccs.reduce((a, b) => a + b, 0) / testAccs.length;
    const meanTestLoss = testLosses.reduce((a, b) => a + b, 0) / testLosses.length;
    const meanTrainAcc = trainAccs.reduce((a, b) => a + b, 0) / trainAccs.length;

    const stdTestAcc = Math.sqrt(
      testAccs.reduce((s, a) => s + (a - meanTestAcc) ** 2, 0) / testAccs.length
    );
    const stdTestLoss = Math.sqrt(
      testLosses.reduce((s, l) => s + (l - meanTestLoss) ** 2, 0) / testLosses.length
    );

    // Overfit ratio: how much worse the model is on test vs train
    // 1.0 = no overfitting, >1.5 = concerning, >2.0 = severe
    const overfitRatio = meanTestAcc > 0 ? meanTrainAcc / meanTestAcc : 0;

    // Stability score: 1 - coefficient of variation (higher = more stable)
    const cv = meanTestAcc > 0 ? stdTestAcc / meanTestAcc : 1;
    const stabilityScore = Math.max(0, 1 - cv);

    // Per-class accuracy
    const perClassCorrect: Record<number, number> = {};
    const perClassTotal: Record<number, number> = {};

    for (const fold of folds) {
      for (const pred of fold.predictions) {
        perClassTotal[pred.actual] = (perClassTotal[pred.actual] || 0) + 1;
        if (pred.predicted === pred.actual) {
          perClassCorrect[pred.actual] = (perClassCorrect[pred.actual] || 0) + 1;
        }
      }
    }

    const classLabels: Record<number, string> = { 0: 'up', 1: 'neutral', 2: 'down' };
    const perClassAccuracy: Record<string, number> = {};
    for (const [cls, total] of Object.entries(perClassTotal)) {
      const label = classLabels[parseInt(cls)] || `class_${cls}`;
      perClassAccuracy[label] = (perClassCorrect[parseInt(cls)] || 0) / total;
    }

    // Overall accuracy across all predictions
    const allPreds = folds.flatMap(f => f.predictions);
    const totalCorrect = allPreds.filter(p => p.predicted === p.actual).length;
    const overallAccuracy = allPreds.length > 0 ? totalCorrect / allPreds.length : 0;

    return {
      meanTestAccuracy: meanTestAcc,
      stdTestAccuracy: stdTestAcc,
      meanTestLoss: meanTestLoss,
      stdTestLoss: stdTestLoss,
      meanTrainAccuracy: meanTrainAcc,
      overallAccuracy,
      totalPredictions: allPreds.length,
      overfitRatio,
      stabilityScore,
      perClassAccuracy,
      foldAccuracies: testAccs,
    };
  }
}

// Singleton
export const walkForwardValidator = new WalkForwardValidator();
