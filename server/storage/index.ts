/**
 * Storage — Barrel
 *
 * Re-exports the IStorage interface, the DatabaseStorage class,
 * and the singleton `storage` instance.
 */

import type { IStorage } from './types';
import * as core from './core';
import * as observatory from './observatory';
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

  // Observatory
  createMlModel = observatory.createMlModel;
  getMlModels = observatory.getMlModels;
  getMlModel = observatory.getMlModel;
  updateMlModel = observatory.updateMlModel;
  createFeatureSet = observatory.createFeatureSet;
  getFeatureSets = observatory.getFeatureSets;
  saveModelOutput = observatory.saveModelOutput;
  saveModelOutputBatch = observatory.saveModelOutputBatch;
  getModelOutputs = observatory.getModelOutputs;
  getModelCoherence = observatory.getModelCoherence;
  saveCoherenceSnapshot = observatory.saveCoherenceSnapshot;
  createEnsembleConfig = observatory.createEnsembleConfig;
  getEnsembleConfigs = observatory.getEnsembleConfigs;
  simulateEnsemble = observatory.simulateEnsemble;
  createTrade = observatory.createTrade;
  getTrades = observatory.getTrades;
  closeTrade = observatory.closeTrade;
  createMarketRegime = observatory.createMarketRegime;
  getMarketRegimes = observatory.getMarketRegimes;
  recordRegimeHistory = observatory.recordRegimeHistory;

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
