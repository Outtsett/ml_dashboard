/**
 * Unified app config: merges .env + config/*.json into a single Zod-validated object.
 * Used as the NestJS ConfigModule load factory.
 */
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// ── JSON config sub-schemas ──

const HyperparamSchema = z.object({
  type: z.enum(['int', 'float', 'bool']),
  default: z.union([z.number(), z.boolean()]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  label: z.string(),
  description: z.string().optional(),
  group: z.string().optional(),
  logScale: z.boolean().optional(),
  conditionalOn: z.object({ param: z.string(), value: z.unknown() }).optional(),
});

const ModelSchema = z.object({
  name: z.string(),
  category: z.string(),
  subcategory: z.string(),
  runner: z.string(),
  script: z.string(),
  featurePipeline: z.string().optional(),
  outputs: z.array(z.string()),
  chartOverlay: z.string().optional(),
  outputDir: z.string(),
  family: z.string().optional(),
  gpuRequired: z.boolean().optional(),
  estimatedTrainingTime: z.string().optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  supportedObjectives: z.array(z.string()).optional(),
  cliFlags: z.record(z.string()).optional(),
  defaultHyperparameters: z.record(HyperparamSchema),
  metricDeclarations: z.record(z.object({
    renderer: z.string(),
    mission: z.string(),
    context: z.record(z.unknown()),
    group: z.string().optional(),
    order: z.number().optional(),
  })).optional(),
});

const ModelsConfigSchema = z.object({
  version: z.union([z.number(), z.string()]),
  metadata: z.object({
    organization: z.string(),
    last_audit: z.string(),
  }).optional(),
  models: z.record(ModelSchema),
});

const FeaturePipelineSchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.string(),
});

const FeatureSetSchema = z.object({
  description: z.string(),
  columns: z.union([z.literal('*'), z.array(z.string())]),
});

const FeaturesConfigSchema = z.object({
  version: z.number().optional(),
  categories: z.record(z.object({ name: z.string(), description: z.string() })).optional(),
  features: z.array(z.object({
    name: z.string(),
    category: z.string(),
    type: z.string(),
    params: z.record(z.number()).optional(),
    requires: z.array(z.string()).optional(),
    description: z.string().optional(),
  })).optional(),
  normalization: z.object({
    method: z.string(),
    lookback: z.number(),
    clip: z.tuple([z.number(), z.number()]),
  }).optional(),
  pipelines: z.record(FeaturePipelineSchema),
  featureSets: z.record(FeatureSetSchema),
});

const TrainingConfigSchema = z.object({
  paths: z.object({
    pythonExe: z.string(),
    modelsDir: z.string(),
  }),
  limits: z.object({
    maxConcurrentJobs: z.number(),
    maxBarsDefault: z.number(),
    maxTrainingDurationSec: z.number(),
    jobRetentionSec: z.number(),
  }),
  stderrSuppressPatterns: z.array(z.string()).optional(),
  timeframes: z.record(z.number()),
  timeframeAliases: z.record(z.string()),
});

// ── Full merged config schema ──

export const AppConfigSchema = z.object({
  port: z.number().default(5000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  questdb: z.object({
    host: z.string().default('localhost'),
    httpPort: z.number().default(9000),
    ilpPort: z.number().default(9009),
    pgPort: z.number().default(8812),
  }),

  models: ModelsConfigSchema,
  features: FeaturesConfigSchema,
  training: TrainingConfigSchema,
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Load and validate all config sources (.env + JSON files) into a single typed object.
 * Called by NestJS ConfigModule as a load factory.
 */
export function loadAppConfig(): AppConfig {
  const configDir = path.resolve(process.cwd(), 'src', 'config');

  const modelsJson = JSON.parse(fs.readFileSync(path.join(configDir, 'models.json'), 'utf-8'));
  const featuresJson = JSON.parse(fs.readFileSync(path.join(configDir, 'features.json'), 'utf-8'));
  const trainingJson = JSON.parse(fs.readFileSync(path.join(configDir, 'training.json'), 'utf-8'));

  const raw = {
    port: parseInt(process.env.PORT || '5000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    questdb: {
      host: process.env.QUESTDB_HOST,
      httpPort: parseInt(process.env.QUESTDB_HTTP_PORT || '9000', 10),
      ilpPort: parseInt(process.env.QUESTDB_ILP_PORT || '9009', 10),
      pgPort: parseInt(process.env.QUESTDB_PG_PORT || '8812', 10),
    },
    models: modelsJson,
    features: featuresJson,
    training: trainingJson,
  };

  return AppConfigSchema.parse(raw);
}
