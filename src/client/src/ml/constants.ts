/**
 * Category badges. Each value is a distinct colour — this is a categorical
 * palette, not a semantic scale, so no two categories may share one.
 *
 * `--data-pos` / `--data-neg` appear here as ordinary palette entries (orange
 * and blue), not as "good" and "bad". Every badge also renders its category
 * name as text, so colour is a fast index, never the only identifier.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  "generative": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "hybrid-composite": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "machine-learning": "bg-[hsl(var(--data-pos)/0.2)] text-[hsl(var(--data-pos))] border-[hsl(var(--data-pos)/0.3)]",
  "neural-network": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "optimization": "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "probabilistic-symbolic": "bg-pink-500/20 text-pink-400 border-pink-500/30",
  // Vermillion, not --data-neg: the codemod that removed red/green mapped both
  // this category (rose) and "supervised" (red) onto the same blue, silently
  // merging two categories that had always been distinct.
  "reinforcement-learning": "bg-[#D55E00]/20 text-[#D55E00] border-[#D55E00]/30",
  "simulation-decision": "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "statistical": "bg-teal-500/20 text-teal-400 border-teal-500/30",
  "self-supervised": "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  "semi-supervised": "bg-lime-500/20 text-lime-400 border-lime-500/30",
  "supervised": "bg-[hsl(var(--data-neg)/0.2)] text-[hsl(var(--data-neg))] border-[hsl(var(--data-neg)/0.3)]",
  "unsupervised": "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

export function categoryColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? "bg-muted text-muted-foreground";
}
