/**
 * Label Repository — CRUD over `generated_labels`, the label-set ledger.
 *
 * DB queries only; no HTTP, no lake, no formatting.
 */

import { db } from '../../database/db';
import { generatedLabels, contrastivePairs, trainingSessions } from '@shared/schema';
import { and, eq, desc, isNotNull, sql, type SQL } from 'drizzle-orm';

export type GeneratedLabelRow = typeof generatedLabels.$inferSelect;
export type GeneratedLabelPatch = Partial<typeof generatedLabels.$inferInsert>;

export async function getLabelSets(filters?: {
  symbol?: string;
  generatorType?: string;
  modelId?: number;
  status?: string;
  stage?: string;
  limit?: number;
}): Promise<GeneratedLabelRow[]> {
  // Filters belong in the WHERE clause. They used to be applied in JS after
  // `.limit(50)`, so a filter for a symbol or status outside the newest fifty
  // rows returned fewer matches than exist — or none — with no indication.
  const conditions: SQL[] = [];
  if (filters?.symbol) conditions.push(eq(generatedLabels.symbol, filters.symbol));
  if (filters?.generatorType) conditions.push(eq(generatedLabels.generatorType, filters.generatorType));
  if (filters?.modelId) conditions.push(eq(generatedLabels.modelId, filters.modelId));
  if (filters?.status) conditions.push(eq(generatedLabels.status, filters.status));
  if (filters?.stage) conditions.push(eq(generatedLabels.stage, filters.stage));

  const base = db.select().from(generatedLabels);
  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered.orderBy(desc(generatedLabels.createdAt)).limit(filters?.limit || 50);
}

export async function getLabelSetById(id: number): Promise<GeneratedLabelRow | null> {
  const results = await db.select().from(generatedLabels).where(eq(generatedLabels.id, id));
  return results[0] || null;
}

/** The set a recipe identifies, if it has been requested before. */
export async function getLabelSetByRecipe(recipe: string): Promise<GeneratedLabelRow | null> {
  const results = await db.select().from(generatedLabels).where(eq(generatedLabels.recipe, recipe));
  return results[0] || null;
}

export async function insertLabelSet(values: typeof generatedLabels.$inferInsert): Promise<GeneratedLabelRow> {
  const [row] = await db.insert(generatedLabels).values(values).returning();
  return row!;
}

export async function updateLabelSet(id: number, patch: GeneratedLabelPatch): Promise<void> {
  await db.update(generatedLabels).set({ ...patch, updatedAt: new Date() }).where(eq(generatedLabels.id, id));
}

/** Mark a set retired. The parquet stays; nothing in the lake is deleted. */
export async function retireLabelSet(id: number, reason?: string): Promise<void> {
  await updateLabelSet(id, {
    retiredAt: new Date(),
    stage: 'retired',
    staleReason: reason ?? null,
  });
}

/** Training sessions per label set — the `consumed` rung. */
export async function sessionCountsByLabelSet(): Promise<Map<number, number>> {
  const rows = await db
    .select({ labelSetId: trainingSessions.labelSetId, count: sql<number>`count(*)` })
    .from(trainingSessions)
    .where(isNotNull(trainingSessions.labelSetId))
    .groupBy(trainingSessions.labelSetId);
  const out = new Map<number, number>();
  for (const row of rows) if (row.labelSetId !== null) out.set(row.labelSetId, Number(row.count));
  return out;
}

export async function getContrastivePairsForLabelSet(labelSetId: number, limit: number = 1000) {
  return db.select()
    .from(contrastivePairs)
    .where(eq(contrastivePairs.labelSetId, labelSetId))
    .limit(limit);
}

/** Remove the ledger row. The lake object, if any, is left in place. */
export async function deleteLabelSet(id: number) {
  await db.delete(generatedLabels).where(eq(generatedLabels.id, id));
  return { success: true };
}
