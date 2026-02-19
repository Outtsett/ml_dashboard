import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupPartitionedTables, migrateToPartitionedTables } from "./setup-partitions";
import { initDuckDB } from "./duckdb";
import { initMarketDB } from "./duckdb/market";
import { startQuestDB } from "./lib/questdbProcess";

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
  try {
    await setupPartitionedTables();
    await migrateToPartitionedTables();
  } catch (error) {
    console.error('Partition setup error (non-fatal):', error);
  }

  try {
    await initMarketDB();
    log('Market DuckDB initialized', 'market-db');
  } catch (error) {
    console.warn('[market-db] Initialization error (non-fatal):', error);
  }

  startQuestDB().then(result => {
    if (result.started) {
      console.log('[QuestDB] Started successfully');
    } else {
      console.warn('[QuestDB] Failed to start:', result.error);
    }
  }).catch(err => {
    console.warn('[QuestDB] Startup error:', err);
  });

  await registerRoutes(httpServer, app);

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

  // Initialize DuckDB for analytics
  try {
    await initDuckDB();
    log("DuckDB initialized for analytics", "duckdb");
  } catch (err) {
    log(`DuckDB initialization failed: ${err}`, "duckdb");
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
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
