/**
 * Storage — Market Regimes
 */

import { marketRegimes, regimeHistory, type MarketRegime, type RegimeHistory } from '@shared/schema';
import { db } from '../database/db';
import type { CreateMarketRegimeParams, RecordRegimeHistoryParams } from './types';

export async function createMarketRegime(data: CreateMarketRegimeParams): Promise<MarketRegime> {
  const [result] = await db.insert(marketRegimes).values({
    name: data.name,
    description: data.description,
    volatilityLevel: data.volatilityLevel,
    trendDirection: data.trendDirection,
    characteristics: data.characteristics ? JSON.stringify(data.characteristics) : null,
    detectionRules: data.detectionRules ? JSON.stringify(data.detectionRules) : null,
  }).returning();
  return result!;
}

export async function getMarketRegimes(): Promise<MarketRegime[]> {
  return db.select().from(marketRegimes).orderBy(marketRegimes.name);
}

export async function recordRegimeHistory(data: RecordRegimeHistoryParams): Promise<RegimeHistory> {
  const [result] = await db.insert(regimeHistory).values({
    regimeId: data.regimeId,
    symbol: data.symbol,
    startTimestamp: data.startTimestamp,
    endTimestamp: data.endTimestamp,
    confidence: data.confidence,
    detectedBy: data.detectedBy,
  }).returning();
  return result!;
}
