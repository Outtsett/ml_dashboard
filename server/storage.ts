import { 
  users, ohlcvData, uploads, featureImportance, contractRollovers, trainingSessions, lossHistory, instruments,
  newsArticles, newsSymbols,
  type User, type InsertUser, type Ohlcv, type InsertOhlcv, type Upload, type InsertUpload, 
  type FeatureImportance, type InsertFeatureImportance, type ContractRollover, type InsertContractRollover,
  type TrainingSession, type InsertTrainingSession, type LossHistory, type InsertLossHistory,
  type Instrument, type InsertInstrument, type NewsArticle, type InsertNewsArticle, type NewsSymbol, type InsertNewsSymbol
} from "@shared/schema";
import { db, pool } from "./db";
import { eq, and, gte, lte, desc, asc, sql } from "drizzle-orm";

const FUTURES_SYMBOLS = ['ES', 'MES', 'NQ', 'MNQ', 'RTY', 'M2K', 'YM', 'MYM'];

export function getAssetType(symbol: string): 'futures' | 'forex' {
  const baseSymbol = symbol.replace(/[A-Z]\d{1,2}$/, '').replace(/\d{4}$/, '');
  if (FUTURES_SYMBOLS.includes(baseSymbol)) return 'futures';
  if (symbol.match(/^[A-Z]{6}$/)) return 'forex';
  return 'futures';
}

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // OHLCV data methods
  insertOhlcvBatch(data: InsertOhlcv[]): Promise<void>;
  getOhlcvData(symbol: string, startTime: number, endTime: number, limit?: number): Promise<Ohlcv[]>;
  getLatestOhlcv(symbol: string, limit?: number): Promise<Ohlcv[]>;
  getOhlcvAggregated(symbol: string, limit?: number, timeframeSeconds?: number): Promise<Ohlcv[]>;
  getOhlcvAggregatedRange(symbol: string, options: { startTime?: number; endTime?: number; limit?: number; timeframeSeconds?: number }): Promise<Ohlcv[]>;
  
  // Upload tracking
  createUpload(upload: InsertUpload): Promise<Upload>;
  updateUploadStatus(id: number, status: string, recordCount?: number): Promise<void>;
  getUploads(): Promise<Upload[]>;
  
  // Feature importance
  saveFeatureImportance(data: InsertFeatureImportance[]): Promise<void>;
  getFeatureImportance(modelName: string): Promise<FeatureImportance[]>;

  // Contract rollovers
  createContractRollover(rollover: InsertContractRollover): Promise<ContractRollover>;
  getContractRollovers(baseSymbol: string): Promise<ContractRollover[]>;
  detectVolumeRollovers(baseSymbol: string): Promise<ContractRollover[]>;

  // Training sessions
  createTrainingSession(session: InsertTrainingSession): Promise<TrainingSession>;
  updateTrainingSession(id: number, data: Partial<TrainingSession>): Promise<void>;
  getActiveTrainingSession(): Promise<TrainingSession | undefined>;
  getTrainingSession(id: number): Promise<TrainingSession | undefined>;

  // Loss history
  addLossHistory(entry: InsertLossHistory): Promise<LossHistory>;
  getLossHistory(sessionId: number): Promise<LossHistory[]>;
  
  // Partitioned OHLCV methods
  insertOhlcvPartitioned(data: InsertOhlcv[], symbol: string): Promise<void>;
  getOhlcvPartitioned(symbol: string, limit?: number, timeframeSeconds?: number): Promise<Ohlcv[]>;
  getOhlcvPartitionedRange(symbol: string, options: { startTime?: number; endTime?: number; limit?: number; timeframeSeconds?: number }): Promise<Ohlcv[]>;

  // TimescaleDB hypertable methods
  getForexTimescale(symbol: string, limit?: number, timeframeSeconds?: number, loadFromEnd?: boolean): Promise<Ohlcv[]>;
  getForexTimescaleRange(symbol: string, options: { startTime?: number; endTime?: number; limit?: number; timeframeSeconds?: number }): Promise<Ohlcv[]>;
  getFuturesTimescale(symbol: string, limit?: number, timeframeSeconds?: number, loadFromEnd?: boolean): Promise<Ohlcv[]>;
  getFuturesTimescaleRange(symbol: string, options: { startTime?: number; endTime?: number; limit?: number; timeframeSeconds?: number }): Promise<Ohlcv[]>;

  // Instrument metadata
  getInstrument(symbol: string): Promise<Instrument | undefined>;
  getAllInstruments(): Promise<Instrument[]>;
  getInstrumentsByType(assetType: 'futures' | 'forex'): Promise<Instrument[]>;

  // News articles
  createNewsArticle(article: InsertNewsArticle, symbols?: string[]): Promise<NewsArticle>;
  getNewsArticles(options?: { limit?: number; symbol?: string; source?: string; startDate?: Date; endDate?: Date }): Promise<NewsArticle[]>;
  getNewsArticleById(id: number): Promise<NewsArticle | undefined>;
  getNewsArticleByExternalId(externalId: string): Promise<NewsArticle | undefined>;
  updateNewsSentiment(id: number, sentimentScore: number, sentimentLabel: string, sentimentConfidence: number): Promise<void>;
  getNewsBySymbol(symbol: string, limit?: number): Promise<NewsArticle[]>;
  linkNewsToSymbols(newsId: number, symbols: string[], primarySymbol?: string): Promise<void>;

  // ML Observatory methods
  createMlModel(data: any): Promise<any>;
  getMlModels(status?: string): Promise<any[]>;
  getMlModel(id: number): Promise<any | undefined>;
  updateMlModel(id: number, data: Partial<any>): Promise<void>;
  createFeatureSet(data: any): Promise<any>;
  getFeatureSets(): Promise<any[]>;
  saveModelOutput(data: any): Promise<any>;
  saveModelOutputBatch(outputs: any[]): Promise<void>;
  getModelOutputs(modelId: number, symbol?: string, limit?: number): Promise<any[]>;
  getModelCoherence(symbol: string, startTime: number, endTime: number): Promise<any>;
  saveCoherenceSnapshot(data: any): Promise<any>;
  createEnsembleConfig(data: any): Promise<any>;
  getEnsembleConfigs(): Promise<any[]>;
  simulateEnsemble(ensembleId: number, symbol: string, startTime: number, endTime: number): Promise<any[]>;
  createTrade(data: any): Promise<any>;
  getTrades(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<any[]>;
  closeTrade(id: number, exitPrice: number, exitTimestamp: number): Promise<any>;
  createMarketRegime(data: any): Promise<any>;
  getMarketRegimes(): Promise<any[]>;
  recordRegimeHistory(data: any): Promise<any>;

  // Broker configs
  getBrokerConfigs(): Promise<any[]>;
  getBrokerConfig(id: number): Promise<any | undefined>;
  getBrokerConfigByName(name: string): Promise<any | undefined>;
  getDefaultBrokerConfig(assetType: string): Promise<any | undefined>;

  // Backtest runs
  createBacktestRun(data: any): Promise<any>;
  updateBacktestRun(id: number, data: Partial<any>): Promise<void>;
  getBacktestRuns(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<any[]>;
  getBacktestRun(id: number): Promise<any | undefined>;

  // Backtest trades
  insertBacktestTrades(trades: any[]): Promise<void>;
  getBacktestTrades(backtestRunId: number, limit?: number): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async insertOhlcvBatch(data: InsertOhlcv[]): Promise<void> {
    if (data.length === 0) return;
    
    const batchSize = 1000;
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      await db.insert(ohlcvData).values(batch);
    }
  }

  async getOhlcvData(symbol: string, startTime: number, endTime: number, limit: number = 10000): Promise<Ohlcv[]> {
    return db
      .select()
      .from(ohlcvData)
      .where(
        and(
          eq(ohlcvData.symbol, symbol),
          gte(ohlcvData.timestamp, startTime),
          lte(ohlcvData.timestamp, endTime)
        )
      )
      .orderBy(asc(ohlcvData.timestamp))
      .limit(limit);
  }

  async getLatestOhlcv(symbol: string, limit: number = 5000): Promise<Ohlcv[]> {
    // Always apply a limit to prevent loading millions of rows
    return db
      .select()
      .from(ohlcvData)
      .where(eq(ohlcvData.symbol, symbol))
      .orderBy(desc(ohlcvData.timestamp))
      .limit(limit);
  }

  async getOhlcvCount(symbol: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(ohlcvData)
      .where(eq(ohlcvData.symbol, symbol));
    return Number(result[0]?.count || 0);
  }

  async getOhlcvAggregated(symbol: string, limit: number = 500, timeframeSeconds: number = 60): Promise<Ohlcv[]> {
    const client = await pool.connect();
    
    try {
      const timeframeMs = timeframeSeconds * 1000;
      const timeWindowMultiplier = 20;
      
      const result = await client.query(`
        WITH max_ts AS (
          SELECT MAX(timestamp) as max_timestamp
          FROM ohlcv_data
          WHERE symbol = $1
        ),
        recent_data AS (
          SELECT o.*
          FROM ohlcv_data o, max_ts m
          WHERE o.symbol = $1 
            AND o.timestamp > m.max_timestamp - ($2::bigint * ${timeframeMs}::bigint * ${timeWindowMultiplier}::bigint)
        )
        SELECT 
          FLOOR(timestamp / ${timeframeMs})::bigint * ${timeframeMs} as timestamp,
          symbol,
          (array_agg(open ORDER BY timestamp ASC))[1] as open,
          MAX(high) as high,
          MIN(low) as low,
          (array_agg(close ORDER BY timestamp DESC))[1] as close,
          COALESCE(SUM(volume)::int, 0) as volume
        FROM recent_data
        GROUP BY FLOOR(timestamp / ${timeframeMs})::bigint, symbol
        ORDER BY timestamp DESC
        LIMIT $2
      `, [symbol, limit]);
      
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getOhlcvAggregatedRange(symbol: string, options: { startTime?: number; endTime?: number; limit?: number; timeframeSeconds?: number }): Promise<Ohlcv[]> {
    const client = await pool.connect();
    
    try {
      const timeframeMs = (options.timeframeSeconds || 60) * 1000;
      const candleLimit = options.limit || 2000;
      
      let whereClause = 'WHERE symbol = $1';
      const params: (string | number)[] = [symbol];
      let paramIndex = 2;
      
      if (options.endTime) {
        whereClause += ` AND timestamp <= $${paramIndex}`;
        params.push(options.endTime);
        paramIndex++;
      }
      
      if (options.startTime) {
        whereClause += ` AND timestamp >= $${paramIndex}`;
        params.push(options.startTime);
        paramIndex++;
      }
      
      params.push(candleLimit);
      
      // Order by DESC when loading historical (endTime only), ASC otherwise
      const orderDir = options.endTime && !options.startTime ? 'DESC' : 'ASC';
      
      const result = await client.query(`
        SELECT 
          FLOOR(timestamp / ${timeframeMs})::bigint * ${timeframeMs} as timestamp,
          symbol,
          (array_agg(open ORDER BY timestamp ASC))[1] as open,
          MAX(high) as high,
          MIN(low) as low,
          (array_agg(close ORDER BY timestamp DESC))[1] as close,
          COALESCE(SUM(volume)::int, 0) as volume
        FROM ohlcv_data
        ${whereClause}
        GROUP BY FLOOR(timestamp / ${timeframeMs})::bigint, symbol
        ORDER BY timestamp ${orderDir}
        LIMIT $${paramIndex}
      `, params);
      
      // Return in ascending order
      const rows = result.rows;
      if (orderDir === 'DESC') {
        rows.reverse();
      }
      return rows;
    } finally {
      client.release();
    }
  }

  async getOhlcvDataPaginated(symbol: string, offset: number, limit: number): Promise<Ohlcv[]> {
    return db
      .select()
      .from(ohlcvData)
      .where(eq(ohlcvData.symbol, symbol))
      .orderBy(asc(ohlcvData.timestamp))
      .limit(limit)
      .offset(offset);
  }

  async getDistinctSymbols(): Promise<string[]> {
    const result = await db
      .selectDistinct({ symbol: ohlcvData.symbol })
      .from(ohlcvData);
    return result.map(r => r.symbol);
  }

  async createUpload(upload: InsertUpload): Promise<Upload> {
    const [result] = await db
      .insert(uploads)
      .values(upload)
      .returning();
    return result;
  }

  async updateUploadStatus(id: number, status: string, recordCount?: number): Promise<void> {
    const updateData: any = { status };
    if (recordCount !== undefined) {
      updateData.recordCount = recordCount;
    }
    await db
      .update(uploads)
      .set(updateData)
      .where(eq(uploads.id, id));
  }

  async getUploads(): Promise<Upload[]> {
    return db
      .select()
      .from(uploads)
      .orderBy(desc(uploads.uploadedAt))
      .limit(50);
  }

  async saveFeatureImportance(data: InsertFeatureImportance[]): Promise<void> {
    if (data.length === 0) return;
    await db.insert(featureImportance).values(data);
  }

  async getFeatureImportance(modelName: string): Promise<FeatureImportance[]> {
    return db
      .select()
      .from(featureImportance)
      .where(eq(featureImportance.modelName, modelName))
      .orderBy(desc(featureImportance.importance));
  }

  async createContractRollover(rollover: InsertContractRollover): Promise<ContractRollover> {
    const [result] = await db
      .insert(contractRollovers)
      .values(rollover)
      .returning();
    return result;
  }

  async getContractRollovers(baseSymbol: string): Promise<ContractRollover[]> {
    return db
      .select()
      .from(contractRollovers)
      .where(eq(contractRollovers.baseSymbol, baseSymbol))
      .orderBy(asc(contractRollovers.rolloverTimestamp));
  }

  async detectVolumeRollovers(baseSymbol: string): Promise<ContractRollover[]> {
    // Only process futures symbols, not forex pairs
    const futuresBaseSymbols = ['ES', 'MES', 'NQ', 'MNQ', 'RTY', 'M2K', 'YM', 'MYM', 
                                 'CL', 'GC', 'SI', 'ZB', 'ZN', 'ZC', 'ZS', 'ZW'];
    const forexSymbols = ['EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD', 'USDCAD', 'USDCHF', 
                          'NZDUSD', 'EURJPY', 'GBPJPY', 'EURGBP', 'AUDJPY', 'EURAUD',
                          'EURCHF', 'AUDNZD', 'GBPAUD', 'GBPCHF', 'CADJPY'];
    
    // Skip if it's a forex pair
    if (forexSymbols.includes(baseSymbol.toUpperCase())) {
      return [];
    }
    
    // Only process known futures base symbols
    const upperBase = baseSymbol.toUpperCase();
    if (!futuresBaseSymbols.some(f => upperBase === f || upperBase.startsWith(f))) {
      return [];
    }
    
    const existingRollovers = await this.getContractRollovers(baseSymbol);
    const newRollovers: ContractRollover[] = [];

    const contracts = await db
      .selectDistinct({ symbol: ohlcvData.symbol })
      .from(ohlcvData)
      .where(sql`${ohlcvData.symbol} LIKE ${baseSymbol + '%'}`);

    if (contracts.length < 2) {
      return existingRollovers;
    }

    const parseFuturesCode = (symbol: string, base: string): { month: string; year: number } | null => {
      const suffix = symbol.slice(base.length);
      if (suffix.length < 3) return null;
      
      const monthCode = suffix[0].toUpperCase();
      const yearStr = suffix.slice(1);
      
      let year = parseInt(yearStr);
      if (yearStr.length === 2) {
        year = year >= 50 ? 1900 + year : 2000 + year;
      }
      
      return { month: monthCode, year };
    };

    const monthOrder: Record<string, number> = {
      'F': 1, 'G': 2, 'H': 3, 'J': 4, 'K': 5, 'M': 6,
      'N': 7, 'Q': 8, 'U': 9, 'V': 10, 'X': 11, 'Z': 12
    };

    const sortedContracts = contracts
      .map(c => c.symbol)
      .filter(s => s.length > baseSymbol.length)
      .map(symbol => ({ symbol, parsed: parseFuturesCode(symbol, baseSymbol) }))
      .filter(c => c.parsed !== null)
      .sort((a, b) => {
        const pa = a.parsed!;
        const pb = b.parsed!;
        if (pa.year !== pb.year) return pa.year - pb.year;
        return (monthOrder[pa.month] || 0) - (monthOrder[pb.month] || 0);
      })
      .map(c => c.symbol);

    for (let i = 0; i < sortedContracts.length - 1; i++) {
      const currentContract = sortedContracts[i];
      const nextContract = sortedContracts[i + 1];

      const existsAlready = existingRollovers.some(
        r => r.fromContract === currentContract && r.toContract === nextContract
      );

      if (existsAlready) continue;

      const currentData = await db
        .select()
        .from(ohlcvData)
        .where(eq(ohlcvData.symbol, currentContract))
        .orderBy(asc(ohlcvData.timestamp))
        .limit(5000);

      const nextData = await db
        .select()
        .from(ohlcvData)
        .where(eq(ohlcvData.symbol, nextContract))
        .orderBy(asc(ohlcvData.timestamp))
        .limit(5000);

      if (currentData.length === 0 || nextData.length === 0) continue;

      let rolloverPoint: { timestamp: number; fromClose: number; toClose: number; ratio: number } | null = null;

      for (const currentBar of currentData) {
        const matchingNext = nextData.find(n =>
          Math.abs(n.timestamp - currentBar.timestamp) < 60000
        );

        if (matchingNext && matchingNext.volume > currentBar.volume) {
          const fromClose = currentBar.close;
          const toClose = matchingNext.close;
          const ratio = fromClose !== 0 ? toClose / fromClose : 1;
          rolloverPoint = { timestamp: currentBar.timestamp, fromClose, toClose, ratio };
          break;
        }
      }

      if (rolloverPoint) {
        const newRollover = await this.createContractRollover({
          baseSymbol,
          fromContract: currentContract,
          toContract: nextContract,
          rolloverTimestamp: rolloverPoint.timestamp,
          fromClose: rolloverPoint.fromClose,
          toClose: rolloverPoint.toClose,
          ratio: rolloverPoint.ratio,
          rolloverType: "volume",
        });
        newRollovers.push(newRollover);
      }
    }

    return [...existingRollovers, ...newRollovers];
  }

  async createTrainingSession(session: InsertTrainingSession): Promise<TrainingSession> {
    const [result] = await db
      .insert(trainingSessions)
      .values(session)
      .returning();
    return result;
  }

  async updateTrainingSession(id: number, data: Partial<TrainingSession>): Promise<void> {
    await db
      .update(trainingSessions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(trainingSessions.id, id));
  }

  async getActiveTrainingSession(): Promise<TrainingSession | undefined> {
    const [session] = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.status, "running"))
      .orderBy(desc(trainingSessions.startedAt))
      .limit(1);
    return session || undefined;
  }

  async getTrainingSession(id: number): Promise<TrainingSession | undefined> {
    const [session] = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, id));
    return session || undefined;
  }

  async addLossHistory(entry: InsertLossHistory): Promise<LossHistory> {
    const [result] = await db
      .insert(lossHistory)
      .values(entry)
      .returning();
    return result;
  }

  async getLossHistory(sessionId: number): Promise<LossHistory[]> {
    return db
      .select()
      .from(lossHistory)
      .where(eq(lossHistory.sessionId, sessionId))
      .orderBy(asc(lossHistory.epoch));
  }

  async insertOhlcvPartitioned(data: InsertOhlcv[], symbol: string, skipLegacyTable: boolean = true): Promise<void> {
    if (data.length === 0) return;
    
    const assetType = getAssetType(symbol);
    const client = await pool.connect();
    
    try {
      const batchSize = 500;
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const placeholders: string[] = [];
        const values: (string | number)[] = [];
        
        batch.forEach((d, idx) => {
          const offset = idx * 8;
          placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`);
          values.push(d.symbol, assetType, d.timestamp, d.open, d.high, d.low, d.close, d.volume);
        });
        
        await client.query(`
          INSERT INTO ohlcv_partitioned (symbol, asset_type, timestamp, open, high, low, close, volume)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (symbol, asset_type, timestamp) DO NOTHING
        `, values);
      }
    } finally {
      client.release();
    }
    
    if (!skipLegacyTable) {
      await this.insertOhlcvBatch(data);
    }
  }

  async getOhlcvPartitioned(symbol: string, limit?: number, timeframeSeconds: number = 60): Promise<Ohlcv[]> {
    const assetType = getAssetType(symbol);
    const client = await pool.connect();
    
    try {
      const timeframeMs = timeframeSeconds * 1000;
      const candleLimit = limit || 500;
      
      // Use subquery with pre-aggregated data and LIMIT to efficiently fetch candles
      // Multiply time range by 20x to account for market hours gaps (futures only trade ~6h/day)
      const timeWindowMultiplier = 20;
      const result = await client.query(`
        WITH max_ts AS (
          SELECT MAX(timestamp) as max_timestamp
          FROM ohlcv_partitioned
          WHERE symbol = $1 AND asset_type = $2
        ),
        recent_data AS (
          SELECT o.*
          FROM ohlcv_partitioned o, max_ts m
          WHERE o.symbol = $1 
            AND o.asset_type = $2
            AND o.timestamp > m.max_timestamp - ($3::bigint * ${timeframeMs}::bigint * ${timeWindowMultiplier}::bigint)
            AND CASE 
              WHEN o.asset_type = 'forex' THEN o.close > 0.3 AND o.close < 300
              ELSE o.close > 100 AND o.close < 500000
            END
            AND CASE 
              WHEN o.asset_type = 'forex' THEN o.high > 0.3 AND o.high < 300
              ELSE o.high > 100 AND o.high < 500000
            END
            AND CASE 
              WHEN o.asset_type = 'forex' THEN o.low > 0.3 AND o.low < 300
              ELSE o.low > 100 AND o.low < 500000
            END
        )
        SELECT 
          FLOOR(timestamp / ${timeframeMs})::bigint * ${timeframeMs} as timestamp,
          symbol,
          (array_agg(open ORDER BY timestamp ASC))[1] as open,
          MAX(high) as high,
          MIN(low) as low,
          (array_agg(close ORDER BY timestamp DESC))[1] as close,
          SUM(volume)::int as volume
        FROM recent_data
        GROUP BY FLOOR(timestamp / ${timeframeMs})::bigint, symbol
        ORDER BY timestamp DESC
        LIMIT $3
      `, [symbol, assetType, candleLimit]);
      
      return result.rows;
    } finally {
      client.release();
    }
  }

  async getOhlcvPartitionedRange(symbol: string, options: { startTime?: number; endTime?: number; limit?: number; timeframeSeconds?: number }): Promise<Ohlcv[]> {
    const assetType = getAssetType(symbol);
    const client = await pool.connect();
    
    try {
      const timeframeMs = (options.timeframeSeconds || 60) * 1000;
      const candleLimit = options.limit || 2000;
      
      // Use asset-type aware price validation: forex 0.3-300, futures 100-500000
      const priceFilter = assetType === 'forex'
        ? 'AND close > 0.3 AND close < 300 AND high > 0.3 AND high < 300 AND low > 0.3 AND low < 300'
        : 'AND close > 100 AND close < 500000 AND high > 100 AND high < 500000 AND low > 100 AND low < 500000';
      let whereClause = `WHERE symbol = $1 AND asset_type = $2 ${priceFilter}`;
      const params: (string | number)[] = [symbol, assetType];
      let paramIndex = 3;
      
      if (options.endTime) {
        whereClause += ` AND timestamp <= $${paramIndex}`;
        params.push(options.endTime);
        paramIndex++;
      }
      
      if (options.startTime) {
        whereClause += ` AND timestamp >= $${paramIndex}`;
        params.push(options.startTime);
        paramIndex++;
      }
      
      params.push(candleLimit);
      
      const orderDir = options.endTime && !options.startTime ? 'DESC' : 'ASC';
      
      const result = await client.query(`
        SELECT 
          FLOOR(timestamp / ${timeframeMs})::bigint * ${timeframeMs} as timestamp,
          symbol,
          (array_agg(open ORDER BY timestamp ASC))[1] as open,
          MAX(high) as high,
          MIN(low) as low,
          (array_agg(close ORDER BY timestamp DESC))[1] as close,
          SUM(volume)::int as volume
        FROM ohlcv_partitioned
        ${whereClause}
        GROUP BY FLOOR(timestamp / ${timeframeMs})::bigint, symbol
        ORDER BY timestamp ${orderDir}
        LIMIT $${paramIndex}
      `, params);
      
      // Always return in ascending order
      const rows = result.rows;
      if (orderDir === 'DESC') {
        return rows.reverse();
      }
      return rows;
    } finally {
      client.release();
    }
  }

  // ── TimescaleDB hypertable queries ──────────────────────────────────

  /**
   * Query forex_1m hypertable with time_bucket aggregation.
   * Returns latest N candles for the given symbol/timeframe.
   */
  async getForexTimescale(symbol: string, limit: number = 500, timeframeSeconds: number = 60, loadFromEnd: boolean = true): Promise<Ohlcv[]> {
    const client = await pool.connect();
    try {
      const interval = `${timeframeSeconds} seconds`;
      const orderDir = loadFromEnd ? 'DESC' : 'ASC';
      const result = await client.query(`
        SELECT
          EXTRACT(EPOCH FROM time_bucket($2::interval, ts))::bigint * 1000 AS timestamp,
          $1::text AS symbol,
          (array_agg(open ORDER BY ts ASC))[1] AS open,
          MAX(high) AS high,
          MIN(low) AS low,
          (array_agg(close ORDER BY ts DESC))[1] AS close,
          COALESCE(SUM(volume)::int, 0) AS volume
        FROM forex_1m
        WHERE symbol = $1
        GROUP BY time_bucket($2::interval, ts)
        ORDER BY timestamp ${orderDir}
        LIMIT $3
      `, [symbol, interval, limit]);
      const rows = result.rows;
      // When loading from end (DESC), reverse to chronological order
      if (loadFromEnd) rows.reverse();
      return rows;
    } finally {
      client.release();
    }
  }

  /**
   * Query forex_1m hypertable with time range and aggregation.
   */
  async getForexTimescaleRange(symbol: string, options: { startTime?: number; endTime?: number; limit?: number; timeframeSeconds?: number }): Promise<Ohlcv[]> {
    const client = await pool.connect();
    try {
      const timeframeSec = options.timeframeSeconds || 60;
      const interval = `${timeframeSec} seconds`;
      const candleLimit = options.limit || 2000;

      let whereClause = 'WHERE symbol = $1';
      const params: (string | number)[] = [symbol, interval];
      let paramIndex = 3;

      if (options.endTime) {
        whereClause += ` AND ts <= to_timestamp($${paramIndex})`;
        params.push(options.endTime / 1000);
        paramIndex++;
      }
      if (options.startTime) {
        whereClause += ` AND ts >= to_timestamp($${paramIndex})`;
        params.push(options.startTime / 1000);
        paramIndex++;
      }

      params.push(candleLimit);
      const orderDir = options.endTime && !options.startTime ? 'DESC' : 'ASC';

      const result = await client.query(`
        SELECT
          EXTRACT(EPOCH FROM time_bucket($2::interval, ts))::bigint * 1000 AS timestamp,
          $1::text AS symbol,
          (array_agg(open ORDER BY ts ASC))[1] AS open,
          MAX(high) AS high,
          MIN(low) AS low,
          (array_agg(close ORDER BY ts DESC))[1] AS close,
          COALESCE(SUM(volume)::int, 0) AS volume
        FROM forex_1m
        ${whereClause}
        GROUP BY time_bucket($2::interval, ts)
        ORDER BY timestamp ${orderDir}
        LIMIT $${paramIndex}
      `, params);

      const rows = result.rows;
      if (orderDir === 'DESC') rows.reverse();
      return rows;
    } finally {
      client.release();
    }
  }

  // Cache max timestamps per symbol to avoid repeated index scans on 154M+ rows.
  // 60s TTL - stale by at most 1 minute for the "latest data" use case.
  private maxTsCache = new Map<string, { ts: Date; cachedAt: number }>();
  private static MAX_TS_CACHE_TTL = 60_000;

  private async getMaxTimestamp(client: any, symbol: string, isBaseSymbol: boolean): Promise<Date | null> {
    const cached = this.maxTsCache.get(symbol);
    if (cached && Date.now() - cached.cachedAt < DatabaseStorage.MAX_TS_CACHE_TTL) {
      return cached.ts;
    }
    const col = isBaseSymbol ? 'base_symbol' : 'symbol';
    const result = await client.query(
      `SELECT ts FROM ohlcv_1s WHERE ${col} = $1 ORDER BY ts DESC LIMIT 1`, [symbol]
    );
    if (result.rows.length === 0) return null;
    const ts = result.rows[0].ts;
    this.maxTsCache.set(symbol, { ts, cachedAt: Date.now() });
    return ts;
  }

  /**
   * Build continuous (stitched) data for a base symbol using the optimal source:
   * - For daily+ timeframes: use daily_ohlcv continuous aggregate + manual stitching
   * - For hourly timeframes (1h, 4h): use hourly_ohlcv continuous aggregate + manual stitching
   * - For intraday (<1h): use the continuous_contract view directly
   */
  private async getContinuousData(client: any, baseSymbol: string, limit: number, timeframeSeconds: number): Promise<Ohlcv[]> {
    const interval = `${timeframeSeconds} seconds`;
    const maxTs = await this.getMaxTimestamp(client, baseSymbol, true);
    if (!maxTs) return [];

    // For intraday (<= 30m), use the continuous_contract view directly.
    // It's efficient enough for small time windows.
    if (timeframeSeconds < 3600) {
      const bufferMultiplier = 3;
      const windowSeconds = limit * timeframeSeconds * bufferMultiplier;
      const result = await client.query(`
        SELECT
          EXTRACT(EPOCH FROM time_bucket($2::interval, ts))::bigint * 1000 AS timestamp,
          symbol,
          first(open, ts) AS open,
          MAX(high) AS high,
          MIN(low) AS low,
          last(close, ts) AS close,
          COALESCE(SUM(volume)::bigint, 0) AS volume
        FROM continuous_contract
        WHERE symbol = $1
          AND ts >= $3::timestamptz - make_interval(secs => $4::int)
        GROUP BY time_bucket($2::interval, ts), symbol
        ORDER BY timestamp DESC
        LIMIT $5
      `, [baseSymbol, interval, maxTs, windowSeconds, limit]);
      return result.rows;
    }

    // For hourly+ timeframes, use per-segment queries on continuous aggregates.
    // Falls back to continuous_contract view if aggregates aren't populated yet.
    const useDaily = timeframeSeconds >= 86400;
    const aggTable = useDaily ? 'daily_ohlcv' : 'hourly_ohlcv';
    const aggBucketCol = 'bucket';

    // Check if the aggregate has data (fast - checks a single row)
    const aggCheck = await client.query(`SELECT 1 FROM ${aggTable} LIMIT 1`);
    if (aggCheck.rows.length === 0) {
      // Aggregate not populated yet - fall back to continuous_contract view
      // with a tighter window to keep it performant
      const fallbackWindow = Math.min(limit * timeframeSeconds * 2, 90 * 86400); // cap 90 days
      const result = await client.query(`
        SELECT
          EXTRACT(EPOCH FROM time_bucket($2::interval, ts))::bigint * 1000 AS timestamp,
          symbol,
          first(open, ts) AS open,
          MAX(high) AS high,
          MIN(low) AS low,
          last(close, ts) AS close,
          COALESCE(SUM(volume)::bigint, 0) AS volume
        FROM continuous_contract
        WHERE symbol = $1
          AND ts >= $3::timestamptz - make_interval(secs => $4::int)
        GROUP BY time_bucket($2::interval, ts), symbol
        ORDER BY timestamp DESC
        LIMIT $5
      `, [baseSymbol, interval, maxTs, fallbackWindow, limit]);
      return result.rows;
    }

    // Get the active contract schedule and cumulative adjustments
    const bufferMult = useDaily ? 1.5 : 2;
    const windowSeconds = Math.min(limit * timeframeSeconds * bufferMult, 15 * 365 * 86400);
    const windowStart = new Date(maxTs.getTime() - windowSeconds * 1000);

    const [scheduleRes, adjRes] = await Promise.all([
      client.query(`
        SELECT active_contract, start_date, end_date
        FROM active_contract_schedule
        WHERE base_symbol = $1 AND end_date >= $2::date
        ORDER BY start_date ASC
      `, [baseSymbol, windowStart]),
      client.query(`
        SELECT to_contract, COALESCE(cumulative_adjustment, 0) AS adj
        FROM cumulative_adjustments
        WHERE base_symbol = $1
      `, [baseSymbol])
    ]);

    const schedule = scheduleRes.rows;
    const adjMap = new Map<string, number>();
    for (const row of adjRes.rows) {
      adjMap.set(row.to_contract, parseFloat(row.adj));
    }

    if (schedule.length === 0) return [];

    // Build per-segment queries using the continuous aggregate
    const allRows: any[] = [];
    for (const seg of schedule) {
      const adj = adjMap.get(seg.active_contract) || 0;
      const segStart = new Date(Math.max(seg.start_date.getTime(), windowStart.getTime()));
      const segEnd = seg.end_date;

      const result = await client.query(`
        SELECT
          EXTRACT(EPOCH FROM time_bucket($1::interval, ${aggBucketCol}))::bigint * 1000 AS timestamp,
          $2::text AS symbol,
          first(open, ${aggBucketCol}) + $5::float AS open,
          MAX(high) + $5::float AS high,
          MIN(low) + $5::float AS low,
          last(close, ${aggBucketCol}) + $5::float AS close,
          COALESCE(SUM(volume)::bigint, 0) AS volume
        FROM ${aggTable}
        WHERE symbol = $3
          AND ${aggBucketCol} >= $4::timestamptz
          AND ${aggBucketCol} < $6::timestamptz
        GROUP BY time_bucket($1::interval, ${aggBucketCol})
        ORDER BY timestamp ASC
      `, [interval, baseSymbol, seg.active_contract, segStart, adj, segEnd]);

      allRows.push(...result.rows);
    }

    // Sort descending and take the limit
    allRows.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    return allRows.slice(0, limit);
  }

  /**
   * Query ohlcv_1s hypertable for futures with time_bucket aggregation.
   * Supports both base symbols (ES -> continuous) and specific contracts (ESH24).
   */
  async getFuturesTimescale(symbol: string, limit: number = 500, timeframeSeconds: number = 60, loadFromEnd: boolean = true): Promise<Ohlcv[]> {
    const client = await pool.connect();
    try {
      const interval = `${timeframeSeconds} seconds`;
      const isBaseSymbol = FUTURES_SYMBOLS.includes(symbol);

      // For base symbols, use stitched continuous data.
      if (isBaseSymbol) {
        return await this.getContinuousData(client, symbol, limit, timeframeSeconds);
      }

      // For specific contracts (ESH24), query ohlcv_1s directly
      const orderDir = loadFromEnd ? 'DESC' : 'ASC';
      if (loadFromEnd) {
        const maxTs = await this.getMaxTimestamp(client, symbol, false);
        if (!maxTs) return [];
        const bufferMult = timeframeSeconds >= 86400 ? 1.5 : 3;
        const windowSeconds = Math.min(limit * timeframeSeconds * bufferMult, 5 * 365 * 86400);

        const result = await client.query(`
          SELECT
            EXTRACT(EPOCH FROM time_bucket($2::interval, ts))::bigint * 1000 AS timestamp,
            $1::text AS symbol,
            (array_agg(open ORDER BY ts ASC))[1] AS open,
            MAX(high) AS high,
            MIN(low) AS low,
            (array_agg(close ORDER BY ts DESC))[1] AS close,
            COALESCE(SUM(volume)::bigint, 0) AS volume
          FROM ohlcv_1s
          WHERE symbol = $1
            AND ts >= $3::timestamptz - make_interval(secs => $4::int)
          GROUP BY time_bucket($2::interval, ts)
          ORDER BY timestamp DESC
          LIMIT $5
        `, [symbol, interval, maxTs, windowSeconds, limit]);
        const rows = result.rows;
        rows.reverse();
        return rows;
      } else {
        // Load from start - get earliest data
        const result = await client.query(`
          SELECT
            EXTRACT(EPOCH FROM time_bucket($2::interval, ts))::bigint * 1000 AS timestamp,
            $1::text AS symbol,
            (array_agg(open ORDER BY ts ASC))[1] AS open,
            MAX(high) AS high,
            MIN(low) AS low,
            (array_agg(close ORDER BY ts DESC))[1] AS close,
            COALESCE(SUM(volume)::bigint, 0) AS volume
          FROM ohlcv_1s
          WHERE symbol = $1
          GROUP BY time_bucket($2::interval, ts)
          ORDER BY timestamp ASC
          LIMIT $3
        `, [symbol, interval, limit]);
        return result.rows;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Query ohlcv_1s hypertable for futures with time range and aggregation.
   */
  async getFuturesTimescaleRange(symbol: string, options: { startTime?: number; endTime?: number; limit?: number; timeframeSeconds?: number }): Promise<Ohlcv[]> {
    const client = await pool.connect();
    try {
      const timeframeSec = options.timeframeSeconds || 60;
      const interval = `${timeframeSec} seconds`;
      const candleLimit = options.limit || 2000;
      const isBaseSymbol = FUTURES_SYMBOLS.includes(symbol);

      // Use continuous_contract view for base symbols (handles stitching),
      // or ohlcv_1s directly for specific contracts.
      const table = isBaseSymbol ? 'continuous_contract' : 'ohlcv_1s';
      const symbolFilter = 'symbol = $1';

      let whereClause = `WHERE ${symbolFilter}`;
      const params: (string | number)[] = [symbol, interval];
      let paramIndex = 3;

      if (options.endTime) {
        whereClause += ` AND ts <= to_timestamp($${paramIndex})`;
        params.push(options.endTime / 1000);
        paramIndex++;
      }
      if (options.startTime) {
        whereClause += ` AND ts >= to_timestamp($${paramIndex})`;
        params.push(options.startTime / 1000);
        paramIndex++;
      }

      params.push(candleLimit);
      const orderDir = options.endTime && !options.startTime ? 'DESC' : 'ASC';

      const result = await client.query(`
        SELECT
          EXTRACT(EPOCH FROM time_bucket($2::interval, ts))::bigint * 1000 AS timestamp,
          $1::text AS symbol,
          (array_agg(open ORDER BY ts ASC))[1] AS open,
          MAX(high) AS high,
          MIN(low) AS low,
          (array_agg(close ORDER BY ts DESC))[1] AS close,
          COALESCE(SUM(volume)::bigint, 0) AS volume
        FROM ${table}
        ${whereClause}
        GROUP BY time_bucket($2::interval, ts)
        ORDER BY timestamp ${orderDir}
        LIMIT $${paramIndex}
      `, params);

      const rows = result.rows;
      if (orderDir === 'DESC') rows.reverse();
      return rows;
    } finally {
      client.release();
    }
  }

  async getInstrument(symbol: string): Promise<Instrument | undefined> {
    const normalizedSymbol = symbol.toUpperCase();
    const [instrument] = await db.select().from(instruments).where(eq(instruments.symbol, normalizedSymbol));
    return instrument || undefined;
  }

  async getAllInstruments(): Promise<Instrument[]> {
    return await db.select().from(instruments).orderBy(instruments.assetType, instruments.symbol);
  }

  async getInstrumentsByType(assetType: 'futures' | 'forex'): Promise<Instrument[]> {
    return await db.select().from(instruments).where(eq(instruments.assetType, assetType)).orderBy(instruments.symbol);
  }

  async createNewsArticle(article: InsertNewsArticle, symbols?: string[]): Promise<NewsArticle> {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(newsArticles).values(article).returning();
      
      if (symbols && symbols.length > 0) {
        const entries = symbols.map(symbol => ({
          newsId: created.id,
          symbol: symbol.toUpperCase(),
          isPrimary: symbol.toUpperCase() === symbols[0].toUpperCase() ? 1 : 0
        }));
        await tx.insert(newsSymbols).values(entries);
      }
      
      return created;
    });
  }

  async getNewsArticles(options?: { limit?: number; symbol?: string; source?: string; startDate?: Date; endDate?: Date }): Promise<NewsArticle[]> {
    const limit = options?.limit ?? 100;
    
    if (options?.symbol) {
      return this.getNewsBySymbol(options.symbol, limit);
    }
    
    let query = db.select().from(newsArticles);
    
    const conditions = [];
    if (options?.source) {
      conditions.push(eq(newsArticles.source, options.source));
    }
    if (options?.startDate) {
      conditions.push(gte(newsArticles.publishedAt, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(newsArticles.publishedAt, options.endDate));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    
    return await query.orderBy(desc(newsArticles.publishedAt)).limit(limit);
  }

  async getNewsArticleById(id: number): Promise<NewsArticle | undefined> {
    const [article] = await db.select().from(newsArticles).where(eq(newsArticles.id, id));
    return article || undefined;
  }

  async getNewsArticleByExternalId(externalId: string): Promise<NewsArticle | undefined> {
    const [article] = await db.select().from(newsArticles).where(eq(newsArticles.externalId, externalId));
    return article || undefined;
  }

  async updateNewsSentiment(id: number, sentimentScore: number, sentimentLabel: string, sentimentConfidence: number): Promise<void> {
    await db.update(newsArticles)
      .set({ sentimentScore, sentimentLabel, sentimentConfidence })
      .where(eq(newsArticles.id, id));
  }

  async getNewsBySymbol(symbol: string, limit: number = 50): Promise<NewsArticle[]> {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT na.* 
        FROM news_articles na
        JOIN news_symbols ns ON na.id = ns.news_id
        WHERE ns.symbol = $1
        ORDER BY na.published_at DESC
        LIMIT $2
      `, [symbol.toUpperCase(), limit]);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async linkNewsToSymbols(newsId: number, symbols: string[], primarySymbol?: string): Promise<void> {
    const entries = symbols.map(symbol => ({
      newsId,
      symbol: symbol.toUpperCase(),
      isPrimary: primarySymbol && symbol.toUpperCase() === primarySymbol.toUpperCase() ? 1 : 0
    }));
    
    await db.insert(newsSymbols).values(entries);
  }

  // ============================================================
  // ML OBSERVATORY METHODS
  // ============================================================

  // ML Models
  async createMlModel(data: any): Promise<any> {
    const result = await pool.query(`
      INSERT INTO ml_models (name, version, architecture, description, hyperparameters, feature_set_id, 
        training_data_start, training_data_end, validation_split, target_column, target_horizon, metrics, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      data.name, data.version || '1.0.0', data.architecture, data.description,
      data.hyperparameters ? JSON.stringify(data.hyperparameters) : null,
      data.featureSetId, data.trainingDataStart, data.trainingDataEnd,
      data.validationSplit || 0.2, data.targetColumn, data.targetHorizon,
      data.metrics ? JSON.stringify(data.metrics) : null, data.status || 'draft'
    ]);
    return result.rows[0];
  }

  async getMlModels(status?: string): Promise<any[]> {
    let query = 'SELECT * FROM ml_models';
    const params: any[] = [];
    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }
    query += ' ORDER BY updated_at DESC';
    const result = await pool.query(query, params);
    return result.rows;
  }

  async getMlModel(id: number): Promise<any | undefined> {
    const result = await pool.query('SELECT * FROM ml_models WHERE id = $1', [id]);
    return result.rows[0];
  }

  async updateMlModel(id: number, data: Partial<any>): Promise<void> {
    // Allowlist of valid column names to prevent SQL injection via dynamic keys
    const ALLOWED_COLUMNS = new Set([
      'name', 'architecture', 'status', 'description', 'hyperparameters',
      'metrics', 'training_config', 'version', 'symbol', 'timeframe',
      'feature_set_id', 'accuracy', 'loss', 'val_loss', 'epochs_completed',
      'total_epochs', 'learning_rate', 'batch_size', 'sequence_length',
      'model_path', 'notes'
    ]);

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(data)) {
      const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      if (!ALLOWED_COLUMNS.has(snakeKey)) {
        console.warn(`updateMlModel: rejected unknown column "${snakeKey}" from key "${key}"`);
        continue;
      }
      setClauses.push(`"${snakeKey}" = $${paramCount}`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
      paramCount++;
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    await pool.query(
      `UPDATE ml_models SET ${setClauses.join(', ')} WHERE id = $${paramCount}`,
      values
    );
  }

  // Feature Sets
  async createFeatureSet(data: any): Promise<any> {
    const result = await pool.query(`
      INSERT INTO feature_sets (name, description, features, normalization, lag_periods, 
        technical_indicators, symbols, timeframe, lookback_bars)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      data.name, data.description,
      JSON.stringify(data.features),
      data.normalization ? JSON.stringify(data.normalization) : null,
      data.lagPeriods ? JSON.stringify(data.lagPeriods) : null,
      data.technicalIndicators ? JSON.stringify(data.technicalIndicators) : null,
      data.symbols ? JSON.stringify(data.symbols) : null,
      data.timeframe, data.lookbackBars || 100
    ]);
    return result.rows[0];
  }

  async getFeatureSets(): Promise<any[]> {
    const result = await pool.query('SELECT * FROM feature_sets ORDER BY created_at DESC');
    return result.rows;
  }

  // Model Outputs
  async saveModelOutput(data: any): Promise<any> {
    const result = await pool.query(`
      INSERT INTO model_outputs (model_id, symbol, timestamp, prediction, prediction_label, 
        confidence, probabilities, features)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      data.modelId, data.symbol, data.timestamp, data.prediction,
      data.predictionLabel, data.confidence,
      data.probabilities ? JSON.stringify(data.probabilities) : null,
      data.features ? JSON.stringify(data.features) : null
    ]);
    return result.rows[0];
  }

  async saveModelOutputBatch(outputs: any[]): Promise<void> {
    if (outputs.length === 0) return;
    
    const values = outputs.map((o, i) => {
      const offset = i * 8;
      return `($${offset+1}, $${offset+2}, $${offset+3}, $${offset+4}, $${offset+5}, $${offset+6}, $${offset+7}, $${offset+8})`;
    }).join(', ');

    const params = outputs.flatMap(o => [
      o.modelId, o.symbol, o.timestamp, o.prediction,
      o.predictionLabel, o.confidence,
      o.probabilities ? JSON.stringify(o.probabilities) : null,
      o.features ? JSON.stringify(o.features) : null
    ]);

    await pool.query(`
      INSERT INTO model_outputs (model_id, symbol, timestamp, prediction, prediction_label, 
        confidence, probabilities, features)
      VALUES ${values}
    `, params);
  }

  async getModelOutputs(modelId: number, symbol?: string, limit: number = 1000): Promise<any[]> {
    let query = 'SELECT * FROM model_outputs WHERE model_id = $1';
    const params: any[] = [modelId];
    
    if (symbol) {
      query += ' AND symbol = $2';
      params.push(symbol);
    }
    
    query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    
    const result = await pool.query(query, params);
    return result.rows;
  }

  // Coherence Analysis
  async getModelCoherence(symbol: string, startTime: number, endTime: number): Promise<any> {
    // Get all model outputs for the time range
    const result = await pool.query(`
      SELECT mo.*, m.name as model_name, m.architecture
      FROM model_outputs mo
      JOIN ml_models m ON mo.model_id = m.id
      WHERE mo.symbol = $1 AND mo.timestamp >= $2 AND mo.timestamp <= $3
      ORDER BY mo.timestamp, mo.model_id
    `, [symbol, startTime, endTime]);

    // Group by timestamp and calculate agreement
    const byTimestamp = new Map<number, any[]>();
    for (const row of result.rows) {
      const ts = row.timestamp;
      if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
      byTimestamp.get(ts)!.push(row);
    }

    const coherenceData = [];
    for (const [timestamp, outputs] of Array.from(byTimestamp)) {
      if (outputs.length < 2) continue;
      
      // Calculate pairwise agreement
      let agreements = 0;
      let comparisons = 0;
      for (let i = 0; i < outputs.length; i++) {
        for (let j = i + 1; j < outputs.length; j++) {
          const sameDirection = 
            (outputs[i].prediction > 0 && outputs[j].prediction > 0) ||
            (outputs[i].prediction < 0 && outputs[j].prediction < 0) ||
            (outputs[i].prediction === 0 && outputs[j].prediction === 0);
          if (sameDirection) agreements++;
          comparisons++;
        }
      }

      const agreementRate = comparisons > 0 ? agreements / comparisons : 0;
      const avgConfidence = outputs.reduce((sum: number, o: any) => sum + (o.confidence || 0), 0) / outputs.length;
      
      coherenceData.push({
        timestamp,
        modelCount: outputs.length,
        agreementRate,
        avgConfidence,
        divergenceScore: 1 - agreementRate,
        models: outputs.map((o: any) => ({
          modelId: o.model_id,
          modelName: o.model_name,
          prediction: o.prediction,
          label: o.prediction_label,
          confidence: o.confidence
        }))
      });
    }

    return coherenceData;
  }

  async saveCoherenceSnapshot(data: any): Promise<any> {
    const result = await pool.query(`
      INSERT INTO coherence_snapshots (timestamp, symbol, model_correlations, agreement_matrix,
        ensemble_signal, ensemble_confidence, divergence_score)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      data.timestamp, data.symbol,
      JSON.stringify(data.modelCorrelations),
      JSON.stringify(data.agreementMatrix),
      data.ensembleSignal, data.ensembleConfidence, data.divergenceScore
    ]);
    return result.rows[0];
  }

  // Ensemble Configs
  async createEnsembleConfig(data: any): Promise<any> {
    const result = await pool.query(`
      INSERT INTO ensemble_configs (name, description, model_ids, weights, aggregation_method,
        confidence_threshold, unanimity_required, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      data.name, data.description,
      JSON.stringify(data.modelIds),
      data.weights ? JSON.stringify(data.weights) : null,
      data.aggregationMethod || 'vote',
      data.confidenceThreshold || 0.5,
      data.unanimityRequired || 0,
      data.status || 'active'
    ]);
    return result.rows[0];
  }

  async getEnsembleConfigs(): Promise<any[]> {
    const result = await pool.query('SELECT * FROM ensemble_configs WHERE status = $1 ORDER BY created_at DESC', ['active']);
    return result.rows;
  }

  async simulateEnsemble(ensembleId: number, symbol: string, startTime: number, endTime: number): Promise<any[]> {
    // Get ensemble config
    const configResult = await pool.query('SELECT * FROM ensemble_configs WHERE id = $1', [ensembleId]);
    if (configResult.rows.length === 0) return [];
    
    const config = configResult.rows[0];
    const modelIds = JSON.parse(config.model_ids);
    const weights = config.weights ? JSON.parse(config.weights) : null;

    // Get outputs from all models in ensemble
    const result = await pool.query(`
      SELECT mo.*, m.name as model_name
      FROM model_outputs mo
      JOIN ml_models m ON mo.model_id = m.id
      WHERE mo.model_id = ANY($1) AND mo.symbol = $2 
        AND mo.timestamp >= $3 AND mo.timestamp <= $4
      ORDER BY mo.timestamp
    `, [modelIds, symbol, startTime, endTime]);

    // Group by timestamp
    const byTimestamp = new Map<number, any[]>();
    for (const row of result.rows) {
      const ts = row.timestamp;
      if (!byTimestamp.has(ts)) byTimestamp.set(ts, []);
      byTimestamp.get(ts)!.push(row);
    }

    // Calculate ensemble signals
    const signals = [];
    for (const [timestamp, outputs] of Array.from(byTimestamp)) {
      let signal = 0;
      let totalWeight = 0;

      for (const output of outputs) {
        const weight = weights ? (weights[output.model_id] || 1) : 1;
        signal += output.prediction * weight;
        totalWeight += weight;
      }

      const ensemblePrediction = totalWeight > 0 ? signal / totalWeight : 0;
      const avgConfidence = outputs.reduce((sum: number, o: any) => sum + (o.confidence || 0.5), 0) / outputs.length;

      // Check unanimity if required
      let unanimous = true;
      if (config.unanimity_required) {
        const directions = outputs.map((o: any) => Math.sign(o.prediction));
        unanimous = directions.every((d: number) => d === directions[0]);
      }

      signals.push({
        timestamp,
        ensemblePrediction,
        ensembleLabel: ensemblePrediction > 0 ? 'long' : ensemblePrediction < 0 ? 'short' : 'neutral',
        confidence: avgConfidence,
        unanimous,
        modelCount: outputs.length,
        models: outputs.map((o: any) => ({ id: o.model_id, name: o.model_name, prediction: o.prediction }))
      });
    }

    return signals;
  }

  // Trades
  async createTrade(data: any): Promise<any> {
    const result = await pool.query(`
      INSERT INTO trades (symbol, side, entry_timestamp, exit_timestamp, entry_price, exit_price,
        quantity, pnl, pnl_pct, commission, slippage, model_id, ensemble_id, signal_confidence,
        regime_id, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [
      data.symbol, data.side, data.entryTimestamp, data.exitTimestamp,
      data.entryPrice, data.exitPrice, data.quantity || 1,
      data.pnl, data.pnlPct, data.commission || 0, data.slippage || 0,
      data.modelId, data.ensembleId, data.signalConfidence,
      data.regimeId, data.notes, data.status || 'open'
    ]);
    return result.rows[0];
  }

  async getTrades(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<any[]> {
    let query = 'SELECT * FROM trades WHERE 1=1';
    const params: any[] = [];
    let paramCount = 1;

    if (options?.symbol) {
      query += ` AND symbol = $${paramCount++}`;
      params.push(options.symbol);
    }
    if (options?.modelId) {
      query += ` AND model_id = $${paramCount++}`;
      params.push(options.modelId);
    }
    if (options?.status) {
      query += ` AND status = $${paramCount++}`;
      params.push(options.status);
    }

    query += ` ORDER BY entry_timestamp DESC LIMIT $${paramCount}`;
    params.push(options?.limit || 100);

    const result = await pool.query(query, params);
    return result.rows;
  }

  async closeTrade(id: number, exitPrice: number, exitTimestamp: number): Promise<any> {
    // Get the trade to calculate P&L
    const tradeResult = await pool.query('SELECT * FROM trades WHERE id = $1', [id]);
    if (tradeResult.rows.length === 0) return null;
    
    const trade = tradeResult.rows[0];
    const priceDiff = trade.side === 'long' 
      ? exitPrice - trade.entry_price 
      : trade.entry_price - exitPrice;
    
    const pnl = priceDiff * trade.quantity - (trade.commission || 0) - (trade.slippage || 0);
    const pnlPct = priceDiff / trade.entry_price;

    const result = await pool.query(`
      UPDATE trades SET exit_timestamp = $1, exit_price = $2, pnl = $3, pnl_pct = $4, status = 'closed'
      WHERE id = $5
      RETURNING *
    `, [exitTimestamp, exitPrice, pnl, pnlPct, id]);
    
    return result.rows[0];
  }

  // Market Regimes
  async createMarketRegime(data: any): Promise<any> {
    const result = await pool.query(`
      INSERT INTO market_regimes (name, description, volatility_level, trend_direction, 
        characteristics, detection_rules)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      data.name, data.description, data.volatilityLevel, data.trendDirection,
      data.characteristics ? JSON.stringify(data.characteristics) : null,
      data.detectionRules ? JSON.stringify(data.detectionRules) : null
    ]);
    return result.rows[0];
  }

  async getMarketRegimes(): Promise<any[]> {
    const result = await pool.query('SELECT * FROM market_regimes ORDER BY name');
    return result.rows;
  }

  async recordRegimeHistory(data: any): Promise<any> {
    const result = await pool.query(`
      INSERT INTO regime_history (regime_id, symbol, start_timestamp, end_timestamp, confidence, detected_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [data.regimeId, data.symbol, data.startTimestamp, data.endTimestamp, data.confidence, data.detectedBy]);
    return result.rows[0];
  }

  /**
   * Insert futures OHLCV data into ohlcv_1s hypertable.
   * Extracts base_symbol from contract symbol (e.g. ESH24 -> ES).
   */
  async insertFuturesBatch(rows: Array<{
    ts: Date;
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>): Promise<number> {
    if (rows.length === 0) return 0;
    const client = await pool.connect();
    let totalInserted = 0;
    try {
      const batchSize = 1000;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIdx = 1;

        for (const row of batch) {
          const baseSymbol = row.symbol.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '') || row.symbol;
          placeholders.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`);
          values.push(row.ts, row.symbol, baseSymbol, row.open, row.high, row.low, row.close, row.volume);
          paramIdx += 8;
        }

        const result = await client.query(`
          INSERT INTO ohlcv_1s (ts, symbol, base_symbol, open, high, low, close, volume)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (symbol, ts) DO NOTHING
        `, values);
        totalInserted += result.rowCount || 0;
      }
    } finally {
      client.release();
    }
    return totalInserted;
  }

  /**
   * Insert forex OHLCV data into forex_1m hypertable.
   */
  async insertForexBatch(rows: Array<{
    ts: Date;
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>): Promise<number> {
    if (rows.length === 0) return 0;
    const client = await pool.connect();
    let totalInserted = 0;
    try {
      const batchSize = 1000;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIdx = 1;

        for (const row of batch) {
          const pipSize = row.symbol.includes('JPY') ? 0.01 : 0.0001;
          placeholders.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`);
          values.push(row.ts, row.symbol, row.open, row.high, row.low, row.close, row.volume, pipSize);
          paramIdx += 8;
        }

        const result = await client.query(`
          INSERT INTO forex_1m (ts, symbol, open, high, low, close, volume, pip_size)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (symbol, ts) DO NOTHING
        `, values);
        totalInserted += result.rowCount || 0;
      }
    } finally {
      client.release();
    }
    return totalInserted;
  }

  // ============================================================
  // BROKER CONFIGS
  // ============================================================

  async getBrokerConfigs(): Promise<any[]> {
    const result = await pool.query('SELECT * FROM broker_configs ORDER BY asset_type, name');
    return result.rows;
  }

  async getBrokerConfig(id: number): Promise<any | undefined> {
    const result = await pool.query('SELECT * FROM broker_configs WHERE id = $1', [id]);
    return result.rows[0];
  }

  async getBrokerConfigByName(name: string): Promise<any | undefined> {
    const result = await pool.query('SELECT * FROM broker_configs WHERE name = $1', [name]);
    return result.rows[0];
  }

  async getDefaultBrokerConfig(assetType: string): Promise<any | undefined> {
    const result = await pool.query(
      'SELECT * FROM broker_configs WHERE asset_type = $1 AND is_default = 1 LIMIT 1',
      [assetType]
    );
    return result.rows[0];
  }

  // ============================================================
  // BACKTEST RUNS
  // ============================================================

  async createBacktestRun(data: any): Promise<any> {
    const result = await pool.query(`
      INSERT INTO backtest_runs (name, model_id, symbol, broker_config_id, timeframe,
        train_start_timestamp, train_end_timestamp, test_start_timestamp, test_end_timestamp,
        split_ratio, initial_capital, position_size, max_positions,
        stop_loss_ticks, take_profit_ticks, trailing_stop_ticks, max_drawdown_pct,
        status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `, [
      data.name, data.modelId, data.symbol, data.brokerConfigId, data.timeframe || '1m',
      data.trainStartTimestamp, data.trainEndTimestamp,
      data.testStartTimestamp, data.testEndTimestamp,
      data.splitRatio || 0.8, data.initialCapital || 10000,
      data.positionSize || 1, data.maxPositions || 1,
      data.stopLossTicks, data.takeProfitTicks, data.trailingStopTicks, data.maxDrawdownPct,
      'pending'
    ]);
    return result.rows[0];
  }

  async updateBacktestRun(id: number, data: Partial<any>): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    const fieldMap: Record<string, string> = {
      status: 'status', totalTrades: 'total_trades', winRate: 'win_rate',
      profitFactor: 'profit_factor', sharpeRatio: 'sharpe_ratio', sortinoRatio: 'sortino_ratio',
      maxDrawdown: 'max_drawdown', totalReturn: 'total_return', totalReturnPct: 'total_return_pct',
      avgWin: 'avg_win', avgLoss: 'avg_loss', largestWin: 'largest_win', largestLoss: 'largest_loss',
      avgHoldingTimeMs: 'avg_holding_time_ms', expectancy: 'expectancy',
      totalCommissions: 'total_commissions', totalSlippage: 'total_slippage',
      equityCurve: 'equity_curve', errorMessage: 'error_message',
      startedAt: 'started_at', completedAt: 'completed_at',
    };

    for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
      if (data[jsKey] !== undefined) {
        setClauses.push(`${dbCol} = $${paramIdx++}`);
        values.push(data[jsKey]);
      }
    }

    if (setClauses.length === 0) return;
    values.push(id);
    await pool.query(`UPDATE backtest_runs SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`, values);
  }

  async getBacktestRuns(options?: { symbol?: string; modelId?: number; status?: string; limit?: number }): Promise<any[]> {
    let query = `SELECT br.*, bc.name as broker_name, bc.broker as broker_label,
      mm.name as model_name, mm.architecture as model_architecture
      FROM backtest_runs br
      LEFT JOIN broker_configs bc ON br.broker_config_id = bc.id
      LEFT JOIN ml_models mm ON br.model_id = mm.id
      WHERE 1=1`;
    const params: any[] = [];
    let paramCount = 1;

    if (options?.symbol) {
      query += ` AND br.symbol = $${paramCount++}`;
      params.push(options.symbol);
    }
    if (options?.modelId) {
      query += ` AND br.model_id = $${paramCount++}`;
      params.push(options.modelId);
    }
    if (options?.status) {
      query += ` AND br.status = $${paramCount++}`;
      params.push(options.status);
    }

    query += ` ORDER BY br.created_at DESC LIMIT $${paramCount}`;
    params.push(options?.limit || 50);

    const result = await pool.query(query, params);
    return result.rows;
  }

  async getBacktestRun(id: number): Promise<any | undefined> {
    const result = await pool.query(`
      SELECT br.*, bc.name as broker_name, bc.broker as broker_label,
        mm.name as model_name, mm.architecture as model_architecture
      FROM backtest_runs br
      LEFT JOIN broker_configs bc ON br.broker_config_id = bc.id
      LEFT JOIN ml_models mm ON br.model_id = mm.id
      WHERE br.id = $1
    `, [id]);
    return result.rows[0];
  }

  // ============================================================
  // BACKTEST TRADES
  // ============================================================

  async insertBacktestTrades(trades: any[]): Promise<void> {
    if (trades.length === 0) return;
    
    const batchSize = 500;
    for (let i = 0; i < trades.length; i += batchSize) {
      const batch = trades.slice(i, i + batchSize);
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIdx = 1;

      for (const t of batch) {
        placeholders.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12}, $${paramIdx + 13}, $${paramIdx + 14}, $${paramIdx + 15}, $${paramIdx + 16}, $${paramIdx + 17})`);
        values.push(
          t.backtestRunId, t.symbol, t.side,
          t.entryTimestamp, t.exitTimestamp,
          t.entryPrice, t.exitPrice,
          t.quantity, t.pnl, t.netPnl,
          t.commission, t.slippage, t.spreadCost,
          t.entrySignal, t.exitReason,
          t.barsHeld, t.maxFavorableExcursion ?? t.maxAdverseExcursion,
          t.runningPnl
        );
        paramIdx += 18;
      }

      await pool.query(`
        INSERT INTO backtest_trades (backtest_run_id, symbol, side,
          entry_timestamp, exit_timestamp, entry_price, exit_price,
          quantity, pnl, net_pnl, commission, slippage, spread_cost,
          entry_signal, exit_reason, bars_held, max_favorable_excursion,
          running_pnl)
        VALUES ${placeholders.join(', ')}
      `, values);
    }
  }

  async getBacktestTrades(backtestRunId: number, limit?: number): Promise<any[]> {
    const result = await pool.query(
      'SELECT * FROM backtest_trades WHERE backtest_run_id = $1 ORDER BY entry_timestamp ASC LIMIT $2',
      [backtestRunId, limit || 10000]
    );
    return result.rows;
  }
}

export const storage = new DatabaseStorage();
