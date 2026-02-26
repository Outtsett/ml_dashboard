import 'reflect-metadata';
import express, { type Request, Response, NextFunction } from 'express';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { INestApplicationContext } from '@nestjs/common';
import { createServer } from 'http';
import { AppModule } from './app.module';
import { registerRoutes } from './core/routes';
import { serveStatic } from './core/static';
import { runStartupSequence, getStartupReport } from './lib/startupManager';
import { getStaticOpenApiSpec } from './core/swagger/swagger.config';
import { log } from './lib/log';

// Re-export log for backward compat
export { log } from './lib/log';

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

/** NestJS application context — DI container + lifecycle, no HTTP handling. */
let appContext: INestApplicationContext | null = null;

/** Access the NestJS DI container from outside (bridge for non-NestJS code). */
export function getNestApp(): INestApplicationContext {
  if (!appContext) throw new Error('NestJS not initialized yet');
  return appContext;
}

async function bootstrap() {
  const expressApp = express();
  const httpServer = createServer(expressApp);

  // ── Express middleware (preserved from index.ts) ──
  expressApp.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  expressApp.use(express.urlencoded({ extended: false }));

  // Request logging
  expressApp.use((req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on('finish', () => {
      const duration = Date.now() - start;
      if (reqPath.startsWith('/api')) {
        let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          const isLargeDataResponse =
            Array.isArray(capturedJsonResponse) && capturedJsonResponse.length > 100;
          if (!isLargeDataResponse) {
            logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
          } else {
            logLine += ` :: [${capturedJsonResponse.length} records]`;
          }
        }
        log(logLine);
      }
    });

    next();
  });

  // ── Start QuestDB process if not running (must happen before NestJS DB services init) ──
  await runStartupSequence();

  // ── NestJS DI container (initializes DB connections + DuckDB via lifecycle hooks) ──
  appContext = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const config = appContext.get(ConfigService);
  log('NestJS initialized (databases ready)', 'nest');

  // ── Register training runners (DIP — concrete classes registered here, not in orchestrator) ──
  const { registerRunner } = await import('./training/runnerFactory');
  const { PythonRunner } = await import('./training/runners/pythonRunner');
  registerRunner('python', new PythonRunner());
  log('Training runners registered: python', 'training');

  // ── Routes + middleware ──
  await registerRoutes(httpServer, expressApp);

  // OpenAPI spec endpoint (static until NestJS handles HTTP directly)
  expressApp.get('/api/docs/json', (_req: Request, res: Response) => {
    res.json(getStaticOpenApiSpec());
  });

  // Startup report endpoint
  expressApp.get('/api/startup-report', (_req: Request, res: Response) => {
    const currentReport = getStartupReport();
    if (currentReport) {
      return res.json(currentReport);
    }
    return res.status(503).json({ error: 'Startup not yet complete' });
  });

  // Error handler
  expressApp.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    console.error('Internal Server Error:', err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });

  // ── Vite / Static ──
  if (config.get('nodeEnv') === 'production') {
    serveStatic(expressApp);
  } else {
    const { setupVite } = await import('./core/vite');
    await setupVite(httpServer, expressApp);
  }

  // ── Listen ──
  const port = config.get<number>('port') || 5000;
  httpServer.listen({ port, host: '127.0.0.1' }, () => {
    log(`serving on port ${port}`);
  });

  // ── Graceful shutdown ──
  const shutdown = async () => {
    log('Graceful shutdown initiated...', 'nest');
    if (appContext) {
      await appContext.close();
    }
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
