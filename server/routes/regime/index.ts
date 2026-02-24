import { Router } from "express";
import modelsRouter from "./models";
import trainingRouter from "./training";
import streamRouter from "./stream";

const router = Router();

// Order: stream/status before training to avoid parameterized route conflicts
router.use(streamRouter);
router.use(modelsRouter);
router.use(trainingRouter);

export default router;
