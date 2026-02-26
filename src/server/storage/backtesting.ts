/**
 * Storage — Backtesting Methods
 *
 * Broker configs, backtest runs, and backtest trades.
 */

import {
  brokerConfigs, backtestRuns, backtestTrades, mlModels,
} from '@shared/schema';
import { db } from '../database/db';
import { eq, and, desc, asc, getTableColumns } from 'drizzle-orm';

// ── Broker Configs ──────────────────────────────────────────

export async function getBrokerConfigs(): Promise<any[]> {
  return db.select().from(brokerConfigs).orderBy(brokerConfigs.assetType, brokerConfigs.name);
}

export async function getBrokerConfig(id: number): Promise<any | undefined> {
  const [result] = await db.select().from(brokerConfigs).where(eq(brokerConfigs.id, id));
  return result;
}

export async function getBrokerConfigByName(name: string): Promise<any | undefined> {
  const [result] = await db.select().from(brokerConfigs).where(eq(brokerConfigs.name, name));
  return result;
}

export async function getDefaultBrokerConfig(assetType: string): Promise<any | undefined> {
  const [result] = await db.select().from(brokerConfigs)
    .where(and(eq(brokerConfigs.assetType, assetType), eq(brokerConfigs.isDefault, 1)))
    .limit(1);
  return result;
}

// ── Backtest Runs ───────────────────────────────────────────

export async function createBacktestRun(data: any): Promise<any> {
  const [result] = await db.insert(backtestRuns).values({
    name: data.name,
    modelId: data.modelId,
    symbol: data.symbol,
    brokerConfigId: data.brokerConfigId,
    timeframe: data.timeframe || '1m',
    trainStartTimestamp: data.trainStartTimestamp,
    trainEndTimestamp: data.trainEndTimestamp,
    testStartTimestamp: data.testStartTimestamp,
    testEndTimestamp: data.testEndTimestamp,
    splitRatio: data.splitRatio || 0.8,
    initialCapital: data.initialCapital || 10000,
    positionSize: data.positionSize || 1,
    maxPositions: data.maxPositions || 1,
    stopLossTicks: data.stopLossTicks,
    takeProfitTicks: data.takeProfitTicks,
    trailingStopTicks: data.trailingStopTicks,
    maxDrawdownPct: data.maxDrawdownPct,
    status: 'pending',
  }).returning();
  return result;
}

export async function updateBacktestRun(id: number, data: Partial<any>): Promise<void> {
  const allowed: Record<string, any> = {};

  const fieldMap: Record<string, string> = {
    status: 'status', totalTrades: 'totalTrades', winRate: 'winRate',
    profitFactor: 'profitFactor', sharpeRatio: 'sharpeRatio', sortinoRatio: 'sortinoRatio',
    maxDrawdown: 'maxDrawdown', totalReturn: 'totalReturn', totalReturnPct: 'totalReturnPct',
    avgWin: 'avgWin', avgLoss: 'avgLoss', largestWin: 'largestWin', largestLoss: 'largestLoss',
    avgHoldingTimeMs: 'avgHoldingTimeMs', expectancy: 'expectancy',
    totalCommissions: 'totalCommissions', totalSlippage: 'totalSlippage',
    equityCurve: 'equityCurve', errorMessage: 'errorMessage',
    startedAt: 'startedAt', completedAt: 'completedAt',
  };

  for (const [jsKey, drizzleKey] of Object.entries(fieldMap)) {
    if (data[jsKey] !== undefined) allowed[drizzleKey] = data[jsKey];
  }

  if (Object.keys(allowed).length === 0) return;
  await db.update(backtestRuns).set(allowed).where(eq(backtestRuns.id, id));
}

export async function getBacktestRuns(
  options?: { symbol?: string; modelId?: number; status?: string; limit?: number },
): Promise<any[]> {
  const conditions: any[] = [];
  if (options?.symbol) conditions.push(eq(backtestRuns.symbol, options.symbol));
  if (options?.modelId) conditions.push(eq(backtestRuns.modelId, options.modelId));
  if (options?.status) conditions.push(eq(backtestRuns.status, options.status));

  let query = db.select({
    ...getTableColumns(backtestRuns),
    brokerName: brokerConfigs.name,
    brokerLabel: brokerConfigs.broker,
    modelName: mlModels.name,
    modelArchitecture: mlModels.architecture,
  })
  .from(backtestRuns)
  .leftJoin(brokerConfigs, eq(backtestRuns.brokerConfigId, brokerConfigs.id))
  .leftJoin(mlModels, eq(backtestRuns.modelId, mlModels.id));

  if (conditions.length > 0) query = query.where(and(...conditions)) as typeof query;

  return query.orderBy(desc(backtestRuns.createdAt)).limit(options?.limit || 50);
}

export async function getBacktestRun(id: number): Promise<any | undefined> {
  const [result] = await db.select({
    ...getTableColumns(backtestRuns),
    brokerName: brokerConfigs.name,
    brokerLabel: brokerConfigs.broker,
    modelName: mlModels.name,
    modelArchitecture: mlModels.architecture,
  })
  .from(backtestRuns)
  .leftJoin(brokerConfigs, eq(backtestRuns.brokerConfigId, brokerConfigs.id))
  .leftJoin(mlModels, eq(backtestRuns.modelId, mlModels.id))
  .where(eq(backtestRuns.id, id));
  return result;
}

// ── Backtest Trades ─────────────────────────────────────────

export async function insertBacktestTrades(tradeData: any[]): Promise<void> {
  if (tradeData.length === 0) return;
  const batchSize = 100;
  for (let i = 0; i < tradeData.length; i += batchSize) {
    const batch = tradeData.slice(i, i + batchSize);
    const values = batch.map(t => ({
      backtestRunId: t.backtestRunId,
      symbol: t.symbol,
      side: t.side,
      entryTimestamp: t.entryTimestamp,
      exitTimestamp: t.exitTimestamp,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      quantity: t.quantity,
      pnl: t.pnl,
      netPnl: t.netPnl,
      commission: t.commission,
      slippage: t.slippage,
      spreadCost: t.spreadCost,
      entrySignal: t.entrySignal,
      exitReason: t.exitReason,
      barsHeld: t.barsHeld,
      maxFavorableExcursion: t.maxFavorableExcursion ?? t.maxAdverseExcursion,
      runningPnl: t.runningPnl,
    }));
    await db.insert(backtestTrades).values(values);
  }
}

export async function getBacktestTrades(backtestRunId: number, limit?: number): Promise<any[]> {
  return db.select().from(backtestTrades)
    .where(eq(backtestTrades.backtestRunId, backtestRunId))
    .orderBy(asc(backtestTrades.entryTimestamp))
    .limit(limit || 10000);
}
