/**
 * Storage — Market Regimes
 */

import { marketRegimes, regimeHistory } from '@shared/schema';
import { db } from '../database/db';

export async function createMarketRegime(data: any): Promise<any> {
  const [result] = await db.insert(marketRegimes).values({
    name: data.name,
    description: data.description,
    volatilityLevel: data.volatilityLevel,
    trendDirection: data.trendDirection,
    characteristics: data.characteristics ? JSON.stringify(data.characteristics) : null,
    detectionRules: data.detectionRules ? JSON.stringify(data.detectionRules) : null,
  }).returning();
  return result;
}

export async function getMarketRegimes(): Promise<any[]> {
  return db.select().from(marketRegimes).orderBy(marketRegimes.name);
}

export async function recordRegimeHistory(data: any): Promise<any> {
  const [result] = await db.insert(regimeHistory).values({
    regimeId: data.regimeId,
    symbol: data.symbol,
    startTimestamp: data.startTimestamp,
    endTimestamp: data.endTimestamp,
    confidence: data.confidence,
    detectedBy: data.detectedBy,
  }).returning();
  return result;
}
