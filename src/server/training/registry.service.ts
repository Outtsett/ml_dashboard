import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HyperparameterDef } from '@shared/trainingTypes';
import {
  getModelConfig,
  listModels,
  getFeaturePipeline,
  listFeaturePipelines,
  getFeatureSet,
  listFeatureSets,
  getTrainingConfig,
  getClientConfig,
  timeframeToSeconds,
  minutesToTimeframeLabel,
  resolveHyperparameters,
  reloadConfigs,
} from './registry';

@Injectable()
export class RegistryService {
  constructor(@Inject(ConfigService) private config: ConfigService) {}

  getModel(modelType: string) {
    return getModelConfig(modelType);
  }

  listModels() {
    return listModels();
  }

  getFeaturePipeline(pipelineId: string) {
    return getFeaturePipeline(pipelineId);
  }

  listFeaturePipelines() {
    return listFeaturePipelines();
  }

  getFeatureSet(setId: string) {
    return getFeatureSet(setId);
  }

  listFeatureSets() {
    return listFeatureSets();
  }

  getTrainingConfig() {
    return getTrainingConfig();
  }

  getClientConfig() {
    return getClientConfig();
  }

  timeframeToSeconds(tf: string) {
    return timeframeToSeconds(tf);
  }

  minutesToTimeframeLabel(minutes: number) {
    return minutesToTimeframeLabel(minutes);
  }

  resolveHyperparameters(
    defaults: Record<string, HyperparameterDef>,
    overrides?: Record<string, number | string | boolean>,
  ) {
    return resolveHyperparameters(defaults, overrides);
  }

  reload() {
    return reloadConfigs();
  }
}
