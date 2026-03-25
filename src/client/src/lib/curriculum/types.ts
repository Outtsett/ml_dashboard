// ─── Curriculum Content Types ────────────────────────────────────
// Defines the full content model: Learning Paths → Modules → Lessons → Sections

import type { LucideIcon } from "lucide-react";

/** Difficulty level for paths, modules, or lessons */
export type Difficulty = "beginner" | "intermediate" | "advanced";

/** Status for tracking user progress */
export type LessonStatus = "not_started" | "in_progress" | "completed";

/** Section types within a lesson */
export type SectionType =
  | "objective"
  | "theory"
  | "intuition"
  | "code"
  | "quiz"
  | "practice";

// ─── Quiz Types ─────────────────────────────────────────────────

export interface QuizOption {
  id: string;
  text: string;
  /** Some content marks correct answer on each option */
  isCorrect?: boolean;
  correct?: boolean;
}

export interface QuizQuestion {
  id: string;
  /** Primary question text field */
  question?: string;
  /** Alternative question text used in some content files */
  text?: string;
  options: QuizOption[];
  /** Correct option ID — may be derived from option-level isCorrect/correct flags */
  correctOptionId?: string;
  explanation: string;
}

// ─── Section Types ──────────────────────────────────────────────

export interface ObjectiveSection {
  type: "objective";
  title?: string;
  content: string;
  keyTakeaways: string[];
}

export interface TheorySection {
  type: "theory";
  title: string;
  content: string; // supports markdown-like formatting
}

export interface IntuitionSection {
  type: "intuition";
  title: string;
  analogy?: string;
  content: string;
  emoji?: string;
}

export interface CodeSection {
  type: "code";
  title: string;
  language: "python" | "typescript";
  code: string;
  explanation: string;
}

export interface QuizSection {
  type: "quiz";
  questions: QuizQuestion[];
}

export interface PracticeSection {
  type: "practice";
  title: string;
  description: string;
  /** Structured practice tasks */
  tasks?: string[];
  /** Model catalog ID to link to (e.g., "xgboost", "lstm") */
  catalogModelId?: string;
  /** External resource URL */
  resourceUrl?: string;
}

export type LessonSection =
  | ObjectiveSection
  | TheorySection
  | IntuitionSection
  | CodeSection
  | QuizSection
  | PracticeSection;

// ─── Lesson ─────────────────────────────────────────────────────

export interface Lesson {
  id: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  difficulty: Difficulty;
  sections: LessonSection[];
  /** Model catalog IDs this lesson references */
  relatedModels?: string[];
  /** Prerequisites (other lesson IDs) */
  prerequisites?: string[];
}

// ─── Module ─────────────────────────────────────────────────────

export interface Module {
  id: string;
  title: string;
  description: string;
  lessons: Lesson[];
}

// ─── Learning Path ──────────────────────────────────────────────

export interface LearningPath {
  id: string;
  title: string;
  description: string;
  icon: string; // lucide icon name (resolved at render time)
  color: string; // tailwind color class (e.g., "blue", "emerald")
  difficulty: Difficulty;
  modules: Module[];
  /** Estimated total hours */
  estimatedHours: number;
}

// ─── Progress Types (client-side aggregates) ────────────────────

export interface LessonProgress {
  lessonId: string;
  status: LessonStatus;
  score?: number;
  completedAt?: number;
  timeSpentMs?: number;
}

export interface PathProgress {
  pathId: string;
  totalLessons: number;
  completedLessons: number;
  inProgressLessons: number;
  averageScore?: number;
}

// ─── Curriculum Stats ───────────────────────────────────────────

export interface CurriculumStats {
  totalPaths: number;
  totalModules: number;
  totalLessons: number;
  completedLessons: number;
  averageScore: number;
  streakDays: number;
}

export interface CurriculumBookmark {
  id: number;
  userId: string;
  lessonId: string;
  note: string | null;
  createdAt: Date | number;
  updatedAt: Date | number;
}
