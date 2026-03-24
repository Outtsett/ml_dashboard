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
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressRing } from "./ProgressRing";
import type { LearningPath, PathProgress } from "@/lib/curriculum/types";

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

interface CurriculumOverviewProps {
  paths: LearningPath[];
  pathProgress: PathProgress[];
  onSelectPath: (pathId: string) => void;
}

export function CurriculumOverview({
  paths,
  pathProgress,
  onSelectPath,
}: CurriculumOverviewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
      {paths.map((path) => {
        const progress = pathProgress.find((p) => p.pathId === path.id);
        const pct = progress
          ? Math.round((progress.completedLessons / progress.totalLessons) * 100)
          : 0;
        const IconComp = ICON_MAP[path.icon] ?? BookOpen;
        const colors = COLOR_STYLES[path.color] ?? COLOR_STYLES.blue;
        const totalLessons = path.modules.reduce(
          (s, m) => s + m.lessons.length,
          0
        );

        return (
          <Card
            key={path.id}
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
        );
      })}
    </div>
  );
}
