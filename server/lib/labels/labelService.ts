/**
 * Label Generation Service
 * 
 * Orchestrates label generation using DuckDB SQL generators
 * and manages storage of generated labels.
 */

import { db } from '../../db';
import { generatedLabels, contrastivePairs, ohlcvData as ohlcvDataTable } from '@shared/schema';
import { eq, desc, sql } from 'drizzle-orm';
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

// Load OHLCV data from PostgreSQL into DuckDB table for label generation
// Uses the same 1-minute aggregation as the chart for consistent timestamps
interface LoadOHLCVOptions {
  symbol: string;
  limit?: number;
  startTimestamp?: number; // In milliseconds - filter data from this time
  endTimestamp?: number;   // In milliseconds - filter data up to this time
}

async function loadOHLCVIntoDuckDB(options: LoadOHLCVOptions): Promise<void> {
  const { symbol, limit = 50000, startTimestamp, endTimestamp } = options;
  const { executeDuckDBQuery } = await getDuckDB();
  
  console.log(`[LabelService] Loading OHLCV for ${symbol}, range: ${startTimestamp} - ${endTimestamp}`);
  
  // First, try to drop the existing ohlcv table
  try {
    await executeDuckDBQuery('DROP TABLE IF EXISTS ohlcv');
  } catch (e) {
    // Ignore if table doesn't exist
  }
  
  // Determine asset type for partitioned table query
  const forexSymbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURJPY', 'GBPJPY', 'EURGBP', 'AUDJPY', 'EURAUD', 'EURCHF', 'AUDNZD', 'GBPAUD', 'GBPCHF', 'CADJPY'];
  const assetType = forexSymbols.includes(symbol.toUpperCase()) ? 'forex' : 'futures';
  const timeframeMs = 60000; // 1 minute
  
  // Build time range filter clause
  let timeFilter = '';
  const params: any[] = [symbol, assetType];
  let paramIndex = 3;
  
  if (startTimestamp && endTimestamp) {
    // Convert seconds to milliseconds if needed (detect by checking magnitude)
    const startMs = startTimestamp < 1e12 ? startTimestamp * 1000 : startTimestamp;
    const endMs = endTimestamp < 1e12 ? endTimestamp * 1000 : endTimestamp;
    timeFilter = ` AND timestamp >= $${paramIndex} AND timestamp <= $${paramIndex + 1}`;
    params.push(startMs, endMs);
    paramIndex += 2;
  }
  
  params.push(limit);
  
  // Query aggregated 1-minute OHLCV data from ohlcv_partitioned table
  // This matches the chart's data source for consistent label-to-candle alignment
  const aggregationQuery = `
    SELECT 
      FLOOR(timestamp / ${timeframeMs})::bigint * ${timeframeMs} as timestamp,
      symbol,
      (array_agg(open ORDER BY timestamp ASC))[1] as open,
      MAX(high) as high,
      MIN(low) as low,
      (array_agg(close ORDER BY timestamp DESC))[1] as close,
      SUM(volume)::int as volume
    FROM ohlcv_partitioned
    WHERE symbol = $1 AND asset_type = $2${timeFilter}
    GROUP BY FLOOR(timestamp / ${timeframeMs})::bigint, symbol
    ORDER BY timestamp DESC
    LIMIT $${paramIndex}
  `;
  
  const { pool } = await import('../../db');
  const client = await pool.connect();
  let ohlcvRows: any[] = [];
  
  try {
    const result = await client.query(aggregationQuery, params);
    ohlcvRows = result.rows;
    console.log(`[LabelService] Partitioned query returned ${ohlcvRows.length} rows for ${symbol}`);
  } finally {
    client.release();
  }
  
  if (ohlcvRows.length === 0) {
    // Fallback to legacy table if partitioned has no data
    // Build conditions array for the legacy query
    const conditions = [eq(ohlcvDataTable.symbol, symbol)];
    
    // Add time range filter if provided
    if (startTimestamp && endTimestamp) {
      const startMs = startTimestamp < 1e12 ? startTimestamp * 1000 : startTimestamp;
      const endMs = endTimestamp < 1e12 ? endTimestamp * 1000 : endTimestamp;
      console.log(`[LabelService] Legacy query time range: ${startMs} - ${endMs}`);
      conditions.push(sql`${ohlcvDataTable.timestamp} >= ${startMs}`);
      conditions.push(sql`${ohlcvDataTable.timestamp} <= ${endMs}`);
    }
    
    const legacyRows = await db.select({
      timestamp: ohlcvDataTable.timestamp,
      symbol: ohlcvDataTable.symbol,
      open: ohlcvDataTable.open,
      high: ohlcvDataTable.high,
      low: ohlcvDataTable.low,
      close: ohlcvDataTable.close,
      volume: ohlcvDataTable.volume,
    })
      .from(ohlcvDataTable)
      .where(sql`${sql.join(conditions, sql` AND `)}`)
      .orderBy(ohlcvDataTable.timestamp)
      .limit(limit);
    
    console.log(`[LabelService] Legacy query returned ${legacyRows.length} rows for ${symbol}`);
    
    if (legacyRows.length === 0) {
      // Generate synthetic data for preview purposes
      console.log(`[LabelService] No data found, generating synthetic data`);
      await generateSyntheticOHLCV(symbol, limit);
      return;
    }
    ohlcvRows = legacyRows;
  }
  
  // Sort ascending for proper label generation
  ohlcvRows.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  
  // Create the ohlcv table in DuckDB
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
      `(${row.timestamp}, '${row.symbol}', ${row.open}, ${row.high}, ${row.low}, ${row.close}, ${row.volume})`
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
): Promise<{ success: boolean; preview?: Array<Record<string, unknown>>; count?: number; error?: string }> {
  try {
    // Load OHLCV data into DuckDB first
    await loadOHLCVIntoDuckDB({ 
      symbol: request.symbol, 
      limit: 10000,
      startTimestamp: request.startTimestamp,
      endTimestamp: request.endTimestamp,
    });
    
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
    
    return {
      success: true,
      preview: sortedResults,
      count: sortedResults.length,
    };
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
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
        params as unknown as MetaLabelParams,
        config,
        (params as { primaryLabelsTable?: string }).primaryLabelsTable
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
