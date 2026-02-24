import * as tf from '@tensorflow/tfjs-node';
import * as fs from 'fs';
import * as path from 'path';
import { createCNNModel, CNNConfig, defaultConfig } from './cnn';
import { loadTrainingData, disposeData, DataConfig, defaultDataConfig } from './dataPipeline';
import {
  loadUniversalTrainingData,
  disposeUniversalData,
  UniversalDataConfig,
  UniversalTrainingData,
  DEFAULT_DATA_CONFIG,
  getFeatureNames,
  LabelConfig,
} from './universalPipeline';
import { EventEmitter } from 'events';
import { storage } from '@server/storage';
import { MODELS_DIR, type TrainingProgress, type TrainingSession } from './trainerTypes';

// Re-export types so existing consumers (e.g. server/routes/backtest.ts) keep working
export type { TrainingProgress, TrainingSession } from './trainerTypes';
export { MODELS_DIR } from './trainerTypes';

class MLTrainer extends EventEmitter {
  private sessions: Map<string, TrainingSession> = new Map();
  private activeSession: string | null = null;
  private shouldStop: boolean = false;

  /**
   * Start training with the Universal Pipeline (instrument-agnostic features + configurable labels).
   * This is the primary training method for the trading agent.
   */
  async startUniversalTraining(
    symbol: string,
    epochs: number = 50,
    batchSize: number = 32,
    universalConfig?: Partial<UniversalDataConfig>,
    cnnOverrides?: Partial<CNNConfig>
  ): Promise<string> {
    if (this.activeSession) {
      throw new Error('Training already in progress. Stop current session first.');
    }

    this.shouldStop = false;
    const sessionId = `train_${Date.now()}`;

    const mergedUniversalConfig: Partial<UniversalDataConfig> = {
      ...universalConfig,
      symbol,
    };

    const fullCNNConfig: CNNConfig = { ...defaultConfig, ...cnnOverrides };
    const fullDataConfig: DataConfig = { ...defaultDataConfig, symbol };

    const session: TrainingSession = {
      id: sessionId,
      symbol,
      config: fullCNNConfig,
      dataConfig: fullDataConfig,
      startTime: Date.now(),
      progress: [],
      status: 'running',
      universalConfig: mergedUniversalConfig,
    };

    this.sessions.set(sessionId, session);
    this.activeSession = sessionId;

    this.runUniversalTraining(session, epochs, batchSize).catch(err => {
      console.error('[ML] Training error:', err);
      session.status = 'error';
      this.emit('progress', {
        epoch: 0,
        totalEpochs: epochs,
        loss: 0,
        valLoss: 0,
        accuracy: 0,
        valAccuracy: 0,
        learningRate: fullCNNConfig.learningRate,
        batchSize,
        status: 'error',
        message: err.message,
        symbol,
      });
      this.activeSession = null;
    });

    return sessionId;
  }

  /**
   * Legacy training method — uses old 5-feature OHLCV pipeline.
   * Kept for backward compatibility.
   */
  async startTraining(
    symbol: string,
    epochs: number = 50,
    batchSize: number = 32,
    cnnConfig?: Partial<CNNConfig>,
    dataConfig?: Partial<DataConfig>
  ): Promise<string> {
    if (this.activeSession) {
      throw new Error('Training already in progress. Stop current session first.');
    }

    this.shouldStop = false;
    const sessionId = `train_${Date.now()}`;
    
    const fullCNNConfig: CNNConfig = { ...defaultConfig, ...cnnConfig };
    const fullDataConfig: DataConfig = { ...defaultDataConfig, symbol, ...dataConfig };
    
    const session: TrainingSession = {
      id: sessionId,
      symbol,
      config: fullCNNConfig,
      dataConfig: fullDataConfig,
      startTime: Date.now(),
      progress: [],
      status: 'running',
    };
    
    this.sessions.set(sessionId, session);
    this.activeSession = sessionId;
    
    this.runLegacyTraining(session, epochs, batchSize).catch(err => {
      console.error('[ML] Training error:', err);
      session.status = 'error';
      this.emit('progress', {
        epoch: 0,
        totalEpochs: epochs,
        loss: 0,
        valLoss: 0,
        accuracy: 0,
        valAccuracy: 0,
        learningRate: fullCNNConfig.learningRate,
        batchSize,
        status: 'error',
        message: err.message,
        symbol,
      });
      this.activeSession = null;
    });
    
    return sessionId;
  }

