import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { apiRateLimiter, validationErrorHandler } from "../lib/rateLimiter";
import { startHealthMonitoring } from "../database/health";
import { attachPtyWebSocket, registerTerminalRoutes } from "../lib/ptyServer";
import uploadRouter from "../routes/upload";

import instrumentsRouter from "../routes/instruments";
import mlRouter from "../routes/ml";
import newsRouter from "../routes/news";
import databasesRouter from "../routes/databases";
import chartRouter from "../routes/charts";
import backtestRouter from "../routes/backtest";
import modelCatalogRouter from "../routes/modelCatalog";
import curriculumRouter from "../routes/curriculum";

import trainingRouter from "../routes/training";
import eventsRouter from "../routes/events";
import pipelinesRouter from "../routes/pipelines";
import hpoRouter from "../routes/hpo";
import settingsRouter from "../routes/settings";
import systemRouter from "../routes/system";
import motiveWaveRouter from "../routes/motivewave";
import chatRouter from "../routes/chat";
import modelsRouter from "../routes/models";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // Attach PTY WebSocket (independent of Express — survives route errors)
  attachPtyWebSocket(httpServer);

  // Start health monitoring
  startHealthMonitoring();

  // Register validation error handler
  app.use(validationErrorHandler);

  // Apply rate limiting to all API routes (BEFORE terminal routes — ensures coverage)
  app.use('/api', apiRateLimiter);

  // Register terminal session management REST routes (after rate limiter)
  registerTerminalRoutes(app);

  // Mount domain-specific routers
  app.use("/api", uploadRouter);

  app.use("/api", instrumentsRouter);
  app.use("/api", trainingRouter);  // before mlRouter — static routes must match before ml's /training/:id
  app.use("/api", hpoRouter);      // before mlRouter — HPO static routes must match before catch-all
  app.use("/api", mlRouter);
  app.use("/api", newsRouter);
  app.use("/api", databasesRouter);
  app.use("/api/charts", chartRouter);
  app.use("/api", backtestRouter);
  app.use("/api", modelCatalogRouter);
  app.use("/api", curriculumRouter);
  app.use("/api", settingsRouter);
  app.use("/api", systemRouter);
  app.use("/api", motiveWaveRouter);
  app.use("/api", modelsRouter);
  app.use("/api", eventsRouter);
  app.use("/api", pipelinesRouter);
  app.use("/api", chatRouter);

  // Catch-all 404 for unregistered API routes (must be AFTER all /api mounts)
  // Express 5 / path-to-regexp v8 requires named wildcard params
  app.use('/api/{*path}', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return httpServer;
}
