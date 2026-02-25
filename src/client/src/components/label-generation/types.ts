import { Target, BarChart3, TrendingUp, AlertTriangle, GitBranch, Tag } from "lucide-react";

export interface LabelGenerationProps {
  selectedSymbol: string;
  symbols: string[];
  onSymbolChange: (symbol: string) => void;
}

export interface LabelSet {
  id: number;
  name: string;
  generatorType: string;
  category: string;
  symbol: string;
  config: string;
  sampleCount: number;
  positiveCount: number | null;
  negativeCount: number | null;
  neutralCount: number | null;
  labelDistribution: string | null;
  status: string;
  createdAt: string;
  generationTimeMs: number | null;
}

export interface PreviewResult {
  success: boolean;
  preview?: Array<Record<string, unknown>>;
  count?: number;
  error?: string;
}

export const GENERATOR_ICONS: Record<string, typeof Tag> = {
  direction: Target,
  triple_barrier: BarChart3,
  npmm: TrendingUp,
  volatility_adaptive: AlertTriangle,
  trend_scanning: GitBranch,
  meta_label: Tag,
  future_return: TrendingUp,
  future_volatility: AlertTriangle,
  regime: Tag,
  contrastive_temporal: GitBranch,
  contrastive_augmentation: GitBranch,
  contrastive_statistical: GitBranch,
};

export const CATEGORY_COLORS: Record<string, string> = {
  classification: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  regression: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  sequence: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  contrastive: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
};
