export const CATEGORY_COLORS: Record<string, string> = {
  "generative": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "hybrid-composite": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "machine-learning": "bg-green-500/20 text-green-400 border-green-500/30",
  "neural-network": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "optimization": "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "probabilistic-symbolic": "bg-pink-500/20 text-pink-400 border-pink-500/30",
  "reinforcement-learning": "bg-red-500/20 text-red-400 border-red-500/30",
  "simulation-decision": "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "statistical": "bg-teal-500/20 text-teal-400 border-teal-500/30",
  "self-supervised": "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  "semi-supervised": "bg-lime-500/20 text-lime-400 border-lime-500/30",
  "supervised": "bg-rose-500/20 text-rose-400 border-rose-500/30",
  "unsupervised": "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

export function categoryColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? "bg-muted text-muted-foreground";
}
