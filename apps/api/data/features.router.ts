import { Router } from "express";
import { db } from "../infrastructure/database/db";
import { featureSets } from "@shared/pg_schema";

export const featuresRouter = Router();

// A static registry of available engineering features for Phase 1
const AVAILABLE_FEATURES = [
  { id: "ohlcv", name: "Base OHLCV", category: "Core", description: "Open, High, Low, Close, Volume" },
  { id: "rsi_14", name: "RSI (14)", category: "Momentum", description: "Relative Strength Index (14 period)" },
  { id: "macd", name: "MACD", category: "Momentum", description: "Moving Average Convergence Divergence" },
  { id: "bbands", name: "Bollinger Bands", category: "Volatility", description: "Standard deviation bands" },
  { id: "atr", name: "ATR", category: "Volatility", description: "Average True Range" },
  { id: "ob_imbalance", name: "Order Book Imbalance", category: "Liquidity", description: "L2 Order Book bid/ask imbalance" },
  { id: "candle_body", name: "Candle Body Size", category: "Geometry", description: "Absolute size of the candle body" },
];

const AVAILABLE_TARGETS = [
  { id: "RET_LOG_1M", name: "1m Log Return", description: "1-minute forward log return" },
  { id: "RET_LOG_5M", name: "5m Log Return", description: "5-minute forward log return" },
  { id: "ALPHA_RESID_5M", name: "5m Residual Alpha", description: "Market-neutral 5m residual return" },
];

featuresRouter.get("/available", (req, res) => {
  try {
    res.json({
      features: AVAILABLE_FEATURES,
      targets: AVAILABLE_TARGETS,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// For saving/loading specific Feature Sets (combinations of features)
featuresRouter.get("/sets", async (req, res) => {
  try {
    const sets = await db.select().from(featureSets);
    res.json(sets);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

featuresRouter.post("/sets", async (req, res) => {
  try {
    const data = req.body;
    const inserted = await db.insert(featureSets).values({
      name: data.name,
      description: data.description,
      features: JSON.stringify(data.features),
      normalization: JSON.stringify(data.normalization || {}),
      timeframe: data.timeframe,
    }).returning();
    res.json(inserted[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

