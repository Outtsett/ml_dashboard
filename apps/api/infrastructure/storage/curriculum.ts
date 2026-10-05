import { db } from "../database/db";
import {
  curriculumProgress, type CurriculumProgress, type InsertCurriculumProgress,
  curriculumSectionProgress, type CurriculumSectionProgress,
  curriculumBookmarks, type CurriculumBookmark,
} from "@shared/pg_schema";
import { eq, and, sql } from "drizzle-orm";

export class CurriculumStorage {
  async getProgress(userId: string): Promise<CurriculumProgress[]> {
    return db.select()
      .from(curriculumProgress)
      .where(eq(curriculumProgress.userId, userId));
  }

  async updateProgress(progress: InsertCurriculumProgress): Promise<CurriculumProgress> {
    const existing = (await db.select()
          .from(curriculumProgress)
          .where(
            and(
              eq(curriculumProgress.userId, progress.userId),
              eq(curriculumProgress.moduleId, progress.moduleId),
              eq(curriculumProgress.lessonId, progress.lessonId)
            )
          )
          )[0];

    if (existing) {
      const [updated] = await db.update(curriculumProgress)
        .set({
          status: progress.status,
          score: progress.score,
          completedAt: progress.status === 'completed' ? new Date() : null,
          updatedAt: new Date()
        })
        .where(eq(curriculumProgress.id, existing.id))
        .returning();
      return updated as CurriculumProgress;
    }

    const [inserted] = await db.insert(curriculumProgress)
      .values({
        ...progress,
        completedAt: progress.status === 'completed' ? new Date() : null,
        updatedAt: new Date()
      })
      .returning();
    return inserted as CurriculumProgress;
  }
  // ─── Section-level progress ──────────────────────────────────────
  async getSectionProgress(userId: string, lessonId: string): Promise<CurriculumSectionProgress[]> {
    return db.select()
      .from(curriculumSectionProgress)
      .where(
        and(
          eq(curriculumSectionProgress.userId, userId),
          eq(curriculumSectionProgress.lessonId, lessonId)
        )
      );
  }

  async markSectionViewed(userId: string, lessonId: string, sectionIndex: number): Promise<CurriculumSectionProgress> {
    const existing = (await db.select()
          .from(curriculumSectionProgress)
          .where(
            and(
              eq(curriculumSectionProgress.userId, userId),
              eq(curriculumSectionProgress.lessonId, lessonId),
              eq(curriculumSectionProgress.sectionIndex, sectionIndex)
            )
          )
          )[0];

    if (existing) return existing;

    const [inserted] = await db.insert(curriculumSectionProgress)
      .values({ userId, lessonId, sectionIndex, viewedAt: new Date() })
      .returning();
    return inserted as CurriculumSectionProgress;
  }

  async getSectionProgressBulk(userId: string): Promise<CurriculumSectionProgress[]> {
    return db.select()
      .from(curriculumSectionProgress)
      .where(eq(curriculumSectionProgress.userId, userId));
  }
  async addTimeSpent(userId: string, lessonId: string, additionalMs: number): Promise<void> {
    if (additionalMs <= 0) return;

    const existing = (await db.select()
          .from(curriculumProgress)
          .where(
            and(
              eq(curriculumProgress.userId, userId),
              eq(curriculumProgress.lessonId, lessonId)
            )
          )
          )[0];

    if (existing) {
      await db.update(curriculumProgress)
        .set({
          timeSpentMs: sql`${curriculumProgress.timeSpentMs} + ${additionalMs}`,
          updatedAt: new Date()
        })
        .where(eq(curriculumProgress.id, existing.id));
    } else {
      // Derive moduleId from lessonId (format: "path-mod-lesson" → take first two segments)
      const parts = lessonId.split("-");
      const moduleId = parts.length >= 2 ? parts.slice(0, 2).join("-") : lessonId;

      await db.insert(curriculumProgress)
        .values({
          userId,
          moduleId,
          lessonId,
          status: "in_progress",
          timeSpentMs: additionalMs,
          updatedAt: new Date()
        });
    }
  }

  // ─── Bookmarks & notes ──────────────────────────────────────────
  async getBookmarks(userId: string): Promise<CurriculumBookmark[]> {
    return db.select()
      .from(curriculumBookmarks)
      .where(eq(curriculumBookmarks.userId, userId));
  }

  async getBookmark(userId: string, lessonId: string): Promise<CurriculumBookmark | undefined> {
    return db.select()
          .from(curriculumBookmarks)
          .where(
            and(
              eq(curriculumBookmarks.userId, userId),
              eq(curriculumBookmarks.lessonId, lessonId)
            )
          ).then(res => res[0]);
  }

  async toggleBookmark(userId: string, lessonId: string): Promise<{ bookmarked: boolean }> {
    const existing = await this.getBookmark(userId, lessonId);
    if (existing) {
      await db.delete(curriculumBookmarks)
        .where(eq(curriculumBookmarks.id, existing.id));
      return { bookmarked: false };
    }
    await db.insert(curriculumBookmarks)
      .values({ userId, lessonId })
      .returning();
    return { bookmarked: true };
  }

  async updateNote(userId: string, lessonId: string, note: string): Promise<CurriculumBookmark> {
    const existing = await this.getBookmark(userId, lessonId);
    if (existing) {
      const [updated] = await db.update(curriculumBookmarks)
        .set({ note, updatedAt: new Date() })
        .where(eq(curriculumBookmarks.id, existing.id))
        .returning();
      return updated as CurriculumBookmark;
    }
    const [inserted] = await db.insert(curriculumBookmarks)
      .values({ userId, lessonId, note })
      .returning();
    return inserted as CurriculumBookmark;
  }
}

export const curriculumStorage = new CurriculumStorage();