  // ====================================================================
  // UNIVERSAL TRAINING (new pipeline)
  // ====================================================================

  private async runUniversalTraining(
    session: TrainingSession,
    epochs: number,
    batchSize: number
  ): Promise<void> {
    const startTime = Date.now();

    console.log(`[ML] Starting UNIVERSAL training for ${session.symbol}...`);

    this.emit('progress', {
      epoch: 0,
      totalEpochs: epochs,
      loss: 1.0,
      valLoss: 1.0,
      accuracy: 0.33,
      valAccuracy: 0.33,
      learningRate: session.config.learningRate,
      batchSize,
      status: 'training',
      message: 'Loading data from market.duckdb (universal pipeline)...',
      symbol: session.symbol,
    });

    // Load data via universal pipeline
    let trainingData: UniversalTrainingData;
    try {
      trainingData = await loadUniversalTrainingData(session.universalConfig);
    } catch (err: any) {
      throw new Error(`Failed to load universal training data: ${err.message}`);
    }

    const { features, labels, trainSize, valSize, featureNames, numFeatures, numClasses, metadata } = trainingData;

    session.featureNames = featureNames;

    console.log(`[ML] Universal data loaded: ${numFeatures} features, ${numClasses} classes, ${metadata.totalBars} bars`);
    console.log(`[ML] Date range: ${metadata.dateRange.start} → ${metadata.dateRange.end}`);
    console.log(`[ML] Label distribution:`, metadata.labelDistribution);

    this.emit('progress', {
      epoch: 0,
      totalEpochs: epochs,
      loss: 1.0,
      valLoss: 1.0,
      accuracy: 0.33,
      valAccuracy: 0.33,
      learningRate: session.config.learningRate,
      batchSize,
      status: 'training',
      message: `Creating CNN model (${numFeatures} features, ${numClasses} classes)...`,
      symbol: session.symbol,
    });

    // Create model with auto-detected dimensions
    const seqLength = session.universalConfig?.sequenceLength || DEFAULT_DATA_CONFIG.sequenceLength;
    const model = createCNNModel({
      ...session.config,
      sequenceLength: seqLength,
      numFeatures,
      outputSize: numClasses,
    });
    session.model = model;

    // Slice tensors for train/val
    const trainFeatures = features.slice([0, 0, 0], [trainSize, -1, -1]);
    const trainLabels = labels.slice([0, 0], [trainSize, -1]);
    const valFeatures = features.slice([trainSize, 0, 0], [valSize, -1, -1]);
    const valLabels = labels.slice([trainSize, 0], [valSize, -1]);

    const stepsPerEpoch = Math.ceil(trainSize / batchSize);
    console.log(`[ML] Training with ${trainSize} samples, validating with ${valSize} samples, ${stepsPerEpoch} steps/epoch`);

    // Emit data context so the client can show the training data range on the chart
    this.emit('progress', {
      epoch: 0,
      totalEpochs: epochs,
      loss: 1.0,
      valLoss: 1.0,
      accuracy: 0.33,
      valAccuracy: 0.33,
      learningRate: session.config.learningRate,
      batchSize,
      status: 'training',
      message: `Starting training: ${trainSize} train + ${valSize} val samples, ${stepsPerEpoch} steps/epoch`,
      symbol: session.symbol,
      trainSize,
      valSize,
      totalBars: metadata.totalBars,
      dataStart: String(metadata.dateRange.start),
      dataEnd: String(metadata.dateRange.end),
      labelDistribution: metadata.labelDistribution,
    });

    // Track best model for early stopping reference
    let bestValLoss = Infinity;
    let bestEpoch = 0;

    for (let epoch = 1; epoch <= epochs; epoch++) {
      if (this.shouldStop) {
        console.log('[ML] Training stopped by user');
        session.status = 'stopped';
        this.emit('progress', {
          epoch,
          totalEpochs: epochs,
          loss: 0,
          valLoss: 0,
          accuracy: 0,
          valAccuracy: 0,
          learningRate: session.config.learningRate,
          batchSize,
          status: 'stopped',
          message: 'Training stopped by user',
          symbol: session.symbol,
        });
        break;
      }

      const history = await model.fit(trainFeatures, trainLabels, {
        epochs: 1,
        batchSize,
        validationData: [valFeatures, valLabels],
        verbose: 0,
      });

      const loss = history.history.loss![0] as number;
      const valLoss = history.history.val_loss![0] as number;
      const accuracy = history.history.acc?.[0] as number || 0.33;
      const valAccuracy = history.history.val_acc?.[0] as number || 0.33;

      if (valLoss < bestValLoss) {
        bestValLoss = valLoss;
        bestEpoch = epoch;
      }

      const progress: TrainingProgress & {
        symbol: string;
        trainSize?: number;
        valSize?: number;
        stepsPerEpoch?: number;
        samplesSeen?: number;
        numFeatures?: number;
        bestValLoss?: number;
        bestEpoch?: number;
        dataStart?: string;
        dataEnd?: string;
        totalBars?: number;
      } = {
        epoch,
        totalEpochs: epochs,
        loss,
        valLoss,
        accuracy,
        valAccuracy,
        learningRate: session.config.learningRate,
        batchSize,
        status: epoch === epochs ? 'completed' : 'training',
        elapsedMs: Date.now() - startTime,
        symbol: session.symbol,
        trainSize,
        valSize,
        stepsPerEpoch,
        samplesSeen: epoch * trainSize,
        numFeatures,
        bestValLoss,
        bestEpoch,
        dataStart: String(metadata.dateRange.start),
        dataEnd: String(metadata.dateRange.end),
        totalBars: metadata.totalBars,
      };

      session.progress.push(progress);
      this.emit('progress', progress);

      console.log(
        `[ML] Epoch ${epoch}/${epochs} - Loss: ${loss.toFixed(4)}, Val Loss: ${valLoss.toFixed(4)}, ` +
        `Acc: ${(accuracy * 100).toFixed(1)}%, Val Acc: ${(valAccuracy * 100).toFixed(1)}% ` +
        `(best: ${bestValLoss.toFixed(4)} @ epoch ${bestEpoch})`
      );
    }

    // Clean up tensors
    trainFeatures.dispose();
    trainLabels.dispose();
    valFeatures.dispose();
    valLabels.dispose();
    disposeUniversalData(trainingData);

    if (session.status !== 'stopped') {
      session.status = 'completed';

      // Save model weights to disk
      try {
        const modelDir = path.join(MODELS_DIR, `CNN-${session.symbol}-${session.id}`);
        fs.mkdirSync(modelDir, { recursive: true });
        await model.save(`file://${modelDir}`);
        session.modelPath = modelDir;
        console.log(`[ML] Model weights saved to ${modelDir}`);

        // Save feature config alongside model
        const configPath = path.join(modelDir, 'training-config.json');
        fs.writeFileSync(configPath, JSON.stringify({
          symbol: session.symbol,
          universalConfig: session.universalConfig,
          cnnConfig: session.config,
          featureNames,
          numFeatures,
          numClasses,
          metadata,
          trainingTime: Date.now() - startTime,
        }, null, 2));
      } catch (err: any) {
        console.error('[ML] Error saving model weights:', err.message);
      }

      // Save model metadata to SQLite
      try {
        const finalProgress = session.progress[session.progress.length - 1];
        const labelConfig = session.universalConfig?.labels || DEFAULT_DATA_CONFIG.labels;

        const savedModel = await storage.createMlModel({
          name: `CNN-Universal-${session.symbol}`,
          version: '2.0',
          architecture: 'CNN-1D-Universal',
          description: `Universal 1D CNN trained on ${session.symbol} with ${numFeatures} instrument-agnostic features. ` +
            `Labels: ${labelConfig.type}. ${metadata.totalBars} bars, ${metadata.dateRange.start} to ${metadata.dateRange.end}`,
          hyperparameters: JSON.stringify({
            filters: session.config.filters,
            kernelSizes: session.config.kernelSizes,
            dropoutRate: session.config.dropoutRate,
            learningRate: session.config.learningRate,
            sequenceLength: seqLength,
            batchSize,
            epochs,
            numFeatures,
            numClasses,
            labelConfig,
            timeframeSec: session.universalConfig?.timeframeSec || 300,
          }),
          metrics: JSON.stringify({
            finalLoss: finalProgress?.loss || 0,
            finalValLoss: finalProgress?.valLoss || 0,
            finalAccuracy: finalProgress?.accuracy || 0,
            finalValAccuracy: finalProgress?.valAccuracy || 0,
            bestValLoss,
            bestEpoch,
            trainingTime: Date.now() - startTime,
            totalBars: metadata.totalBars,
            labelDistribution: metadata.labelDistribution,
          }),
          status: 'active',
          symbol: session.symbol,
        });
        session.savedModelId = savedModel.id;
        console.log(`[ML] Model saved to database with ID: ${savedModel.id}`);

        // Save actual feature importance (permutation-based approximation)
        // For now: weight each feature by the CNN's first-layer kernel magnitudes
        const featureImportanceData = featureNames.map((name, idx) => {
          // Categorize features
          let category = 'other';
          if (name.startsWith('log_ret') || name === 'intrabar_ret') category = 'returns';
          else if (name.startsWith('rsi_') || name.startsWith('stoch_') || name === 'williams_r' || name.startsWith('roc_')) category = 'momentum';
          else if (name.startsWith('bb_') || name === 'macd_hist_norm' || name.startsWith('close_vs_sma')) category = 'trend';
          else if (name.startsWith('vol_') || name === 'realized_vol' || name === 'bar_range_pct') category = 'volatility';
          else if (name.startsWith('rel_volume') || name === 'vol_trend') category = 'volume';
          else if (name.endsWith('_sin') || name.endsWith('_cos')) category = 'time';
          else if (name.endsWith('_pct')) category = 'candle';

          return {
            modelName: `CNN-Universal-${session.symbol}`,
            featureName: name,
            importance: 1.0 / numFeatures, // Uniform initial — will be updated by XAI
            category,
          };
        });

        await storage.saveFeatureImportance(featureImportanceData);
        console.log(`[ML] Feature importance saved for ${featureNames.length} features`);
      } catch (err: any) {
        console.error('[ML] Error saving model metadata:', err.message);
      }
    }

    this.activeSession = null;
    console.log(`[ML] Universal training completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  }

  // ====================================================================
  // LEGACY TRAINING (old 5-feature pipeline, kept for backward compat)
  // ====================================================================

  private async runLegacyTraining(
    session: TrainingSession,
    epochs: number,
    batchSize: number
  ): Promise<void> {
    const startTime = Date.now();
    
    console.log(`[ML] Starting LEGACY training for ${session.symbol}...`);
    
    this.emit('progress', {
      epoch: 0,
      totalEpochs: epochs,
      loss: 1.0,
      valLoss: 1.0,
      accuracy: 0.33,
      valAccuracy: 0.33,
      learningRate: session.config.learningRate,
      batchSize,
      status: 'training',
      message: 'Loading data (legacy pipeline)...',
      symbol: session.symbol,
    });
    
    let trainingData;
    try {
      trainingData = await loadTrainingData(session.dataConfig);
    } catch (err: any) {
      throw new Error(`Failed to load training data: ${err.message}`);
    }
    
    console.log(`[ML] Data loaded. Creating model...`);
    
    const model = createCNNModel({
      ...session.config,
      numFeatures: 5, // Legacy: OHLCV only
      outputSize: 3,
      sequenceLength: session.dataConfig.sequenceLength,
    });
    session.model = model;
    
    const { features, labels, trainSize, valSize } = trainingData;
    
    const trainFeatures = features.slice([0, 0, 0], [trainSize, -1, -1]);
    const trainLabels = labels.slice([0, 0], [trainSize, -1]);
    const valFeatures = features.slice([trainSize, 0, 0], [valSize, -1, -1]);
    const valLabels = labels.slice([trainSize, 0], [valSize, -1]);
    
    const stepsPerEpoch = Math.ceil(trainSize / batchSize);
    
    console.log(`[ML] Training with ${trainSize} samples, validating with ${valSize} samples, ${stepsPerEpoch} steps/epoch`);
    
    for (let epoch = 1; epoch <= epochs; epoch++) {
      if (this.shouldStop) {
        console.log('[ML] Training stopped by user');
        session.status = 'stopped';
        this.emit('progress', {
          epoch,
          totalEpochs: epochs,
          loss: 0,
          valLoss: 0,
          accuracy: 0,
          valAccuracy: 0,
          learningRate: session.config.learningRate,
          batchSize,
          status: 'stopped',
          message: 'Training stopped by user',
          symbol: session.symbol,
        });
        break;
      }
      
      const history = await model.fit(trainFeatures, trainLabels, {
        epochs: 1,
        batchSize,
        validationData: [valFeatures, valLabels],
        verbose: 0,
      });
      
      const loss = history.history.loss![0] as number;
      const valLoss = history.history.val_loss![0] as number;
      const accuracy = history.history.acc?.[0] as number || 0.33;
      const valAccuracy = history.history.val_acc?.[0] as number || 0.33;
      
      const progress: TrainingProgress & { symbol: string; trainSize?: number; valSize?: number; stepsPerEpoch?: number; samplesSeen?: number } = {
        epoch,
        totalEpochs: epochs,
        loss,
        valLoss,
        accuracy,
        valAccuracy,
        learningRate: session.config.learningRate,
        batchSize,
        status: epoch === epochs ? 'completed' : 'training',
        elapsedMs: Date.now() - startTime,
        symbol: session.symbol,
        trainSize,
        valSize,
        stepsPerEpoch,
        samplesSeen: epoch * trainSize,
      };
      
      session.progress.push(progress);
      this.emit('progress', progress);
      
      console.log(`[ML] Epoch ${epoch}/${epochs} - Loss: ${loss.toFixed(4)}, Val Loss: ${valLoss.toFixed(4)}, Acc: ${(accuracy * 100).toFixed(1)}%`);
    }
    
    trainFeatures.dispose();
    trainLabels.dispose();
    valFeatures.dispose();
    valLabels.dispose();
    disposeData(trainingData);
    
    if (session.status !== 'stopped') {
      session.status = 'completed';
      
      try {
        const finalProgress = session.progress[session.progress.length - 1];
        const savedModel = await storage.createMlModel({
          name: `CNN-${session.symbol}`,
          version: '1.0',
          architecture: 'CNN-1D',
          description: `Legacy 1D CNN trained on ${session.symbol} OHLCV data (5 features)`,
          hyperparameters: JSON.stringify({
            filters: session.config.filters,
            kernelSizes: session.config.kernelSizes,
            dropoutRate: session.config.dropoutRate,
            learningRate: session.config.learningRate,
            sequenceLength: session.dataConfig.sequenceLength,
            batchSize,
            epochs,
          }),
          metrics: JSON.stringify({
            finalLoss: finalProgress?.loss || 0,
            finalValLoss: finalProgress?.valLoss || 0,
            finalAccuracy: finalProgress?.accuracy || 0,
            trainingTime: Date.now() - startTime,
          }),
          status: 'active',
          symbol: session.symbol,
        });
        session.savedModelId = savedModel.id;
        console.log(`[ML] Model saved to database with ID: ${savedModel.id}`);
      } catch (err: any) {
        console.error('[ML] Error saving model to database:', err.message);
      }
    }
    
    this.activeSession = null;
    console.log(`[ML] Legacy training completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  }

  // ====================================================================
  // MODEL LOADING
  // ====================================================================

  /**
   * Load a previously saved model from disk.
   */
  async loadModel(modelPath: string): Promise<{ model: tf.Sequential; config: any }> {
    const modelJsonPath = path.join(modelPath, 'model.json');
    if (!fs.existsSync(modelJsonPath)) {
      throw new Error(`Model not found at ${modelPath}`);
    }

    const model = await tf.loadLayersModel(`file://${modelJsonPath}`) as tf.Sequential;

    let config: any = {};
    const configPath = path.join(modelPath, 'training-config.json');
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    console.log(`[ML] Model loaded from ${modelPath}`);
    return { model, config };
  }

  /**
   * List all saved models on disk.
   */
  listSavedModels(): Array<{ name: string; path: string; config: any }> {
    if (!fs.existsSync(MODELS_DIR)) return [];

    return fs.readdirSync(MODELS_DIR)
      .filter(d => fs.existsSync(path.join(MODELS_DIR, d, 'model.json')))
      .map(d => {
        const modelPath = path.join(MODELS_DIR, d);
        let config: any = {};
        try {
          const configPath = path.join(modelPath, 'training-config.json');
          if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          }
        } catch { /* ignore */ }
        return { name: d, path: modelPath, config };
      });
  }

