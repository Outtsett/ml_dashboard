/**
 * Label Repository — CRUD operations for persisted label sets.
 */

import { db } from '../../database/db';
import { generatedLabels, contrastivePairs } from '@shared/schema';
import { and, eq, desc, type SQL } from 'drizzle-orm';

export async function getLabelSets(filters?: {
  symbol?: string;
  generatorType?: string;
  modelId?: number;
  status?: string;
  limit?: number;
}) {
  // Filters belong in the WHERE clause. They used to be applied in JS after
  // `.limit(50)`, so a filter for a symbol or status outside the newest fifty
  // rows returned fewer matches than exist — or none — with no indication.
  const conditions: SQL[] = [];
  if (filters?.symbol) conditions.push(eq(generatedLabels.symbol, filters.symbol));
  if (filters?.generatorType) conditions.push(eq(generatedLabels.generatorType, filters.generatorType));
  if (filters?.modelId) conditions.push(eq(generatedLabels.modelId, filters.modelId));
  if (filters?.status) conditions.push(eq(generatedLabels.status, filters.status));

  const base = db.select().from(generatedLabels);
  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered.orderBy(desc(generatedLabels.createdAt)).limit(filters?.limit || 50);
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
