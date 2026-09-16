/**
 * Storage — Trades
 */

import { trades, type Trade } from '@shared/schema';
import { db } from '../database/db';
import { eq, and, desc } from 'drizzle-orm';
import type { CreateTradeParams } from './types';

export async function createTrade(data: CreateTradeParams): Promise<Trade> {
  const [result] = await db.insert(trades).values({
    symbol: data.symbol,
    side: data.side,
    entryTimestamp: data.entryTimestamp,
    exitTimestamp: data.exitTimestamp,
    entryPrice: data.entryPrice,
    exitPrice: data.exitPrice,
    quantity: data.quantity || 1,
    pnl: data.pnl,
    pnlPct: data.pnlPct,
    commission: data.commission || 0,
    slippage: data.slippage || 0,
    modelId: data.modelId,
    ensembleId: data.ensembleId,
    signalConfidence: data.signalConfidence,
    regimeId: data.regimeId,
    notes: data.notes,
    status: data.status || 'open',
  }).returning();
  return result!;
}

export async function getTrades(
  options?: { symbol?: string; modelId?: number; status?: string; limit?: number },
): Promise<Trade[]> {
  const conditions = [];
  if (options?.symbol) conditions.push(eq(trades.symbol, options.symbol));
  if (options?.modelId) conditions.push(eq(trades.modelId, options.modelId));
  if (options?.status) conditions.push(eq(trades.status, options.status));

  let query = db.select().from(trades);
  if (conditions.length > 0) query = query.where(and(...conditions)) as typeof query;

  return query.orderBy(desc(trades.entryTimestamp)).limit(options?.limit || 100);
}

export async function closeTrade(id: number, exitPrice: number, exitTimestamp: number): Promise<Trade | null> {
  const [trade] = await db.select().from(trades).where(eq(trades.id, id));
  if (!trade) return null;

  const priceDiff = trade.side === 'long'
    ? exitPrice - trade.entryPrice
    : trade.entryPrice - exitPrice;
  const pnl = priceDiff * trade.quantity - (trade.commission || 0) - (trade.slippage || 0);
  const pnlPct = priceDiff / trade.entryPrice;

  const [result] = await db.update(trades)
    .set({ exitTimestamp, exitPrice, pnl, pnlPct, status: 'closed' })
    .where(eq(trades.id, id))
    .returning();
  return result ?? null;
}
