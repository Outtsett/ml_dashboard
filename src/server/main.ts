import 'dotenv/config';
import 'reflect-metadata';
import express, { type Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import crypto from 'crypto';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createServer } from 'http';
import { AppModule } from './app.module';
import { registerRoutes } from './infrastructure/core/routes';
import { serveStatic } from './infrastructure/core/static';
import { runStartupSequence, getStartupReport } from './infrastructure/lib/startupManager';
import { getStaticOpenApiSpec } from './infrastructure/core/swagger/swagger.config';
import { log } from './infrastructure/lib/log';
import { db } from './infrastructure/database/db';
import { setNestApp } from './infrastructure/lib/nest-context';
import { shutdownAllPtySessions } from './infrastructure/lib/ptyServer';
import { shutdownHardwareNode } from './system/telemetry.router';
import { warmSymbolsCatalog } from './infrastructure/cache/symbols';

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation id assigned per request, echoed in X-Request-ID and in logs. */
    requestId?: string;
  }
}
import { attachMetricsWebSocket } from './infrastructure/core/ws';

// Re-export for backward compat
export { log } from './infrastructure/lib/log';
export { getNestApp } from './infrastructure/lib/nest-context';

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

async function bootstrap() {
  // ── Global Process Resilience (Production-like stability in local dev) ──
  process.on('unhandledRejection', (reason, promise) => {
    const errorMsg = reason instanceof Error ? reason.stack : String(reason);
    log(`[UNHANDLED REJECTION] ${errorMsg}`, 'process');
    // In dev, we keep the process alive. In true production, we'd log and exit(1) after cleanup.
    if (process.env.NODE_ENV === 'production') {
       console.error('Unhandled Rejection at:', promise, 'reason:', reason);
       // process.exit(1); 
    }
  });

  process.on('uncaughtException', (err) => {
    log(`[UNCAUGHT EXCEPTION] ${err.stack || err.message}`, 'process');
    // In dev, we don't exit to allow for HMR/updates.
    if (process.env.NODE_ENV === 'production') {
      // process.exit(1); 
    }
  });

  const expressApp = express();
  expressApp.set('etag', 'weak'); // Enable weak ETags for conditional 304 responses
  const httpServer = createServer(expressApp);
  
  // Attach Metrics WebSocket Server
  attachMetricsWebSocket(httpServer);

  // ── Express middleware (preserved from index.ts) ──

  // CORS — restrict which origins may READ a response to localhost only.
  // This does NOT stop CSRF; the same-origin gate below is what does.
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

  /**
   * Same-origin gate for state-changing requests.
   *
   * CORS is routinely mistaken for CSRF protection and is not. A cross-site
   * POST whose Content-Type is text/plain, form-urlencoded or multipart is a
   * "simple request": the browser sends it with no preflight, and CORS only
   * withholds the RESPONSE from the caller. The side effect has already
   * happened by then.
   *
   * That is reachable here, because this server has no authentication by
   * design — it is a single-user dashboard on loopback, so there is no session
   * to steal, but there is also nothing between a request and the work it
   * starts. `POST /api/experiments/abort` takes no body at all, so any page the
   * user happens to visit could kill a running training job; `/experiments/
   * launch` falls back to its defaults on an empty body and would spawn a real
   * Python training process, once per request.
   *
   * So a mutating request is now checked on the way IN as well. Loopback is the
   * trust boundary the server already binds to, and it is tested by hostname
   * rather than against the CORS list, so the gate does not silently start
   * rejecting the app's own traffic if the port changes.
   *
   * A request with no Origin is allowed, matching the CORS callback above:
   * curl, the Electron shell and top-level navigations send none, and a
   * cross-site fetch cannot suppress it.
   */
  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', 'host.docker.internal']);
  const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  const isLoopbackOrigin = (origin: string): boolean => {
    try {
      return LOOPBACK_HOSTS.has(new URL(origin).hostname.replace(/^\[|\]$/g, ''));
    } catch {
      return false;
    }
  };

  expressApp.use((req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING_METHODS.has(req.method)) return next();

    const origin = req.headers.origin;
    if (origin && !isLoopbackOrigin(origin)) {
      return res.status(403).json({ error: 'Cross-site request blocked' });
    }

    // Sent by every current browser and not settable from script, so it also
    // catches a cross-site request that carries no Origin.
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ error: 'Cross-site request blocked' });
    }

    return next();
  });

  // ── Gzip compression (reduces OHLCV/chart responses ~80%) ──
  // Skip SSE streams (incompatible — compression buffers writes and breaks
  // the per-event flush contract) and /assets/ in production (pre-compressed
  // at build time). `/events/` covers W7.d deployments + W8 agents SSE,
  // `/stream/` covers legacy training SSE.
  expressApp.use(compression({
    threshold: 1024,
    filter: (req: Request) => {
      if (req.path.includes('/stream/') || req.path.includes('/events/')) return false;
      if (process.env.NODE_ENV === 'production' && req.path.startsWith('/assets/')) return false;
      return true;
    },
  }));

  // ── Request ID (unique per request, propagated in headers + logs) ──
  expressApp.use((req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers['x-request-id'] as string) || crypto.randomUUID().slice(0, 12);
    req.requestId = id;
    res.setHeader('X-Request-ID', id);
    next();
  });

  // ── Request timeout (30s default, prevents hung queries) ──
  expressApp.use((req: Request, res: Response, next: NextFunction) => {
    // SSE streams and training endpoints get longer timeout
    const isLongRunning = req.path.includes('/stream/') || req.path.includes('/training/start');
    const timeout = isLongRunning ? 0 : 30_000;
    if (timeout > 0) {
      req.setTimeout(timeout, () => {
        if (!res.headersSent) {
          res.status(408).json({ error: 'Request timeout', requestId: req.requestId });
        }
      });
    }
    next();
  });

  expressApp.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  expressApp.use(express.urlencoded({ extended: false }));

  // ── Security headers ──
  expressApp.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // ── Liveness probe (always 200 if process is alive) ──
  expressApp.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      timestamp: new Date().toISOString(),
    });
  });

  // ── Readiness probe (503 until startup complete + databases healthy) ──
  let serverReady = false;
  expressApp.get('/api/readiness', (_req: Request, res: Response) => {
    const report = getStartupReport();
    if (serverReady && report?.overallHealthy) {
      res.json({ ready: true, uptime: Math.round(process.uptime()), ...report });
    } else {
      res.status(503).json({
        ready: false,
        reason: !serverReady ? 'Server still bootstrapping' : 'Databases not healthy',
        report: report ?? null,
      });
    }
  });

  // ── Request logging (with request ID + concise output) ──
  expressApp.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const reqPath = req.path;
    const reqId = req.requestId || '-';
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

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
        // Log slow requests with warning
        if (duration > 5000) {
          log(`[SLOW ${reqId}] ${logLine}`);
        } else {
          log(logLine);
        }
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
  } catch (e) {
    console.warn('[startup] QuestDB unavailable — app will run with limited functionality:', (e as Error).message);
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
    const { recoverPipelinesOnStartup } = await import('./infrastructure/sagas/recovery');
    const { EventStore } = await import('./infrastructure/events/event-store');
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
  const { markOrphanedSessionsFailed } = await import('./infrastructure/storage/trainingStorage');
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

  // Error handler — standardized error envelope with request ID
  expressApp.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    // Anything can be thrown, so the two fields Express handlers conventionally
    // set are read off a narrowed view rather than assumed to be there.
    const thrown = (err ?? {}) as { status?: number; statusCode?: number; message?: string };
    const status = thrown.status || thrown.statusCode || 500;
    const requestId = req.requestId || '-';
    console.error(`[ERROR ${requestId}] ${req.method} ${req.path}:`, thrown.message || err);
    if (res.headersSent) {
      return next(err);
    }
    const message = status >= 500
      ? 'Internal Server Error'
      : (thrown.message || 'Request failed');
    return res.status(status).json({ error: message, requestId, status });
  });

  // ── Vite / Static ──
  if (config.get('nodeEnv') === 'production') {
    serveStatic(expressApp);
  } else {
    const { setupVite } = await import('./infrastructure/core/vite');
    await setupVite(httpServer, expressApp);
  }

  // ── Listen (with EADDRINUSE detection) ──
  const port = config.get<number>('port') || 5000;

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log(`[FATAL] Port ${port} is already in use. Kill the process on that port or set a different PORT in .env`, 'express');
      process.exit(1);
    }
    log(`[FATAL] Server error: ${err.message}`, 'express');
    process.exit(1);
  });

  httpServer.listen({ port, host: '127.0.0.1' }, () => {
    serverReady = true;
    log(`serving on port ${port}`, 'express');

    // Fire-and-forget cache warming — don't block startup
    warmSymbolsCatalog().catch(err => {
      console.warn('[startup] Cache warming failed:', err.message);
    });
  });

  // ── Graceful shutdown (with 10s timeout) ──
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return; // prevent double shutdown
    isShuttingDown = true;
    log('Graceful shutdown initiated...', 'nest');

    shutdownHardwareNode();
    shutdownAllPtySessions();

    // Race nestApp.close() against a 10s timeout
    const closeNest = async () => {
      try { await nestApp.close(); } catch {}
    };
    const timeout = new Promise<void>((resolve) =>
      setTimeout(() => {
        log('NestJS shutdown timed out after 10s — forcing exit', 'nest');
        resolve();
      }, 10_000),
    );
    await Promise.race([closeNest(), timeout]);

    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[CRITICAL BOOTSTRAP FAILURE]', err);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
  // Keep process alive in dev to allow HMR/tsx to restart on fix
});
