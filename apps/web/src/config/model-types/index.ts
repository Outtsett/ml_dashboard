export interface ModelTypeConfig {
  id: string;
  label: string;
  mainTabs: string[];
  subTabs: string[];
  overviewCells: string[];
  primaryMetric: string;
}

const MODEL_TYPE_CONFIGS: Record<string, ModelTypeConfig> = {
};

// Fallback: minimal tabs — backwards compatible for unknown model types
const DEFAULT_CONFIG: ModelTypeConfig = {
  id: 'default',
  label: 'Unknown',
  mainTabs: ['overview', 'convergence'],
  subTabs: ['overview', 'convergence', 'log'],
  overviewCells: [],
  primaryMetric: '',
};

export function getModelTypeConfig(modelType: string | undefined): ModelTypeConfig {
  if (!modelType) return DEFAULT_CONFIG;
  return MODEL_TYPE_CONFIGS[modelType] ?? DEFAULT_CONFIG;
}
