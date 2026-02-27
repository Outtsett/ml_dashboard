/**
 * Unified app config: merges .env + config/*.json into a single Zod-validated object.
 * Used as the NestJS ConfigModule load factory.
 */
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// ── JSON config sub-schemas ──

const HyperparamSchema = z.object({
  value: z.number(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
  label: z.string(),
});

const ModelSchema = z.object({
  name: z.string(),
  category: z.string(),
  subcategory: z.string(),
  runner: z.string(),
  script: z.string(),
  outputs: z.array(z.string()),
  chartOverlay: z.string().optional(),
  outputDir: z.string(),
  defaultHyperparameters: z.record(HyperparamSchema),
});

const ModelsConfigSchema = z.object({
  version: z.number(),
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
  pipelines: z.record(FeaturePipelineSchema),
  featureSets: z.record(FeatureSetSchema),
});

const TrainingConfigSchema = z.object({
  paths: z.object({
    pythonExe: z.string(),
    modelsDir: z.string(),
    indicatorsDir: z.string(),
    marketDb: z.string(),
  }),
  limits: z.object({
    maxConcurrentJobs: z.number(),
    maxBarsDefault: z.number(),
    maxTrainingDurationSec: z.number(),
    jobRetentionSec: z.number(),
  }),
  timeframes: z.record(z.number()),
  timeframeAliases: z.record(z.string()),
});

// ── Full merged config schema ──

export const AppConfigSchema = z.object({
  port: z.number().default(5000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  databaseUrl: z.string().default('postgresql://postgres:postgres@localhost:5432/ml_dashboard'),

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
    databaseUrl: process.env.DATABASE_URL,
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
