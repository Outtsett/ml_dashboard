/**
 * Label Generation Service
 * 
 * Orchestrates label generation using DuckDB SQL generators
 * and manages storage of generated labels.
 */

import { db } from '../../db';
import { generatedLabels, contrastivePairs } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';
import {
  LABEL_SQL_GENERATORS,
  LabelGeneratorType,
  LabelGeneratorConfig,
  DirectionParams,
  TripleBarrierParams,
  NPMMParams,
  VolatilityAdaptiveParams,
  TrendScanningParams,
  MetaLabelParams,
  FutureReturnParams,
  FutureVolatilityParams,
  MarketRegimeParams,
  SignalParams,
  MultiStepParams,
  PseudoConfidenceParams,
  ConsistencyPerturbationParams,
} from './sqlLabelGenerators';
import {
  CONTRASTIVE_SQL_GENERATORS,
  ContrastiveGeneratorType,
  ContrastivePairConfig,
  TemporalPairParams,
  StatisticalPairParams,
  generateContrastivePairsFromSQL,
} from './contrastivePairs';

// Dynamic import to avoid circular dependencies
async function getDuckDB() {
  const duckdb = await import('../../duckdb');
  return { 
    runQuery: duckdb.runQuery,
    executeDuckDBQuery: duckdb.executeDuckDBQuery,
  };
}

async function queryDuckDB(sql: string): Promise<Array<Record<string, unknown>>> {
  const { executeDuckDBQuery } = await getDuckDB();
  return executeDuckDBQuery(sql);
}

// Generate synthetic OHLCV data for preview purposes when no real data exists
async function generateSyntheticOHLCV(symbol: string, count: number = 1000): Promise<void> {
  const { executeDuckDBQuery } = await getDuckDB();
  
  // Create realistic-looking synthetic data using DuckDB
  await executeDuckDBQuery(`
    CREATE TABLE ohlcv AS
    WITH RECURSIVE dates AS (
      SELECT 
        1 as idx,
        1704067200000::BIGINT as ts,  -- Jan 1, 2024
        100.0 as price
      UNION ALL
      SELECT 
        idx + 1,
        ts + 60000,  -- 1-minute bars
        price * (1 + (RANDOM() - 0.5) * 0.002)  -- Random walk
      FROM dates
      WHERE idx < ${count}
    ),
    ohlcv_gen AS (
      SELECT
        ts as timestamp,
        '${symbol}' as symbol,
        price * (1 + (RANDOM() - 0.5) * 0.001) as open,
        price * (1 + RANDOM() * 0.002) as high,
        price * (1 - RANDOM() * 0.002) as low,
        price as close,
        (RANDOM() * 10000 + 1000)::INTEGER as volume
      FROM dates
    )
    SELECT * FROM ohlcv_gen
  `);
}

// Load OHLCV data from market.duckdb into analytics DuckDB table for label generation
// Sources real market data from the file-backed DuckDB (source of truth)
interface LoadOHLCVOptions {
  symbol: string;
  limit?: number;
  startTimestamp?: number; // In milliseconds - filter data from this time
  endTimestamp?: number;   // In milliseconds - filter data up to this time
  timeframeMinutes?: number; // Timeframe to aggregate to (default 1 = 1-minute)
}

