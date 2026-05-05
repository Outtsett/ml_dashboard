/**
 * ModelTabs — Constants and hooks shared across model tab panels.
 */

import { Activity, Layers, TrendingUp, Shield, Target, BarChart3, BarChart2, Terminal, GitCompareArrows } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/types";
import type { Diagnostics, ConvergencePoint } from "../types";
import { getModelTypeConfig } from "@/config/model-types";

// ─── Sub-tab definitions ─────────────────────────────────────────────────────

export const SUB_TABS = [
  { id: "overview",    label: "Overview",     icon: Activity,          requiredKeys: [] as string[] },
  { id: "regimes",     label: "Regimes",      icon: Layers,            requiredKeys: ["regime_stats"] },
  { id: "convergence", label: "Convergence",  icon: TrendingUp,        requiredKeys: ["convergence_summary"] },
  { id: "walkforward", label: "Walk-Forward", icon: Shield,            requiredKeys: ["walk_forward"] },
  { id: "oos",         label: "OOS",          icon: Target,            requiredKeys: ["out_of_sample"] },
  { id: "fit",         label: "Model Fit",    icon: BarChart3,         requiredKeys: ["convergence_summary"] },
  { id: "compare",     label: "Compare",      icon: GitCompareArrows,  requiredKeys: [] as string[] },
  { id: "analytics",   label: "Analytics",    icon: BarChart2,         requiredKeys: [] as string[] },
  { id: "log",         label: "Training Log", icon: Terminal,           requiredKeys: [] as string[] },
] as const;

export type SubTabId = typeof SUB_TABS[number]["id"];

/** Filter sub-tabs by model type config AND available diagnostics keys */
export function getVisibleSubTabs(diagnostics: Diagnostics | undefined, modelType?: string) {
  const config = getModelTypeConfig(modelType);
  const allowedIds = new Set(config.subTabs);

  // No diagnostics yet — show all model-type-allowed tabs
  if (!diagnostics) {
    return SUB_TABS.filter(tab => allowedIds.has(tab.id));
  }

  const d = diagnostics as unknown as Record<string, unknown>;
  return SUB_TABS.filter(tab => {
    if (!allowedIds.has(tab.id)) return false;
    return tab.requiredKeys.length === 0 || tab.requiredKeys.every(key => d[key] != null);
  });
}

// ─── Per-model diagnostics hook ──────────────────────────────────────────────

export function useModelDiagnostics(modelId: string) {
  const { data: diagnostics } = useQuery({
    queryKey: QUERY_KEYS.regimeDiagnostics(modelId),
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/diagnostics`);
      if (!res.ok) throw new Error("Failed to load diagnostics");
      return res.json() as Promise<Diagnostics>;
    },
    enabled: !!modelId,
    staleTime: 60_000,
  });

  const { data: convergenceData } = useQuery({
    queryKey: [...QUERY_KEYS.regimeDiagnostics(modelId), "convergence"],
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/convergence`);
      if (!res.ok) return null;
      return res.json() as Promise<Record<string, ConvergencePoint[]>>;
    },
    enabled: !!modelId,
    staleTime: 60_000,
  });

  return { diagnostics, convergenceData };
}
