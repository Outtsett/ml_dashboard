import 'dotenv/config';
import 'reflect-metadata';
import express, { type Request, Response, NextFunction } from 'express';
import cors from 'cors';
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
import { db } from './database/db';
import { setNestApp } from './nest-context';
import { shutdownAllPtySessions } from './lib/ptyServer';

// Re-export for backward compat
export { log } from './lib/log';
export { getNestApp } from './nest-context';

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

async function bootstrap() {
  const expressApp = express();
  const httpServer = createServer(expressApp);

  // ── Express middleware (preserved from index.ts) ──

  // CORS — restrict to localhost origins only (prevents CSRF from malicious websites)
  const allowedOrigins = [
    'http://127.0.0.1:5000',
    'http://localhost:5000',
    ...(process.env.NODE_ENV === 'development' ? ['http://host.docker.internal:5000'] : []),
  ];
  expressApp.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, curl, Electron)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: false,
  }));

  expressApp.use(
    express.json({
      limit: '1mb',
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

  // ── Start QuestDB process if not running (timeout so app can start without QuestDB) ──
  try {
    await Promise.race([
      runStartupSequence(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('QuestDB startup timeout')), 30_000)),
    ]);
  } catch (e: any) {
    console.warn('[startup] QuestDB unavailable — app will run with limited functionality:', e.message);
  }

  // ── NestJS DI container (initializes DB connections via lifecycle hooks) ──
  const nestApp = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  setNestApp(nestApp);
  const config = nestApp.get(ConfigService);
  log('NestJS initialized (databases ready)', 'nest');

  // ── Recover incomplete pipelines from prior crash ──
  try {
    const { recoverPipelinesOnStartup } = await import('./sagas/recovery');
    const { EventStore } = await import('./events/event-store');
    const recoveryStore = new EventStore(db);
    await recoverPipelinesOnStartup(recoveryStore);
  } catch (err) {
    console.error('[recovery] Failed to recover pipelines:', err);
  }

  // ── Register training runners (DIP — concrete classes registered here, not in orchestrator) ──
  const { registerRunner } = await import('./training/runnerFactory');
  const { PythonRunner } = await import('./training/runners/pythonRunner');
  registerRunner('python', new PythonRunner());
  log('Training runners registered: python', 'training');

  // ── Clean up orphaned training sessions (sessions that were "running" when server crashed) ──
  const { markOrphanedSessionsFailed } = await import('./storage/trainingStorage');
  const orphanCount = markOrphanedSessionsFailed();
  if (orphanCount > 0) {
    log(`Marked ${orphanCount} orphaned training session(s) as failed`, 'training');
  }

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

  // Error handler — sanitize error messages to avoid leaking internal paths/secrets
  expressApp.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    console.error('Internal Server Error:', err);
    if (res.headersSent) {
      return next(err);
    }
    // In production, strip internal details (file paths, SQL errors, connection strings)
    const message = status >= 500
      ? 'Internal Server Error'
      : (err.message || 'Request failed');
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
    shutdownAllPtySessions();
    try { await nestApp.close(); } catch {}
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