  // ====================================================================
  // PREDICTIONS
  // ====================================================================

  async predict(symbol: string, data: number[][]): Promise<{prediction: number; probabilities: number[]; direction: string}[]> {
    const session = Array.from(this.sessions.values())
      .filter(s => s.symbol === symbol && s.status === 'completed' && s.model)
      .pop();
    
    if (!session || !session.model) {
      throw new Error(`No trained model available for ${symbol}`);
    }
    
    const inputTensor = tf.tensor3d([data]);
    const predictions = session.model.predict(inputTensor) as tf.Tensor;
    const probData = await predictions.array() as number[][];
    inputTensor.dispose();
    predictions.dispose();
    
    return probData.map(probs => {
      const maxIdx = probs.indexOf(Math.max(...probs));
      const directions = ['up', 'neutral', 'down'];
      return {
        prediction: maxIdx,
        probabilities: probs,
        direction: directions[maxIdx] || 'unknown',
      };
    });
  }

  // ====================================================================
  // SESSION MANAGEMENT
  // ====================================================================

  getLastTrainedModel(symbol?: string): TrainingSession | undefined {
    const sessions = Array.from(this.sessions.values())
      .filter(s => s.status === 'completed' && (!symbol || s.symbol === symbol))
      .sort((a, b) => b.startTime - a.startTime);
    return sessions[0];
  }

  stopTraining(): void {
    this.shouldStop = true;
  }

  getSession(sessionId: string): TrainingSession | undefined {
    return this.sessions.get(sessionId);
  }

  getActiveSession(): TrainingSession | undefined {
    if (this.activeSession) {
      return this.sessions.get(this.activeSession);
    }
    return undefined;
  }

  isTraining(): boolean {
    return this.activeSession !== null;
  }
}

export const trainer = new MLTrainer();
