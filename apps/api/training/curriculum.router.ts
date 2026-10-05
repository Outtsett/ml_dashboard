import { Router } from "express";
import { curriculumStorage } from "../infrastructure/storage/curriculum";
import { z } from "zod";
import { insertCurriculumProgressSchema } from "@shared/pg_schema";

const router = Router();

// GET /api/curriculum/progress
router.get("/curriculum/progress", async (req, res) => {
  try {
    // Hardcoded user ID for now as per project context (one user)
    const userId = "1"; 
    const progress = await curriculumStorage.getProgress(userId);
    res.json(progress);
  } catch (error) {
    console.error("[curriculum] Failed to fetch curriculum progress:", error);
    res.status(500).json({ error: "Failed to fetch curriculum progress" });
  }
});

// POST /api/curriculum/progress
router.post("/curriculum/progress", async (req, res) => {
  try {
    const userId = "1";
    const body = req.body;
    
    // Validate request body
    const progressData = insertCurriculumProgressSchema.parse({
      ...body,
      userId
    });

    const result = await curriculumStorage.updateProgress(progressData);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: "Failed to update curriculum progress" });
  }
});

// GET /api/curriculum/sections/:lessonId
router.get("/curriculum/sections/:lessonId", async (req, res) => {
  try {
    const userId = "1";
    const { lessonId } = req.params;
    const rows = await curriculumStorage.getSectionProgress(userId, lessonId);
    res.json(rows.map((r) => r.sectionIndex));
  } catch (error) {
    console.error("[curriculum] Failed to fetch section progress:", error);
    res.status(500).json({ error: "Failed to fetch section progress" });
  }
});

// POST /api/curriculum/sections
router.post("/curriculum/sections", async (req, res) => {
  try {
    const userId = "1";
    const { lessonId, sectionIndex } = req.body;

    if (typeof lessonId !== "string" || typeof sectionIndex !== "number") {
      return res.status(400).json({ error: "lessonId (string) and sectionIndex (number) are required" });
    }

    const result = await curriculumStorage.markSectionViewed(userId, lessonId, sectionIndex);
    res.json(result);
  } catch (error) {
    console.error("[curriculum] Failed to mark section viewed:", error);
    res.status(500).json({ error: "Failed to mark section viewed" });
  }
});

// POST /api/curriculum/time
router.post("/curriculum/time", async (req, res) => {
  try {
    const userId = "1";
    const schema = z.object({
      lessonId: z.string().min(1),
      timeMs: z.number().int().positive(),
    });
    const { lessonId, timeMs } = schema.parse(req.body);
    await curriculumStorage.addTimeSpent(userId, lessonId, timeMs);
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: "Failed to add time spent" });
  }
});

// ─── Bookmarks & notes ──────────────────────────────────────────

// GET /api/curriculum/bookmarks
router.get("/curriculum/bookmarks", async (req, res) => {
  try {
    const userId = "1";
    const bookmarks = await curriculumStorage.getBookmarks(userId);
    res.json(bookmarks);
  } catch (error) {
    console.error("[curriculum] Failed to fetch bookmarks:", error);
    res.status(500).json({ error: "Failed to fetch bookmarks" });
  }
});

// POST /api/curriculum/bookmarks/toggle
router.post("/curriculum/bookmarks/toggle", async (req, res) => {
  try {
    const userId = "1";
    const { lessonId } = req.body;
    if (typeof lessonId !== "string") {
      return res.status(400).json({ error: "lessonId (string) is required" });
    }
    const result = await curriculumStorage.toggleBookmark(userId, lessonId);
    res.json(result);
  } catch (error) {
    console.error("[curriculum] Failed to toggle bookmark:", error);
    res.status(500).json({ error: "Failed to toggle bookmark" });
  }
});

// PUT /api/curriculum/bookmarks/note
router.put("/curriculum/bookmarks/note", async (req, res) => {
  try {
    const userId = "1";
    const { lessonId, note } = req.body;
    if (typeof lessonId !== "string" || typeof note !== "string") {
      return res.status(400).json({ error: "lessonId (string) and note (string) are required" });
    }
    const result = await curriculumStorage.updateNote(userId, lessonId, note);
    res.json(result);
  } catch (error) {
    console.error("[curriculum] Failed to update note:", error);
    res.status(500).json({ error: "Failed to update note" });
  }
});

export default router;
