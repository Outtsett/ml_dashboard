import { eq, and, sql } from "drizzle-orm";
import { db } from "../../database/db";
import {
  hpoSessions,
  hpoTrials,
  type HpoSession,
  type HpoTrial,
} from "@shared/schema";

/** Insert a new HPO session row and return the generated row. */
export function dbCreateSession(data: {
  sessionId: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  optimizerType: string;
  optimizerConfig: string;
  objectiveMetric: string;
  objectiveDirection: string;
  searchSpace: string;
  fixedHyperparameters: string | null;
  totalTrials: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  maxBars: number | null;
  featureCategories: string | null;
}) {
  return db
    .insert(hpoSessions)
    .values({
      sessionId: data.sessionId,
      modelType: data.modelType,
      symbol: data.symbol,
      timeframe: data.timeframe,
      status: "pending",
      optimizerType: data.optimizerType,
      optimizerConfig: data.optimizerConfig,
      objectiveMetric: data.objectiveMetric,
      objectiveDirection: data.objectiveDirection,
      searchSpace: data.searchSpace,
      fixedHyperparameters: data.fixedHyperparameters,
      totalTrials: data.totalTrials,
      dateRangeStart: data.dateRangeStart,
      dateRangeEnd: data.dateRangeEnd,
      maxBars: data.maxBars,
      featureCategories: data.featureCategories,
    })
    .returning()
    .get();
}

/** Update session-level fields (status, best score, counts, etc.). */
export function dbUpdateSession(
  sessionId: string,
  data: Partial<{
    status: string;
    completedTrials: number;
    prunedTrials: number;
    failedTrials: number;
    bestTrialId: number;
    bestScore: number;
    bestParams: string;
    errorMessage: string;
    elapsedSec: number;
    completedAt: Date;
  }>,
) {
  db.update(hpoSessions)
    .set({ ...data, updatedAt: sql`(unixepoch() * 1000)` })
    .where(eq(hpoSessions.sessionId, sessionId))
    .run();
}

/** Insert a new trial row for a session. */
export function dbInsertTrial(data: {
  sessionId: string;
  trialId: number;
  status: string;
  params: string;
}) {
  return db.insert(hpoTrials).values(data).returning().get();
}

/** Update an existing trial row by sessionId + trialId. */
export function dbUpdateTrial(
  sessionId: string,
  trialId: number,
  data: Partial<{
    status: string;
    score: number;
    metrics: string;
    pruned: number;
    prunedAtStep: number;
    error: string;
    durationSec: number;
    iterationHistory: string;
    modelPath: string;
    trainedModelId: string;
    completedAt: Date;
  }>,
) {
  db.update(hpoTrials)
    .set(data)
    .where(
      and(
        eq(hpoTrials.sessionId, sessionId),
        eq(hpoTrials.trialId, trialId)
      )
    )
    .run();
}

/** Get full session + trial results from the database. */
export function dbGetSessionResults(
  sessionId: string,
): { session: HpoSession; trials: HpoTrial[] } | null {
  const session = db
    .select()
    .from(hpoSessions)
    .where(eq(hpoSessions.sessionId, sessionId))
    .get();

  if (!session) return null;

  const trials = db
    .select()
    .from(hpoTrials)
    .where(eq(hpoTrials.sessionId, sessionId))
    .all();

  return { session, trials };
}