async function loadOHLCVIntoDuckDB(options: LoadOHLCVOptions): Promise<void> {
  const { symbol, limit = 50000, startTimestamp, endTimestamp, timeframeMinutes = 1 } = options;
  const { executeDuckDBQuery } = await getDuckDB();
  const intervalSec = timeframeMinutes * 60;
  
  console.log(`[LabelService] Loading OHLCV from market.duckdb for ${symbol}, tf=${timeframeMinutes}m, range: ${startTimestamp} - ${endTimestamp}`);
  
  // Drop existing temp ohlcv table in analytics DuckDB
  try {
    await executeDuckDBQuery('DROP TABLE IF EXISTS ohlcv');
  } catch (e) {
    // Ignore if table doesn't exist
  }
  
  // Query real market data from file-backed market.duckdb
  const { marketQuery } = await import('../../duckdb/market');
  
  // Build time filter for market.duckdb queries
  let timeFilter = '';
  let stitchedTimeFilter = '';
  if (startTimestamp && endTimestamp) {
    const startMs = startTimestamp < 1e12 ? startTimestamp * 1000 : startTimestamp;
    const endMs = endTimestamp < 1e12 ? endTimestamp * 1000 : endTimestamp;
    timeFilter = ` AND epoch_ms(ts) >= ${startMs} AND epoch_ms(ts) <= ${endMs}`;
    stitchedTimeFilter = ` AND epoch_ms(o.ts) >= ${startMs} AND epoch_ms(o.ts) <= ${endMs}`;
  }
  
  // First try exact symbol match (works for specific contracts like MNQH5, and forex like EURUSD)
  let ohlcvRows = await marketQuery<{
    timestamp: number;
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>(`
    SELECT 
      CAST(epoch_ms(time_bucket(INTERVAL '${intervalSec} seconds', ts)) AS DOUBLE) as timestamp,
      '${symbol}' as symbol,
      first(open ORDER BY ts) as open,
      max(high) as high,
      min(low) as low,
      last(close ORDER BY ts) as close,
      CAST(sum(volume) AS DOUBLE) as volume
    FROM ohlcv
    WHERE symbol = '${symbol}'${timeFilter}
    GROUP BY time_bucket(INTERVAL '${intervalSec} seconds', ts)
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `);
  
  console.log(`[LabelService] Direct symbol query returned ${ohlcvRows.length} rows for ${symbol}`);
  
  // If no rows, check if this is a root symbol with rollover data (continuous contract)
  if (ohlcvRows.length === 0) {
    const rolloverCheck = await marketQuery<{ cnt: number }>(`
      SELECT CAST(COUNT(*) AS DOUBLE) as cnt FROM rollovers WHERE root = '${symbol}'
    `);
    
    if (rolloverCheck.length > 0 && rolloverCheck[0].cnt > 0) {
      console.log(`[LabelService] Symbol ${symbol} is a root — building continuous contract with Panama adjustment`);
      
      // Build continuous contract data with Panama back-adjustment
      // Same logic as /api/continuous/:baseSymbol in instruments.ts
      ohlcvRows = await marketQuery<{
        timestamp: number;
        symbol: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>(`
        WITH schedule AS (
          SELECT
            to_contract as contract,
            rollover_date as start_date,
            LEAD(rollover_date) OVER (PARTITION BY root ORDER BY rollover_date) as end_date,
            cumulative_adjustment as adj
          FROM rollovers
          WHERE root = '${symbol}'
          UNION ALL
          SELECT
            from_contract as contract,
            DATE '1900-01-01' as start_date,
            rollover_date as end_date,
            cumulative_adjustment + price_gap as adj
          FROM rollovers
          WHERE root = '${symbol}'
            AND rollover_date = (SELECT MIN(rollover_date) FROM rollovers WHERE root = '${symbol}')
        ),
        stitched AS (
          SELECT
            o.ts,
            o.open + s.adj as adj_open,
            o.high + s.adj as adj_high,
            o.low + s.adj as adj_low,
            o.close + s.adj as adj_close,
            o.volume
          FROM ohlcv o
          JOIN schedule s ON o.symbol = s.contract
            AND CAST(o.ts AS DATE) >= s.start_date
            AND (s.end_date IS NULL OR CAST(o.ts AS DATE) < s.end_date)
          WHERE 1=1 ${stitchedTimeFilter}
        )
        SELECT
          CAST(epoch_ms(time_bucket(INTERVAL '${intervalSec} seconds', ts)) AS DOUBLE) as timestamp,
          '${symbol}' as symbol,
          first(adj_open ORDER BY ts) as open,
          max(adj_high) as high,
          min(adj_low) as low,
          last(adj_close ORDER BY ts) as close,
          CAST(sum(volume) AS DOUBLE) as volume
        FROM stitched
        GROUP BY time_bucket(INTERVAL '${intervalSec} seconds', ts)
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `);
      
      console.log(`[LabelService] Continuous contract query returned ${ohlcvRows.length} rows for ${symbol}`);
    }
  }
  
  if (ohlcvRows.length === 0) {
    // Fall back to synthetic data only if no market data exists for this symbol
    console.warn(`[LabelService] No market data found for ${symbol}, generating synthetic data`);
    await generateSyntheticOHLCV(symbol, limit);
    return;
  }
  
  // Sort ascending for proper label generation (WINDOW functions need chronological order)
  ohlcvRows.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  
  // Create the ohlcv table in analytics DuckDB
  await executeDuckDBQuery(`
    CREATE TABLE ohlcv (
      timestamp BIGINT,
      symbol VARCHAR,
      open DOUBLE,
      high DOUBLE,
      low DOUBLE,
      close DOUBLE,
      volume DOUBLE
    )
  `);
  
  // Insert data in batches
  const batchSize = 1000;
  for (let i = 0; i < ohlcvRows.length; i += batchSize) {
    const batch = ohlcvRows.slice(i, i + batchSize);
    const values = batch.map(row => 
      `(${Number(row.timestamp)}, '${row.symbol}', ${row.open}, ${row.high}, ${row.low}, ${row.close}, ${row.volume})`
    ).join(',\n');
    
    await executeDuckDBQuery(`INSERT INTO ohlcv VALUES ${values}`);
  }
}

export interface LabelGenerationRequest {
  name: string;
  generatorType: LabelGeneratorType | ContrastiveGeneratorType;
  symbol: string;
  modelId?: number;
  params: Record<string, unknown>;
}

export interface LabelGenerationResult {
  success: boolean;
  labelSetId?: number;
  sampleCount?: number;
  labelDistribution?: Record<string, number>;
  preview?: Array<Record<string, unknown>>;
  error?: string;
  generationTimeMs?: number;
}

export interface LabelPreviewRequest {
  generatorType: LabelGeneratorType;
  symbol: string;
  params: Record<string, unknown>;
  limit?: number;
  startTimestamp?: number; // Optional: filter data to this range
  endTimestamp?: number;   // Optional: for matching visible chart data
  timeframeMinutes?: number; // Optional: aggregate to chart timeframe (default 1)
}

// ============================================================================
// LABEL GENERATION
// ============================================================================

export async function generateLabels(
  request: LabelGenerationRequest
): Promise<LabelGenerationResult> {
  const startTime = Date.now();
  
  try {
    // Create pending record
    const [labelRecord] = await db.insert(generatedLabels).values({
      name: request.name,
      generatorType: request.generatorType,
      category: getCategoryForGenerator(request.generatorType),
      symbol: request.symbol,
      modelId: request.modelId || null,
      config: JSON.stringify(request.params),
      status: 'generating',
    }).returning();
    
    const labelSetId = labelRecord.id;
    
    try {
      // Load OHLCV data into DuckDB first
      await loadOHLCVIntoDuckDB({ symbol: request.symbol, limit: 100000 });
      
      // Check if this is a contrastive generator
      if (isContrastiveGenerator(request.generatorType)) {
        return await generateContrastiveLabels(labelSetId, request, startTime);
      }
      
      // Generate SQL and execute on DuckDB
      const labelSQL = generateLabelSQL(
        request.generatorType as LabelGeneratorType,
        request.params,
        { symbol: request.symbol }
      );
      
      if (!labelSQL) {
        throw new Error(`Unknown generator type: ${request.generatorType}`);
      }
      
      const results = await queryDuckDB(labelSQL);
      
      if (!results || results.length === 0) {
        await db.update(generatedLabels)
          .set({
            status: 'completed',
            sampleCount: 0,
            generationTimeMs: Date.now() - startTime,
            updatedAt: new Date(),
          })
          .where(eq(generatedLabels.id, labelSetId));
        
        return {
          success: true,
          labelSetId,
          sampleCount: 0,
          labelDistribution: {},
          preview: [],
          generationTimeMs: Date.now() - startTime,
        };
      }
      
      // Calculate label distribution
      const labelDistribution = calculateLabelDistribution(results);
      
      // Get timestamp range
      const timestamps = results
        .map((r: Record<string, unknown>) => r.timestamp)
        .filter((t: unknown): t is number => typeof t === 'number');
      const dataStartTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : null;
      const dataEndTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;
      
      // Update record with results
      await db.update(generatedLabels)
        .set({
          status: 'completed',
          sampleCount: results.length,
          labelDistribution: JSON.stringify(labelDistribution),
          positiveCount: labelDistribution['1'] || 0,
          negativeCount: labelDistribution['-1'] || 0,
          neutralCount: labelDistribution['0'] || 0,
          dataStartTimestamp,
          dataEndTimestamp,
          generationTimeMs: Date.now() - startTime,
          updatedAt: new Date(),
        })
        .where(eq(generatedLabels.id, labelSetId));
      
      return {
        success: true,
        labelSetId,
        sampleCount: results.length,
        labelDistribution,
        preview: results.slice(0, 100),
        generationTimeMs: Date.now() - startTime,
      };
      
    } catch (error) {
      // Update record with error
      await db.update(generatedLabels)
        .set({
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          generationTimeMs: Date.now() - startTime,
          updatedAt: new Date(),
        })
        .where(eq(generatedLabels.id, labelSetId));
      
      throw error;
    }
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      generationTimeMs: Date.now() - startTime,
    };
  }
}

async function generateContrastiveLabels(
  labelSetId: number,
  request: LabelGenerationRequest,
  startTime: number
): Promise<LabelGenerationResult> {
  const config: ContrastivePairConfig = {
    symbol: request.symbol,
    windowSize: (request.params.windowSize as number) || 60,
  };
  
  let sql: string;
  const genType = request.generatorType as string;
  if (genType === 'contrastive_temporal') {
    sql = CONTRASTIVE_SQL_GENERATORS.temporal(
      request.params as unknown as TemporalPairParams,
      config
    );
  } else if (genType === 'contrastive_statistical') {
    sql = CONTRASTIVE_SQL_GENERATORS.statistical(
      request.params as unknown as StatisticalPairParams,
      config,
      false // single-asset mode
    );
  } else {
    throw new Error(`Unknown contrastive generator: ${genType}`);
  }
  
  const results = await queryDuckDB(sql);
  
  if (!results || results.length === 0) {
    await db.update(generatedLabels)
      .set({
        status: 'completed',
        sampleCount: 0,
        generationTimeMs: Date.now() - startTime,
        updatedAt: new Date(),
      })
      .where(eq(generatedLabels.id, labelSetId));
    
    return {
      success: true,
      labelSetId,
      sampleCount: 0,
      preview: [],
      generationTimeMs: Date.now() - startTime,
    };
  }
  
  const pairResult = generateContrastivePairsFromSQL(results as Array<{
    anchor_idx: number;
    positive_idx: number;
    negative_idx: number;
    pair_type: string;
  }>);
  
  // Store pairs in database (batch insert)
  if (pairResult.pairs.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < pairResult.pairs.length; i += batchSize) {
      const batch = pairResult.pairs.slice(i, i + batchSize);
      await db.insert(contrastivePairs).values(
        batch.map(p => ({
          labelSetId,
          anchorIdx: p.anchorIdx,
          positiveIdx: p.positiveIdx,
          negativeIdx: p.negativeIdx,
          pairType: p.pairType,
        }))
      );
    }
  }
  
  await db.update(generatedLabels)
    .set({
      status: 'completed',
      sampleCount: pairResult.pairs.length,
      labelDistribution: JSON.stringify(pairResult.stats),
      generationTimeMs: Date.now() - startTime,
      updatedAt: new Date(),
    })
    .where(eq(generatedLabels.id, labelSetId));
  
  return {
    success: true,
    labelSetId,
    sampleCount: pairResult.pairs.length,
    labelDistribution: pairResult.stats as unknown as Record<string, number>,
    preview: pairResult.pairs.slice(0, 100) as unknown as Array<Record<string, unknown>>,
    generationTimeMs: Date.now() - startTime,
  };
}

