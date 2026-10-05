import type { Express, Request, Response } from "express";
import { type Server } from "http";
import { apiRateLimiter, validationErrorHandler } from "../lib/rateLimiter";
import { startHealthMonitoring } from "../database/health";
import { attachPtyWebSocket, registerTerminalRoutes } from "../lib/ptyServer";

// Data Domain
import uploadRouter from "../../data/upload.router";
import databasesRouter from "../../data";
import analyticsRouter from "../../analytics/analytics.router";
import studiesRouter from "../../studies/studies.router";
import pipelinesRouter from "../../data/pipelines.router";
import dataManagementRouter from "../../data/data-management.router";

// Market Domain
import instrumentsRouter from "../../market/instruments.router";
import newsRouter from "../../market/news.router";
import chartRouter from "../../market/charts.router";
import seriesRouter from "../../market/series.router";
import regressionRouter from "../../market/regression.router";
import candlePatternsRouter from "../../market/candle_patterns.router";
import marketReplayRouter from "../../market/ingestion/replay.router";

// ML Domain
import mlRouter from "../../ml";
import modelCatalogRouter from "../../ml/catalog.router";
import modelsRouter from "../../ml/models.router";
import registryRouter from "../../ml/registry.router";
import evalRouter from "../../ml/eval.router";
import anatomyRouter from "../../ml/anatomy.router";
import experimentsRouter from "../../ml/experiments.router";
import lensRouter from "../../lens/lens.router";
import lensTrainingRouter from "../../lens/training.router";
import lensVectorsRouter from "../../lens/vectors.router";

// Training Domain
import trainingRouter from "../../training/training.router";
import cycleModelsRouter from "../../training/cycleModels.router";
import { createCycleExplainRouter } from "../../training/cycleExplain.router";
import codegenRouter from "../../training/codegen.router";
import curriculumRouter from "../../training/curriculum.router";
import hpoRouter from "../../training/hpo.router";

// Backtest Domain
import backtestRouter from "../../backtest/backtest.router";

// Deployment Domain
import deploymentsRouter from "../../deployment/deployments.router";
import agentsRouter from "../../deployment/agents.router";
import eventsDeploymentsRouter from "../../deployment/deployments.events";
import eventsAgentsRouter from "../../deployment/agents.events";

// System Domain
import settingsRouter from "../../system/settings.router";
import systemRouter from "../../system/telemetry.router";
import eventsRouter from "../../system/events.router";
import copilotRouter from "../../ai/copilot.router";

// Marimo Domain
import marimoRouter from "../../marimo/marimo.router";
import streamMuxRouter from "../../stream/mux.router";
import chartLinkRouter from "../../market/chartLink.router";

// Sidecar Domain (live data hub, Claude Code host)
import sidecarRouter from "../../sidecar/sidecar.router";

// Entities Domain
import entitiesRouter from "../../entities/entities.router";

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

  // Mount domain-specific routers (Ordered to preserve precedence)
  app.use("/api", uploadRouter);
  app.use("/api", instrumentsRouter);
  app.use("/api", cycleModelsRouter);           // Model Cycle model browser: /training/cycle-models
  app.use("/api", createCycleExplainRouter());  // Inside the model: /training/cycle/:modelId/explain… — before trainingRouter's /training/cycle/:modelId
  app.use("/api", trainingRouter);  // before mlRouter — static routes must match before ml's /training/:id
  app.use("/api", codegenRouter);   // before mlRouter
  app.use("/api", evalRouter);
  app.use("/api", anatomyRouter);  // before mlRouter
  app.use("/api", lensTrainingRouter); // Lens training environment — before lensRouter
  app.use("/api", lensVectorsRouter);  // Lens vector space — before lensRouter
  app.use("/api", lensRouter);     // before mlRouter
  app.use("/api", hpoRouter);      // before mlRouter
  app.use("/api", experimentsRouter);
  app.use("/api", analyticsRouter); // four-layer analytics — before mlRouter
  app.use("/api", studiesRouter);   // the analytic pages that replaced the marimo notebooks
  app.use("/api", mlRouter);
  app.use("/api", newsRouter);
  app.use("/api", databasesRouter);
  app.use("/api/charts", seriesRouter);   // lake columns as chart series
  app.use("/api/charts", regressionRouter); // lake columns as regression X variables
  app.use("/api/charts", candlePatternsRouter); // TA-Lib pattern firings, from the lake
  app.use("/api/charts", chartRouter);
  app.use("/api", marketReplayRouter);
  app.use("/api", backtestRouter);
  app.use("/api", modelCatalogRouter);
  app.use("/api", curriculumRouter);
  app.use("/api", settingsRouter);
  app.use("/api", systemRouter);
  app.use("/api", modelsRouter);
  app.use("/api", registryRouter);
  app.use("/api", deploymentsRouter);
  app.use("/api", agentsRouter);
  app.use("/api/ai", copilotRouter);
  app.use("/api", marimoRouter);
  app.use("/api", streamMuxRouter);   // one event stream per tab carrying every stream it reads (stream/mux.ts)
  app.use("/api", chartLinkRouter);   // Market chart <-> notebooks: context out, overlays in (market/chartLink.ts)
  app.use("/api", sidecarRouter);
  app.use("/api", entitiesRouter);

  // Deployments SSE — mounted BEFORE the generic eventsRouter
  app.use("/api", eventsDeploymentsRouter);
  // Agents SSE — mounted BEFORE eventsRouter
  app.use("/api", eventsAgentsRouter);
  app.use("/api", eventsRouter);
  app.use("/api", pipelinesRouter);
  app.use("/api", dataManagementRouter);

  // Catch-all 404 for unregistered API routes (must be AFTER all /api mounts)
  app.use('/api/{*path}', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return httpServer;
}

