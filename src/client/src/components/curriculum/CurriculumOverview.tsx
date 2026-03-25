import { useState, useMemo, useCallback, useRef, type ReactNode } from "react";
import Fuse from "fuse.js";
import type { FuseResultMatch } from "fuse.js";
import {
  Calculator,
  TreeDeciduous,
  Activity,
  Brain,
  Gamepad2,
  Sparkles,
  TrendingUp,
  BookOpen,
  Clock,
  Layers,
  Sigma,
  Cpu,
  Search,
  X,
  BookmarkCheck,
  ChevronDown,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressRing } from "./ProgressRing";
import { allPaths, getLesson } from "@/lib/curriculum/paths";
import { useBookmarks } from "@/hooks/useCurriculum";
import type { LearningPath, PathProgress, Difficulty } from "@/lib/curriculum/types";

// Map icon name strings to actual icon components
const ICON_MAP: Record<string, LucideIcon> = {
  Calculator,
  TreeDeciduous,
  Activity,
  Brain,
  Gamepad2,
  Sparkles,
  TrendingUp,
  BookOpen,
  Sigma,
  Cpu,
};

// Color styles per path color key
const DEFAULT_COLORS = {
  card: "hover:border-blue-500/40 hover:shadow-[0_0_20px_-5px_hsla(210,70%,50%,0.15)]",
  icon: "bg-blue-500/15 text-blue-400",
  badge: "bg-blue-500/10 text-blue-400 border-blue-500/30",
} as const;

