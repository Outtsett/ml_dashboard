import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Configure Swagger/OpenAPI for the NestJS application.
 *
 * Call this from main.ts once the app transitions from createApplicationContext()
 * to NestFactory.create() (i.e., when NestJS handles HTTP directly).
 *
 * Until then, a static OpenAPI spec is served at GET /api/docs/json.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('ML Dashboard API')
    .setDescription('Quantitative trading research platform — OHLCV, indicators, training, XAI')
    .setVersion('1.0')
    .addTag('charts', 'OHLCV candles via QuestDB SAMPLE BY')
    .addTag('indicators', 'Pre-computed (344 pandas-ta) + realtime (13 core) indicators')
    .addTag('training', 'Universal model training — start, stop, SSE stream')
    .addTag('labels', 'SQL-first label generation (15+ generators)')
    .addTag('xai', 'Explainable AI — 9 methods (SHAP, LIME, GradCAM, ...)')
    .addTag('databases', 'Health, stats, QuestDB process control')
    .addTag('instruments', 'Instrument metadata')
    .addTag('upload', 'File upload + multi-DB ingestion')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}

/**
 * Static OpenAPI spec for the current Express-based API.
 * Served at GET /api/docs/json while routes are still Express routers.
 */
export function getStaticOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'ML Dashboard API',
      description: 'Quantitative trading research platform',
      version: '1.0.0',
    },
    paths: {
      '/api/health': {
        get: { summary: 'Health check', tags: ['databases'], responses: { '200': { description: 'OK' } } },
      },
      '/api/charts/symbols': {
        get: { summary: 'List available symbols', tags: ['charts'], responses: { '200': { description: 'Symbol list' } } },
      },
      '/api/charts/ohlcv/{symbol}': {
        get: { summary: 'OHLCV candles', tags: ['charts'], parameters: [{ name: 'symbol', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OHLCV data' } } },
      },
      '/api/training/config': {
        get: { summary: 'Model registry + feature pipelines', tags: ['training'], responses: { '200': { description: 'Training config' } } },
      },
      '/api/training/start': {
        post: { summary: 'Start training job', tags: ['training'], responses: { '202': { description: 'Training started' } } },
      },
      '/api/training/stream/{modelId}': {
        get: { summary: 'SSE training event stream', tags: ['training'], parameters: [{ name: 'modelId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Event stream' } } },
      },
      '/api/training/status': {
        get: { summary: 'List active training sessions', tags: ['training'], responses: { '200': { description: 'Session list' } } },
      },
      '/api/ml/labels/generate': {
        post: { summary: 'Generate labels for a symbol', tags: ['labels'], responses: { '200': { description: 'Label generation result' } } },
      },
      '/api/ml/xai/methods': {
        get: { summary: 'List XAI methods', tags: ['xai'], responses: { '200': { description: 'Method list' } } },
      },
      '/api/instruments': {
        get: { summary: 'List instruments', tags: ['instruments'], responses: { '200': { description: 'Instrument list' } } },
      },
    },
  };
}
