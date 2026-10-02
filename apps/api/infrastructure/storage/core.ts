/**
 * Storage — Core Domain Methods
 *
 * Users, uploads, feature importance, training sessions, loss history,
 * instruments, and news articles.
 */

import {
  users, uploads, featureImportance, trainingSessions, lossHistory, instruments,
  newsArticles, newsSymbols,
  type User, type InsertUser, type Upload, type InsertUpload,
  type FeatureImportance, type InsertFeatureImportance,
  type TrainingSession, type InsertTrainingSession, type LossHistory, type InsertLossHistory,
  type Instrument, type NewsArticle, type InsertNewsArticle,
} from '@shared/schema';
import { db } from '../database/db';
import { eq, and, gte, lte, desc, asc, getTableColumns } from 'drizzle-orm';

// ── Users ───────────────────────────────────────────────────

export async function getUser(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user || undefined;
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.username, username));
  return user || undefined;
}

export async function createUser(insertUser: InsertUser): Promise<User> {
  const [user] = await db.insert(users).values(insertUser).returning();
  return user!;
}

// ── Uploads ─────────────────────────────────────────────────

export async function createUpload(upload: InsertUpload): Promise<Upload> {
  const [result] = await db.insert(uploads).values(upload).returning();
  return result!;
}

export async function updateUploadStatus(id: number, status: string, recordCount?: number): Promise<void> {
  const updateData: Partial<InsertUpload> = { status };
  if (recordCount !== undefined) updateData.recordCount = recordCount;
  await db.update(uploads).set(updateData).where(eq(uploads.id, id));
}

export async function getUploads(): Promise<Upload[]> {
  return db.select().from(uploads).orderBy(desc(uploads.uploadedAt)).limit(50);
}

// ── Feature Importance ──────────────────────────────────────

export async function saveFeatureImportance(data: InsertFeatureImportance[]): Promise<void> {
  if (data.length === 0) return;
  await db.insert(featureImportance).values(data);
}

export async function getFeatureImportance(modelName: string): Promise<FeatureImportance[]> {
  return db.select().from(featureImportance)
    .where(eq(featureImportance.modelName, modelName))
    .orderBy(desc(featureImportance.importance));
}

// ── Training Sessions ───────────────────────────────────────

export async function createTrainingSession(session: InsertTrainingSession): Promise<TrainingSession> {
  const [result] = await db.insert(trainingSessions).values(session).returning();
  return result!;
}

export async function updateTrainingSession(id: number, data: Partial<TrainingSession>): Promise<void> {
  await db.update(trainingSessions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(trainingSessions.id, id));
}

export async function getActiveTrainingSession(): Promise<TrainingSession | undefined> {
  const [session] = await db.select().from(trainingSessions)
    .where(eq(trainingSessions.status, 'running'))
    .orderBy(desc(trainingSessions.startedAt))
    .limit(1);
  return session || undefined;
}

export async function getTrainingSession(id: number): Promise<TrainingSession | undefined> {
  const [session] = await db.select().from(trainingSessions).where(eq(trainingSessions.id, id));
  return session || undefined;
}

// ── Loss History ────────────────────────────────────────────

export async function addLossHistory(entry: InsertLossHistory): Promise<LossHistory> {
  const [result] = await db.insert(lossHistory).values(entry).returning();
  return result!;
}

export async function getLossHistory(sessionId: number): Promise<LossHistory[]> {
  return db.select().from(lossHistory)
    .where(eq(lossHistory.sessionId, sessionId))
    .orderBy(asc(lossHistory.epoch));
}

// ── Instruments ─────────────────────────────────────────────

export async function getInstrument(symbol: string): Promise<Instrument | undefined> {
  const normalizedSymbol = symbol.toUpperCase();
  const [instrument] = await db.select().from(instruments).where(eq(instruments.symbol, normalizedSymbol));
  return instrument || undefined;
}

export async function getAllInstruments(): Promise<Instrument[]> {
  return await db.select().from(instruments).orderBy(instruments.assetType, instruments.symbol);
}

export async function getInstrumentsByType(assetType: 'futures' | 'forex'): Promise<Instrument[]> {
  return await db.select().from(instruments)
    .where(eq(instruments.assetType, assetType))
    .orderBy(instruments.symbol);
}

// ── News ────────────────────────────────────────────────────

export async function createNewsArticle(article: InsertNewsArticle, symbols?: string[]): Promise<NewsArticle> {
  return await db.transaction(async (tx) => {
    const [created] = await tx.insert(newsArticles).values(article).returning();
    if (symbols && symbols.length > 0) {
      const entries = symbols.map(symbol => ({
        newsId: created!.id,
        symbol: symbol.toUpperCase(),
        isPrimary: symbol.toUpperCase() === symbols[0]!.toUpperCase() ? 1 : 0,
      }));
      await tx.insert(newsSymbols).values(entries);
    }
    return created!;
  });
}

export async function getNewsArticles(
  options?: { limit?: number; symbol?: string; source?: string; startDate?: Date; endDate?: Date },
): Promise<NewsArticle[]> {
  const limit = options?.limit ?? 100;
  if (options?.symbol) return getNewsBySymbol(options.symbol, limit);

  let query = db.select().from(newsArticles);
  const conditions = [];
  if (options?.source) conditions.push(eq(newsArticles.source, options.source));
  if (options?.startDate) conditions.push(gte(newsArticles.publishedAt, options.startDate));
  if (options?.endDate) conditions.push(lte(newsArticles.publishedAt, options.endDate));
  if (conditions.length > 0) query = query.where(and(...conditions)) as typeof query;

  return await query.orderBy(desc(newsArticles.publishedAt)).limit(limit);
}

export async function getNewsArticleById(id: number): Promise<NewsArticle | undefined> {
  const [article] = await db.select().from(newsArticles).where(eq(newsArticles.id, id));
  return article || undefined;
}

export async function getNewsArticleByExternalId(externalId: string): Promise<NewsArticle | undefined> {
  const [article] = await db.select().from(newsArticles).where(eq(newsArticles.externalId, externalId));
  return article || undefined;
}

export async function updateNewsSentiment(
  id: number, sentimentScore: number, sentimentLabel: string, sentimentConfidence: number,
): Promise<void> {
  await db.update(newsArticles)
    .set({ sentimentScore, sentimentLabel, sentimentConfidence })
    .where(eq(newsArticles.id, id));
}

export async function getNewsBySymbol(symbol: string, limit: number = 50): Promise<NewsArticle[]> {
  return await db.select({ ...getTableColumns(newsArticles) })
    .from(newsArticles)
    .innerJoin(newsSymbols, eq(newsArticles.id, newsSymbols.newsId))
    .where(eq(newsSymbols.symbol, symbol.toUpperCase()))
    .orderBy(desc(newsArticles.publishedAt))
    .limit(limit);
}

export async function linkNewsToSymbols(newsId: number, symbols: string[], primarySymbol?: string): Promise<void> {
  const entries = symbols.map(symbol => ({
    newsId,
    symbol: symbol.toUpperCase(),
    isPrimary: primarySymbol && symbol.toUpperCase() === primarySymbol.toUpperCase() ? 1 : 0,
  }));
  await db.insert(newsSymbols).values(entries);
}
