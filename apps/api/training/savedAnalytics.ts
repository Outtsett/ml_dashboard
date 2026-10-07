/**
 * Saved analytics: a named definition (a comparison, a chart, a query) over a
 * set of runs, kept in SQLite (`saved_analytics`, `saved_analytics_runs`). The
 * data a saved analytic shows is always recomputed from the run views, never
 * stored, so it cannot go stale.
 */
import { asc, desc, eq } from "drizzle-orm";

import { db, schema } from "../infrastructure/database/sqlite";

const { savedAnalytics, savedAnalyticsRuns } = schema;

export type SavedAnalyticKind = "comparison" | "chart" | "query";

export interface SavedAnalytic {
  id: string;
  name: string;
  kind: SavedAnalyticKind;
  definition: Record<string, unknown>;
  runIds: string[];
  savedAt: number;
}

function runIdsOf(analyticsId: string): string[] {
  return db
    .select({ runId: savedAnalyticsRuns.runId })
    .from(savedAnalyticsRuns)
    .where(eq(savedAnalyticsRuns.analyticsId, analyticsId))
    .orderBy(asc(savedAnalyticsRuns.position))
    .all()
    .map((row) => row.runId);
}

export function listSavedAnalytics(kind?: SavedAnalyticKind): SavedAnalytic[] {
  const rows = (kind ? db.select().from(savedAnalytics).where(eq(savedAnalytics.kind, kind)) : db.select().from(savedAnalytics))
    .orderBy(desc(savedAnalytics.updatedAt))
    .all();
  return rows.map((row) => ({ id: row.analyticsId, name: row.name, kind: row.kind, definition: row.definition, runIds: runIdsOf(row.analyticsId), savedAt: row.updatedAt }));
}

/** Insert, or replace the one with the same name (names are unique, case-insensitively by convention). */
export function saveAnalytic(input: { name: string; kind: SavedAnalyticKind; definition: Record<string, unknown>; runIds: string[] }): { saved: SavedAnalytic; created: boolean } {
  const now = Date.now();
  const existing = db.select().from(savedAnalytics).all().find((row) => row.name.toLowerCase() === input.name.toLowerCase());
  const analyticsId = existing?.analyticsId ?? `ana_${now.toString(36)}`;
  db.transaction((tx) => {
    if (existing) {
      tx.update(savedAnalytics).set({ name: input.name, kind: input.kind, definition: input.definition, updatedAt: now }).where(eq(savedAnalytics.analyticsId, analyticsId)).run();
      tx.delete(savedAnalyticsRuns).where(eq(savedAnalyticsRuns.analyticsId, analyticsId)).run();
    } else {
      tx.insert(savedAnalytics).values({ analyticsId, name: input.name, kind: input.kind, definition: input.definition, createdAt: now, updatedAt: now }).run();
    }
    input.runIds.forEach((runId, position) => {
      tx.insert(savedAnalyticsRuns).values({ analyticsId, runId, position }).run();
    });
  });
  return { saved: { id: analyticsId, name: input.name, kind: input.kind, definition: input.definition, runIds: input.runIds, savedAt: now }, created: !existing };
}

export function deleteSavedAnalytic(analyticsId: string): boolean {
  const exists = db.select({ id: savedAnalytics.analyticsId }).from(savedAnalytics).where(eq(savedAnalytics.analyticsId, analyticsId)).all().length > 0;
  if (!exists) return false;
  db.delete(savedAnalytics).where(eq(savedAnalytics.analyticsId, analyticsId)).run();
  return true;
}
