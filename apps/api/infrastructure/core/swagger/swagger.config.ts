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
    .addTag('charts', 'OHLCV candles via lake SAMPLE BY')
    .addTag('indicators', 'Pre-computed (344 pandas-ta) + realtime (13 core) indicators')
    .addTag('training', 'Universal model training — start, stop, SSE stream')
    .addTag('labels', 'SQL-first label generation (15+ generators)')
    .addTag('xai', 'Explainable AI — 9 methods (SHAP, LIME, GradCAM, ...)')
    .addTag('databases', 'Health, stats, lake process control')
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
      // The three probes are deliberately different questions, and a consumer
      // that cannot tell them apart will wire the wrong one into a supervisor.
      '/health': {
        get: {
          summary: 'Liveness — is the process alive',
          description: 'Always 200 while the process runs. Says nothing about the stores; do not gate traffic on it.',
          tags: ['databases'],
          responses: { '200': { description: 'Process alive, with uptime and memory' } },
        },
      },
      '/api/readiness': {
        get: {
          summary: 'Readiness — is it safe to send traffic',
          description: 'Bootstrapping or a store that is not healthy returns 503 with the startup report attached.',
          tags: ['databases'],
          responses: {
            '200': { description: 'Ready: bootstrap finished and every store healthy' },
            '503': { description: 'Still bootstrapping, or a store is unhealthy' },
          },
        },
      },
      '/api/health': {
        get: { summary: 'Per-store health detail', tags: ['databases'], responses: { '200': { description: 'OK' } } },
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

