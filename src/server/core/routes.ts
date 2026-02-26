import type { Express } from "express";
import { type Server } from "http";
import { apiRateLimiter, validationErrorHandler } from "../lib/rateLimiter";
import { startHealthMonitoring } from "../lib/databaseHealth";
import uploadRouter from "../routes/upload";
import parquetRouter from "../routes/parquet";
import instrumentsRouter from "../routes/instruments";
import indicatorsRouter from "../routes/indicators";
import mlRouter from "../routes/ml";
import newsRouter from "../routes/news";
import databasesRouter from "../routes/databases";
import chartRouter from "../routes/charts";
import backtestRouter from "../routes/backtest";
import modelCatalogRouter from "../routes/modelCatalog";

import trainingRouter from "../routes/training";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // Start health monitoring
  startHealthMonitoring();

  // Register validation error handler
  app.use(validationErrorHandler);

  // Apply rate limiting to all API routes
  app.use('/api', apiRateLimiter);

  // Mount domain-specific routers
  app.use("/api", uploadRouter);
  app.use("/api", parquetRouter);
  app.use("/api", instrumentsRouter);
  app.use("/api", indicatorsRouter);
  app.use("/api", trainingRouter);  // before mlRouter — static routes must match before ml's /training/:id
  app.use("/api", mlRouter);
  app.use("/api", newsRouter);
  app.use("/api", databasesRouter);
  app.use("/api/charts", chartRouter);
  app.use("/api", backtestRouter);
  app.use("/api", modelCatalogRouter);


  return httpServer;
}
