import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupPartitionedTables, migrateToPartitionedTables } from "./setup-partitions";
import { initDuckDB } from "./duckdb";
import { initMarketDB } from "./duckdb/market";
import { runStartupSequence, getStartupReport } from "./lib/startupManager";
import { testPostgresConnection } from "./db";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // Skip logging for large data responses to prevent memory issues
        const isLargeDataResponse = Array.isArray(capturedJsonResponse) && capturedJsonResponse.length > 100;
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

(async () => {
  // ── Phase 1: Auto-start databases (PostgreSQL, QuestDB) ──
  const report = await runStartupSequence();

  // ── Phase 2: PostgreSQL schema setup (only if PG is reachable) ──
  if (report.postgres.status === 'running' || report.postgres.status === 'skipped') {
    const pgAlive = await testPostgresConnection(5000);
    if (pgAlive) {
      try {
        await Promise.race([
          (async () => {
            await setupPartitionedTables();
            await migrateToPartitionedTables();
          })(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Partition setup timed out after 30s')), 30_000)),
        ]);
      } catch (error) {
        console.error('Partition setup error (non-fatal):', error);
      }
    } else {
      console.warn('[startup] PostgreSQL port open but connection failed — skipping partition setup');
    }
  } else {
    console.warn('[startup] PostgreSQL not available — skipping partition setup');
  }

  // ── Phase 3: DuckDB market data ──
  try {
    await Promise.race([
      initMarketDB(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Market DuckDB init timed out after 15s')), 15_000)),
    ]);
    log('Market DuckDB initialized', 'market-db');
  } catch (error) {
    console.warn('[market-db] Initialization error (non-fatal):', error);
  }

  // ── Phase 4: Routes + middleware ──
  await registerRoutes(httpServer, app);

  // Expose startup report via API
  app.get('/api/startup-report', (_req: Request, res: Response) => {
    const currentReport = getStartupReport();
    if (currentReport) {
      return res.json(currentReport);
    }
    return res.status(503).json({ error: 'Startup not yet complete' });
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Initialize DuckDB for analytics (non-blocking)
  try {
    await initDuckDB();
    log("DuckDB initialized for analytics", "duckdb");
  } catch (err) {
    log(`DuckDB initialization failed: ${err}`, "duckdb");
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "127.0.0.1",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
