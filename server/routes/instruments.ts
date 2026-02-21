import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { getString } from "./helpers";
import { ohlcvCache, cachedQuery, OHLCVCache } from "../lib/ohlcvCache";

const router = Router();

// Instrument metadata APIs
router.get("/instruments", async (req: Request, res: Response) => {
  try {
    const type = getString(req.query.type as string);
    if (type === 'futures' || type === 'forex') {
      const instruments = await storage.getInstrumentsByType(type);
      res.json(instruments);
    } else {
      const instruments = await storage.getAllInstruments();
      res.json(instruments);
    }
  } catch (error) {
    console.error("Error fetching instruments:", error);
    res.status(500).json({ error: "Failed to fetch instruments" });
  }
});

router.get("/instruments/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);
    const instrument = await storage.getInstrument(symbol);
    if (!instrument) {
      return res.status(404).json({ error: "Instrument not found" });
    }
    res.json(instrument);
  } catch (error) {
    console.error("Error fetching instrument:", error);
    res.status(500).json({ error: "Failed to fetch instrument" });
  }
});

// Contract rollover APIs
router.get("/rollovers/:baseSymbol", async (req: Request, res: Response) => {
  try {
    const baseSymbol = getString(req.params.baseSymbol);
    const rollovers = await storage.getContractRollovers(baseSymbol);
    res.json(rollovers);
  } catch (error) {
    console.error("Error fetching rollovers:", error);
    res.status(500).json({ error: "Failed to fetch rollovers" });
  }
});

router.post("/rollovers/:baseSymbol/detect", async (req: Request, res: Response) => {
  try {
    const baseSymbol = getString(req.params.baseSymbol);
    const rollovers = await storage.detectVolumeRollovers(baseSymbol);
    res.json(rollovers);
  } catch (error) {
    console.error("Error detecting rollovers:", error);
    res.status(500).json({ error: "Failed to detect rollovers" });
  }
});

router.post("/rollovers", async (req: Request, res: Response) => {
  try {
    const rollover = await storage.createContractRollover(req.body);
    res.json(rollover);
  } catch (error) {
    console.error("Error creating rollover:", error);
    res.status(500).json({ error: "Failed to create rollover" });
  }
});

