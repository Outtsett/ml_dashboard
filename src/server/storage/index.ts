/**
 * Storage — Barrel
 *
 * Re-exports the IStorage interface, the DatabaseStorage class,
 * and the singleton `storage` instance.
 */

import type { IStorage } from './types';
import * as core from './core';
import * as modelStorage from './modelStorage';
import * as tradeStorage from './tradeStorage';
import * as regimeStorage from './regimeStorage';
import * as backtesting from './backtesting';

export { getAssetType } from './types';
export type { IStorage } from './types';

class DatabaseStorage implements IStorage {
  // Core
  getUser = core.getUser;
  getUserByUsername = core.getUserByUsername;
  createUser = core.createUser;
  createUpload = core.createUpload;
  updateUploadStatus = core.updateUploadStatus;
  getUploads = core.getUploads;
  saveFeatureImportance = core.saveFeatureImportance;
  getFeatureImportance = core.getFeatureImportance;
  createTrainingSession = core.createTrainingSession;
  updateTrainingSession = core.updateTrainingSession;
  getActiveTrainingSession = core.getActiveTrainingSession;
  getTrainingSession = core.getTrainingSession;
  addLossHistory = core.addLossHistory;
  getLossHistory = core.getLossHistory;
  getInstrument = core.getInstrument;
  getAllInstruments = core.getAllInstruments;
  getInstrumentsByType = core.getInstrumentsByType;
  createNewsArticle = core.createNewsArticle;
  getNewsArticles = core.getNewsArticles;
  getNewsArticleById = core.getNewsArticleById;
  getNewsArticleByExternalId = core.getNewsArticleByExternalId;
  updateNewsSentiment = core.updateNewsSentiment;
  getNewsBySymbol = core.getNewsBySymbol;
  linkNewsToSymbols = core.linkNewsToSymbols;

  // ML Models, Features, Outputs, Coherence, Ensembles
  createMlModel = modelStorage.createMlModel;
  getMlModels = modelStorage.getMlModels;
  getMlModel = modelStorage.getMlModel;
  updateMlModel = modelStorage.updateMlModel;
  createFeatureSet = modelStorage.createFeatureSet;
  getFeatureSets = modelStorage.getFeatureSets;
  saveModelOutput = modelStorage.saveModelOutput;
  saveModelOutputBatch = modelStorage.saveModelOutputBatch;
  getModelOutputs = modelStorage.getModelOutputs;
  getModelCoherence = modelStorage.getModelCoherence;
  saveCoherenceSnapshot = modelStorage.saveCoherenceSnapshot;
  createEnsembleConfig = modelStorage.createEnsembleConfig;
  getEnsembleConfigs = modelStorage.getEnsembleConfigs;
  simulateEnsemble = modelStorage.simulateEnsemble;

  // Trades
  createTrade = tradeStorage.createTrade;
  getTrades = tradeStorage.getTrades;
  closeTrade = tradeStorage.closeTrade;

  // Market Regimes
  createMarketRegime = regimeStorage.createMarketRegime;
  getMarketRegimes = regimeStorage.getMarketRegimes;
  recordRegimeHistory = regimeStorage.recordRegimeHistory;

  // Backtesting
  getBrokerConfigs = backtesting.getBrokerConfigs;
  getBrokerConfig = backtesting.getBrokerConfig;
  getBrokerConfigByName = backtesting.getBrokerConfigByName;
  getDefaultBrokerConfig = backtesting.getDefaultBrokerConfig;
  createBacktestRun = backtesting.createBacktestRun;
  updateBacktestRun = backtesting.updateBacktestRun;
  getBacktestRuns = backtesting.getBacktestRuns;
  getBacktestRun = backtesting.getBacktestRun;
  insertBacktestTrades = backtesting.insertBacktestTrades;
  getBacktestTrades = backtesting.getBacktestTrades;
}

export const storage = new DatabaseStorage();
