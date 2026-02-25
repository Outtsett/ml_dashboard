/**
 * Label Repository — CRUD operations for persisted label sets.
 */

import { db } from '../../db';
import { generatedLabels, contrastivePairs } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';

export async function getLabelSets(filters?: {
  symbol?: string;
  generatorType?: string;
  modelId?: number;
  status?: string;
  limit?: number;
}) {
  let query = db.select().from(generatedLabels).orderBy(desc(generatedLabels.createdAt));

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