// ============================================================================
// PREVIEW (without storing)
// ============================================================================

export async function previewLabels(
  request: LabelPreviewRequest
): Promise<{ success: boolean; preview?: Array<Record<string, unknown>>; count?: number; error?: string; generatorType?: string }> {
  try {
    // Handle contrastive generators — they produce pair indices, not per-bar labels.
    // Fall back to direction labels for chart preview.
    const isContrastive = ['contrastive_temporal', 'contrastive_augmentation', 'contrastive_statistical'].includes(request.generatorType);
    if (isContrastive) {
      return {
        success: true,
        preview: [],
        count: 0,
        generatorType: request.generatorType,
        error: 'Contrastive generators produce sample pairs, not per-bar labels. Use the full generation flow to create contrastive pairs.',
      };
    }

    // Load OHLCV data into DuckDB first
    await loadOHLCVIntoDuckDB({ 
      symbol: request.symbol, 
      limit: 10000,
      startTimestamp: request.startTimestamp,
      endTimestamp: request.endTimestamp,
      timeframeMinutes: request.timeframeMinutes,
    });

    // For meta_label: generate primary direction labels first so the JOIN has data
    if (request.generatorType === 'meta_label') {
      const directionSQL = LABEL_SQL_GENERATORS.direction(
        { horizon: 1, threshold: 0, numClasses: 2 },
        { symbol: request.symbol }
      );
      try {
        await queryDuckDB('DROP TABLE IF EXISTS primary_labels');
        await queryDuckDB(`CREATE TABLE primary_labels AS ${directionSQL}`);
      } catch (e) {
        console.warn('[LabelService] Failed to generate primary labels for meta_label preview:', e);
      }
    }
    
    const labelSQL = generateLabelSQL(
      request.generatorType,
      request.params,
      { symbol: request.symbol }
    );
    
    if (!labelSQL) {
      return { success: false, error: `Unknown generator type: ${request.generatorType}` };
    }
    
    // Add ORDER BY DESC and LIMIT for preview to match chart's most recent data view
    const limit = request.limit || 500;
    const limitedSQL = `
      WITH label_data AS (${labelSQL})
      SELECT * FROM label_data
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;
    
    const results = await queryDuckDB(limitedSQL);
    
    // Sort results ascending for proper chart marker order (oldest to newest)
    const sortedResults = (results || []).sort((a: any, b: any) => 
      Number(a.timestamp) - Number(b.timestamp)
    );

    // Post-process: normalize labels for chart rendering
    const normalizedResults = normalizeLabelsForPreview(request.generatorType, sortedResults);
    
    return {
      success: true,
      preview: normalizedResults,
      count: normalizedResults.length,
      generatorType: request.generatorType,
    };
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Normalize label values for chart rendering.
 * All generators should output { timestamp, close, label } where label is -1, 0, or 1.
 * Generators that produce other values are mapped to this standard.
 */
function normalizeLabelsForPreview(
  generatorType: string,
  results: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  if (!results || results.length === 0) return results;

  const regressionGenerators = ['future_return', 'future_volatility'];
  const multiClassGenerators = ['regime'];

  if (regressionGenerators.includes(generatorType)) {
    // Convert continuous regression targets to classification labels for chart
    if (generatorType === 'future_volatility') {
      // Volatility is always positive — bin into high(1) / medium(0) / low(-1)
      // using percentile-based thresholds from the data
      const values = results
        .map(r => Number(r.label))
        .filter(v => !isNaN(v) && v !== null);
      if (values.length === 0) return results;
      values.sort((a, b) => a - b);
      const p33 = values[Math.floor(values.length * 0.33)];
      const p66 = values[Math.floor(values.length * 0.66)];
      return results.map(row => {
        const rawLabel = Number(row.label);
        if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
          return { ...row, label: null };
        }
        let normalizedLabel: number;
        if (rawLabel >= p66) normalizedLabel = 1;       // High vol
        else if (rawLabel <= p33) normalizedLabel = -1;  // Low vol
        else normalizedLabel = 0;                        // Medium vol
        return { ...row, label: normalizedLabel, rawLabel };
      });
    }
    // future_return: sign of the return
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      let normalizedLabel: number;
      if (rawLabel > 0) normalizedLabel = 1;
      else if (rawLabel < 0) normalizedLabel = -1;
      else normalizedLabel = 0;
      return { ...row, label: normalizedLabel, rawLabel };
    });
  }

  if (multiClassGenerators.includes(generatorType)) {
    // Regime labels: 0,1,2,3 → map to chart-compatible values
    // Even regimes (0,2) = bearish-ish → -1, Odd regimes (1,3) = bullish-ish → 1
    // For 3-regime: 0=downtrend→-1, 1=sideways→0, 2=uptrend→1
    // For 2-regime: 0=bearish→-1, 1=bullish→1
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      const regimeName = row.regime_name as string | undefined;
      let normalizedLabel: number;
      if (regimeName) {
        // Use regime_name for more accurate mapping
        if (regimeName.includes('down') || regimeName === 'bearish') normalizedLabel = -1;
        else if (regimeName.includes('up') || regimeName === 'bullish') normalizedLabel = 1;
        else normalizedLabel = 0; // sideways, low_vol_down etc
      } else {
        // Fallback: map numeric labels
        if (rawLabel === 0) normalizedLabel = -1;
        else if (rawLabel === 1) normalizedLabel = 1;
        else if (rawLabel === 2) normalizedLabel = -1;
        else normalizedLabel = 1;
      }
      return { ...row, label: normalizedLabel, rawLabel, regimeName };
    });
  }

  // For multi_step: label is already 0 or 1, map 0 → -1 (sell) for chart
  if (generatorType === 'multi_step') {
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      return { ...row, label: rawLabel === 1 ? 1 : -1, rawLabel };
    });
  }

  // For pseudo_confidence: filter out null labels (low confidence samples)
  if (generatorType === 'pseudo_confidence') {
    return results.filter(row => row.label !== null && row.label !== undefined);
  }

  // For meta_label: 0→-1 (don't trade), 1→1 (trade) mapping for chart
  if (generatorType === 'meta_label') {
    return results.map(row => {
      const rawLabel = Number(row.label);
      if (isNaN(rawLabel) || row.label === null || row.label === undefined) {
        return { ...row, label: null };
      }
      return { ...row, label: rawLabel === 1 ? 1 : -1, rawLabel };
    });
  }

  // Default: return as-is (direction, signal, triple_barrier, npmm, 
  // volatility_adaptive, trend_scanning, consistency_perturbation already use -1/0/1)
  return results;
}

// ============================================================================
// LABEL SET MANAGEMENT
// ============================================================================

export async function getLabelSets(filters?: {
  symbol?: string;
  generatorType?: string;
  modelId?: number;
  status?: string;
  limit?: number;
}) {
  let query = db.select().from(generatedLabels).orderBy(desc(generatedLabels.createdAt));
  
  // Note: For proper filtering, we'd need to build conditions dynamically
  // This is a simplified version
  const results = await query.limit(filters?.limit || 50);
  
  return results.filter(r => {
    if (filters?.symbol && r.symbol !== filters.symbol) return false;
    if (filters?.generatorType && r.generatorType !== filters.generatorType) return false;
    if (filters?.modelId && r.modelId !== filters.modelId) return false;
    if (filters?.status && r.status !== filters.status) return false;
    return true;
  });
}

export async function getLabelSetById(id: number) {
  const results = await db.select().from(generatedLabels).where(eq(generatedLabels.id, id));
  return results[0] || null;
}

export async function getContrastivePairsForLabelSet(labelSetId: number, limit: number = 1000) {
  return db.select()
    .from(contrastivePairs)
    .where(eq(contrastivePairs.labelSetId, labelSetId))
    .limit(limit);
}

export async function deleteLabelSet(id: number) {
  await db.delete(generatedLabels).where(eq(generatedLabels.id, id));
  return { success: true };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateLabelSQL(
  generatorType: LabelGeneratorType,
  params: Record<string, unknown>,
  config: LabelGeneratorConfig
): string | null {
  switch (generatorType) {
    case 'direction':
      return LABEL_SQL_GENERATORS.direction(
        params as unknown as DirectionParams,
        config
      );
    case 'triple_barrier':
      return LABEL_SQL_GENERATORS.triple_barrier(
        params as unknown as TripleBarrierParams,
        config
      );
    case 'npmm':
      return LABEL_SQL_GENERATORS.npmm(
        params as unknown as NPMMParams,
        config
      );
    case 'volatility_adaptive':
      return LABEL_SQL_GENERATORS.volatility_adaptive(
        params as unknown as VolatilityAdaptiveParams,
        config
      );
    case 'trend_scanning':
      return LABEL_SQL_GENERATORS.trend_scanning(
        params as unknown as TrendScanningParams,
        config
      );
    case 'meta_label':
      return LABEL_SQL_GENERATORS.meta_label(
        { 
          ...(params as unknown as MetaLabelParams),
          primarySignalColumn: (params as unknown as MetaLabelParams).primarySignalColumn || 'label',
        },
        config,
        (params as { primaryLabelsTable?: string }).primaryLabelsTable || 'primary_labels'
      );
    case 'future_return':
      return LABEL_SQL_GENERATORS.future_return(
        params as unknown as FutureReturnParams,
        config
      );
    case 'future_volatility':
      return LABEL_SQL_GENERATORS.future_volatility(
        params as unknown as FutureVolatilityParams,
        config
      );
    case 'regime':
      return LABEL_SQL_GENERATORS.regime(
        params as unknown as MarketRegimeParams,
        config
      );
    case 'signal':
      return LABEL_SQL_GENERATORS.signal(
        params as unknown as SignalParams,
        config
      );
    case 'multi_step':
      return LABEL_SQL_GENERATORS.multi_step(
        params as unknown as MultiStepParams,
        config
      );
    case 'pseudo_confidence':
      return LABEL_SQL_GENERATORS.pseudo_confidence(
        params as unknown as PseudoConfidenceParams,
        config
      );
    case 'consistency_perturbation':
      return LABEL_SQL_GENERATORS.consistency_perturbation(
        params as unknown as ConsistencyPerturbationParams,
        config
      );
    default:
      return null;
  }
}

function getCategoryForGenerator(generatorType: string): string {
  const classificationGenerators = ['direction', 'triple_barrier', 'npmm', 'volatility_adaptive', 'trend_scanning', 'meta_label', 'signal', 'regime', 'pseudo_confidence', 'consistency_perturbation'];
  const regressionGenerators = ['future_return', 'future_volatility'];
  const sequenceGenerators = ['multi_step'];
  const contrastiveGenerators = ['contrastive_temporal', 'contrastive_augmentation', 'contrastive_statistical'];
  const semiSupervisedGenerators = ['pseudo_confidence', 'consistency_perturbation'];
  
  if (classificationGenerators.includes(generatorType)) return 'classification';
  if (regressionGenerators.includes(generatorType)) return 'regression';
  if (sequenceGenerators.includes(generatorType)) return 'sequence';
  if (contrastiveGenerators.includes(generatorType)) return 'contrastive';
  if (semiSupervisedGenerators.includes(generatorType)) return 'semi-supervised';
  
  return 'classification'; // default
}

function isContrastiveGenerator(generatorType: string): boolean {
  return ['contrastive_temporal', 'contrastive_augmentation', 'contrastive_statistical'].includes(generatorType);
}

function calculateLabelDistribution(results: Array<Record<string, unknown>>): Record<string, number> {
  const distribution: Record<string, number> = {};
  
  for (const row of results) {
    const label = row.label;
    if (label === undefined || label === null) continue;
    const labelStr = String(label);
    distribution[labelStr] = (distribution[labelStr] || 0) + 1;
  }
  
  return distribution;
}

// ============================================================================
// EXPORT
// ============================================================================

export const labelService = {
  generateLabels,
  previewLabels,
  getLabelSets,
  getLabelSetById,
  getContrastivePairsForLabelSet,
  deleteLabelSet,
};