const COLOR_STYLES: Record<string, { card: string; icon: string; badge: string }> = {
  blue: {
    card: "hover:border-blue-500/40 hover:shadow-[0_0_20px_-5px_hsla(210,70%,50%,0.15)]",
    icon: "bg-blue-500/15 text-blue-400",
    badge: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
  emerald: {
    card: "hover:border-emerald-500/40 hover:shadow-[0_0_20px_-5px_hsla(150,70%,50%,0.15)]",
    icon: "bg-emerald-500/15 text-emerald-400",
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  violet: {
    card: "hover:border-violet-500/40 hover:shadow-[0_0_20px_-5px_hsla(270,70%,50%,0.15)]",
    icon: "bg-violet-500/15 text-violet-400",
    badge: "bg-violet-500/10 text-violet-400 border-violet-500/30",
  },
  rose: {
    card: "hover:border-rose-500/40 hover:shadow-[0_0_20px_-5px_hsla(350,70%,50%,0.15)]",
    icon: "bg-rose-500/15 text-rose-400",
    badge: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  },
  amber: {
    card: "hover:border-amber-500/40 hover:shadow-[0_0_20px_-5px_hsla(35,70%,50%,0.15)]",
    icon: "bg-amber-500/15 text-amber-400",
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  },
  pink: {
    card: "hover:border-pink-500/40 hover:shadow-[0_0_20px_-5px_hsla(330,70%,50%,0.15)]",
    icon: "bg-pink-500/15 text-pink-400",
    badge: "bg-pink-500/10 text-pink-400 border-pink-500/30",
  },
  cyan: {
    card: "hover:border-cyan-500/40 hover:shadow-[0_0_20px_-5px_hsla(185,70%,50%,0.15)]",
    icon: "bg-cyan-500/15 text-cyan-400",
    badge: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  },
};

const difficultyLabels: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

// ─── Search types ───────────────────────────────────────────────

interface SearchItem {
  pathId: string;
  pathTitle: string;
  pathColor: string;
  moduleTitle: string;
  lessonId: string;
  lessonTitle: string;
  lessonDescription: string;
  difficulty: Difficulty;
  estimatedMinutes: number;
}

// Build the flat search list once from allPaths
const searchItems: SearchItem[] = allPaths.flatMap((path) =>
  path.modules.flatMap((mod) =>
    mod.lessons.map((lesson) => ({
      pathId: path.id,
      pathTitle: path.title,
      pathColor: path.color,
      moduleTitle: mod.title,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      lessonDescription: lesson.description,
      difficulty: lesson.difficulty,
      estimatedMinutes: lesson.estimatedMinutes,
    }))
  )
);

const fuseInstance = new Fuse(searchItems, {
  keys: [
    { name: "lessonTitle", weight: 1.0 },
    { name: "lessonDescription", weight: 0.7 },
    { name: "moduleTitle", weight: 0.5 },
    { name: "pathTitle", weight: 0.3 },
  ],
  threshold: 0.4,
  includeMatches: true,
  minMatchCharLength: 2,
});

// ─── Highlight helper ───────────────────────────────────────────

function highlightMatches(
  text: string,
  matches: readonly FuseResultMatch[] | undefined,
  key: string
): ReactNode {
  if (!matches) return text;
  const match = matches.find((m) => m.key === key);
  if (!match?.indices.length) return text;

  // Merge overlapping indices
  const sorted = [...match.indices].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + 1) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (cursor < s) parts.push(text.slice(cursor, s));
    parts.push(
      <mark key={s} className="bg-yellow-400/25 text-foreground rounded-sm px-0.5">
        {text.slice(s, e + 1)}
      </mark>
    );
    cursor = e + 1;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

// ─── Component ──────────────────────────────────────────────────

interface CurriculumOverviewProps {
  paths: LearningPath[];
  pathProgress: PathProgress[];
  onSelectPath: (pathId: string) => void;
  onSelectLesson?: (pathId: string, lessonId: string) => void;
}

export function CurriculumOverview({
  paths,
  pathProgress,
  onSelectPath,
  onSelectLesson,
}: CurriculumOverviewProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (query.length < 2) return [];
    return fuseInstance.search(query, { limit: 30 });
  }, [query]);

  const isSearching = query.length >= 2;

  const clearSearch = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);

  // ─── Bookmarks ──────────────────────────────────────────────────
  const { data: bookmarks = [] } = useBookmarks();
  const [bookmarksOpen, setBookmarksOpen] = useState(true);

  const bookmarkCards = useMemo(() => {
    return bookmarks
      .map((bm) => {
        const info = getLesson(bm.lessonId);
        if (!info) return null;
        return { bookmark: bm, path: info.path, module: info.module, lesson: info.lesson };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [bookmarks]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search lessons..."
          className="w-full bg-muted/20 border border-border/30 rounded-lg pl-9 pr-9 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring/40 transition-colors"
        />
        {query.length > 0 && (
          <button
            onClick={clearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Bookmarked lessons */}
      {bookmarkCards.length > 0 && !isSearching && (
        <div>
          <button
            onClick={() => setBookmarksOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <BookmarkCheck className="h-3.5 w-3.5 text-amber-400" />
            Bookmarks ({bookmarkCards.length})
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${bookmarksOpen ? "rotate-0" : "-rotate-90"}`}
            />
          </button>
          <AnimatePresence>
            {bookmarksOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border/30">
                  {bookmarkCards.map(({ bookmark, path, lesson }) => {
                    const colors = COLOR_STYLES[path.color] ?? DEFAULT_COLORS;
                    return (
                      <button
                        key={bookmark.id}
                        onClick={() => onSelectLesson?.(path.id, lesson.id)}
                        className="flex-shrink-0 w-56 text-left rounded-lg border border-border/20 bg-card/40 px-3 py-2.5 hover:bg-muted/15 transition-colors cursor-pointer group"
                      >
                        <h4 className="text-xs font-medium truncate group-hover:text-foreground">
                          {lesson.title}
                        </h4>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 mt-1 ${colors.badge}`}>
                          {path.title}
                        </Badge>
                        {bookmark.note && (
                          <p className="text-[10px] text-muted-foreground/70 mt-1.5 flex items-start gap-1 line-clamp-1">
                            <StickyNote className="h-3 w-3 flex-shrink-0 mt-px" />
                            {bookmark.note.length > 50 ? bookmark.note.slice(0, 50) + "…" : bookmark.note}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence mode="wait">
        {isSearching ? (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Search className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm">No results found for &ldquo;{query}&rdquo;</p>
              </div>
            ) : (
              <motion.div
                className="flex flex-col gap-2"
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
              >
                <p className="text-xs text-muted-foreground mb-1">
                  {results.length} result{results.length !== 1 && "s"}
                </p>
                {results.map(({ item, matches }) => {
                  const colors = COLOR_STYLES[item.pathColor] ?? DEFAULT_COLORS;
                  return (
                    <motion.button
                      key={`${item.pathId}-${item.lessonId}`}
                      onClick={() => onSelectLesson?.(item.pathId, item.lessonId)}
                      variants={{
                        hidden: { opacity: 0, y: 10 },
                        show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
                      }}
                      className="w-full text-left rounded-lg border border-border/20 bg-card/40 px-4 py-3 hover:bg-muted/15 transition-colors cursor-pointer group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <h4 className="text-sm font-medium tracking-tight truncate group-hover:text-foreground">
                            {highlightMatches(item.lessonTitle, matches, "lessonTitle")}
                          </h4>
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {highlightMatches(item.lessonDescription, matches, "lessonDescription")}
                          </p>
                          <div className="flex items-center gap-2 pt-0.5">
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colors.badge}`}>
                              {highlightMatches(item.pathTitle, matches, "pathTitle")}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              {highlightMatches(item.moduleTitle, matches, "moduleTitle")}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge variant="outline" className="text-[10px] border-border/30">
                            {difficultyLabels[item.difficulty]}
                          </Badge>
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {item.estimatedMinutes}m
                          </span>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="grid"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
            >
              {paths.map((path) => {
                const progress = pathProgress.find((p) => p.pathId === path.id);
                const pct = progress
                  ? Math.round((progress.completedLessons / progress.totalLessons) * 100)
                  : 0;
                const IconComp = ICON_MAP[path.icon] ?? BookOpen;
                const colors = COLOR_STYLES[path.color] ?? DEFAULT_COLORS;
                const totalLessons = path.modules.reduce(
                  (s, m) => s + m.lessons.length,
                  0
                );

                return (
                  <motion.div
                    key={path.id}
                    variants={{
                      hidden: { opacity: 0, y: 16 },
                      show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
                    }}
                  >
                    <Card
                      onClick={() => onSelectPath(path.id)}
                      className={`cursor-pointer border-border/30 bg-card/60 transition-all duration-200 ${colors.card}`}
                    >
                      <CardContent className="p-5 space-y-4">
                        {/* Header */}
                        <div className="flex items-start justify-between">
                          <div className={`p-2.5 rounded-xl ${colors.icon}`}>
                            <IconComp className="h-5 w-5" />
                          </div>
                          <ProgressRing value={pct} size={42} strokeWidth={3} />
                        </div>

                        {/* Title + description */}
                        <div className="space-y-1">
                          <h3 className="text-base font-semibold tracking-tight leading-tight">
                            {path.title}
                          </h3>
                          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                            {path.description}
                          </p>
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            {path.modules.length} modules
                          </span>
                          <span className="flex items-center gap-1">
                            <BookOpen className="h-3 w-3" />
                            {totalLessons} lessons
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {path.estimatedHours}h
                          </span>
                        </div>

                        {/* Footer badges */}
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className={`text-[10px] ${colors.badge}`}>
                            {difficultyLabels[path.difficulty]}
                          </Badge>
                          {progress && progress.completedLessons > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {progress.completedLessons}/{progress.totalLessons} done
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