// Get continuous contract data from DuckDB with Panama back-adjustment
// Uses rollover schedule to stitch contracts and apply cumulative price adjustments
router.get("/continuous/:baseSymbol", async (req: Request, res: Response) => {
  try {
    const baseSymbol = getString(req.params.baseSymbol).toUpperCase();
    const limit = getString(req.query.limit as string);
    const limitNum = limit ? Math.min(parseInt(limit), 50000) : 2000;
    const timeframe = req.query.timeframe as string;
    const startTime = req.query.startTime ? parseInt(req.query.startTime as string) : undefined;
    const endTime = req.query.endTime ? parseInt(req.query.endTime as string) : undefined;

    // Parse timeframe to seconds (default 60 = 1 minute)
    let timeframeSec = 60;
    if (timeframe) {
      const match = timeframe.match(/^(\d+)(s|m|h|d)?$/);
      if (match) {
        const val = parseInt(match[1]);
        const unit = match[2] || 'm';
        timeframeSec = unit === 's' ? val : unit === 'm' ? val * 60 : unit === 'h' ? val * 3600 : val * 86400;
      }
    }

    const { marketQuery } = await import("../duckdb/market");

    // Build continuous contract: join OHLCV with rollover schedule
    // The rollover schedule tells us which contract is active on each day.
    // cumulative_adjustment is applied to prices for Panama back-adjustment.
    let timeFilter = '';
    if (startTime) {
      timeFilter += ` AND o.ts >= '${new Date(startTime).toISOString()}'::TIMESTAMP`;
    }
    if (endTime) {
      timeFilter += ` AND o.ts <= '${new Date(endTime).toISOString()}'::TIMESTAMP`;
    }

    const intervalSec = timeframeSec;

    const continuousCacheKey = OHLCVCache.key('continuous', baseSymbol, timeframeSec, {
      startTime, endTime, limit: limitNum,
      loadFromStart: req.query.loadFromStart === 'true'
    });

    const data = await cachedQuery(continuousCacheKey, () => marketQuery<{
      timestamp: number;
      symbol: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      adjustedOpen: number;
      adjustedHigh: number;
      adjustedLow: number;
      adjustedClose: number;
      activeContract: string;
    }>(`
      WITH schedule AS (
        -- Build active contract schedule from rollovers
        SELECT
          to_contract as contract,
          rollover_date as start_date,
          LEAD(rollover_date) OVER (PARTITION BY root ORDER BY rollover_date) as end_date,
          cumulative_adjustment as adj
        FROM rollovers
        WHERE root = '${baseSymbol}'

        UNION ALL

        -- First contract (before first rollover)
        SELECT
          from_contract as contract,
          DATE '1900-01-01' as start_date,
          rollover_date as end_date,
          cumulative_adjustment + price_gap as adj
        FROM rollovers
        WHERE root = '${baseSymbol}'
          AND rollover_date = (SELECT MIN(rollover_date) FROM rollovers WHERE root = '${baseSymbol}')
      ),
      stitched AS (
        SELECT
          o.ts,
          s.contract as active_contract,
          o.open + s.adj as adj_open,
          o.high + s.adj as adj_high,
          o.low + s.adj as adj_low,
          o.close + s.adj as adj_close,
          o.volume
        FROM ohlcv o
        JOIN schedule s ON o.symbol = s.contract
          AND CAST(o.ts AS DATE) >= s.start_date
          AND (s.end_date IS NULL OR CAST(o.ts AS DATE) < s.end_date)
        WHERE 1=1 ${timeFilter}
      )
      SELECT
        CAST(epoch_ms(time_bucket(INTERVAL '${intervalSec} seconds', ts)) AS DOUBLE) as timestamp,
        '${baseSymbol}' as symbol,
        first(active_contract ORDER BY ts) as "activeContract",
        first(adj_open ORDER BY ts) as open,
        max(adj_high) as high,
        min(adj_low) as low,
        last(adj_close ORDER BY ts) as close,
        CAST(sum(volume) AS DOUBLE) as volume,
        first(adj_open ORDER BY ts) as "adjustedOpen",
        max(adj_high) as "adjustedHigh",
        min(adj_low) as "adjustedLow",
        last(adj_close ORDER BY ts) as "adjustedClose"
      FROM stitched
      GROUP BY time_bucket(INTERVAL '${intervalSec} seconds', ts)
      ORDER BY timestamp ${startTime && !endTime ? 'ASC' : !startTime && !endTime && req.query.loadFromStart === 'true' ? 'ASC' : 'DESC'}
      LIMIT ${limitNum}
    `));

    // Reverse DESC results to ascending order for chart display
    // Use spread to avoid mutating the cached array in-place (which would flip on every cache hit)
    const sortedData = (!(startTime && !endTime) && !(req.query.loadFromStart === 'true'))
      ? [...data].reverse()
      : data;

    // Get rollover events — cache separately since they rarely change
    const rolloverCacheKey = `rollovers|${baseSymbol}`;
    const rollovers = await cachedQuery(rolloverCacheKey, () => marketQuery<{
      rollover_date: string;
      from_contract: string;
      to_contract: string;
      price_gap: number;
    }>(`
      SELECT CAST(rollover_date AS VARCHAR) as rollover_date, from_contract, to_contract, price_gap
      FROM rollovers
      WHERE root = '${baseSymbol}'
      ORDER BY rollover_date
    `));

    res.json({
      data: sortedData,
      rollovers,
    });
  } catch (error) {
    console.error("Error fetching continuous contract:", error);
    res.status(500).json({ error: "Failed to fetch continuous contract" });
  }
});

// Get feature importance for a model
router.get("/features/:modelName", async (req: Request, res: Response) => {
  try {
    const modelName = getString(req.params.modelName);
    const features = await storage.getFeatureImportance(modelName);
    res.json(features);
  } catch (error) {
    console.error("Error fetching feature importance:", error);
    res.status(500).json({ error: "Failed to fetch feature importance" });
  }
});

// Save feature importance
router.post("/features", async (req: Request, res: Response) => {
  try {
    const features = req.body;
    await storage.saveFeatureImportance(features);
    res.json({ message: "Feature importance saved" });
  } catch (error) {
    console.error("Error saving feature importance:", error);
    res.status(500).json({ error: "Failed to save feature importance" });
  }
});

export default router;
