import { Router } from "express";
import explorerRouter from "./explorer.router";
import storesRouter from "./stores.router";
import databaseInfraRouter from "./database-infra.router";
import ingestionRouter from "./ingestion.router";

import { featuresRouter } from "./features.router";

const router = Router();

router.use("/databases", explorerRouter);
// The three stores as they actually are: the Iceberg lake, DuckDB, SQLite.
router.use("/", storesRouter);
router.use("/features", featuresRouter);
router.use("/", databaseInfraRouter);
router.use("/ingest", ingestionRouter);

export default router;
