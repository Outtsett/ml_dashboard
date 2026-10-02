import { Router } from "express";
import explorerRouter from "./explorer.router";
import storesRouter from "./stores.router";
import profileRouter from "./profile.router";
import databaseInfraRouter from "./database-infra.router";

import { featuresRouter } from "./features.router";

const router = Router();

router.use("/databases", explorerRouter);
// The three stores as they actually are: the Iceberg lake, DuckDB, SQLite.
router.use("/", storesRouter);
// Per-column distributions and sparklines, measured in DuckDB.
router.use("/", profileRouter);
router.use("/features", featuresRouter);
router.use("/", databaseInfraRouter);

export default router;

