import { Router } from "express";
import explorerRouter from "./explorer.router";
import databaseInfraRouter from "./database-infra.router";

const router = Router();

// These routes were previously under /api/databases
router.use("/databases", explorerRouter);
router.use("/databases", databaseInfraRouter); // Both mount to /api/databases

export default router;
