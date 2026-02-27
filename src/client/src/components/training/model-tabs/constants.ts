/**
 * ModelTabs — Constants and hooks shared across model tab panels.
 */

import { Activity, Layers, TrendingUp, Shield, Target, BarChart3, Terminal } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/types";
import type { Diagnostics, ConvergencePoint } from "../types";

// ─── Sub-tab definitions ─────────────────────────────────────────────────────

export const SUB_TABS = [
  { id: "overview",    label: "Overview",     icon: Activity },
  { id: "regimes",     label: "Regimes",      icon: Layers },
  { id: "convergence", label: "Convergence",  icon: TrendingUp },
  { id: "walkforward", label: "Walk-Forward", icon: Shield },
  { id: "oos",         label: "OOS",          icon: Target },
  { id: "fit",         label: "Model Fit",    icon: BarChart3 },
  { id: "log",         label: "Training Log", icon: Terminal },
] as const;

export type SubTabId = typeof SUB_TABS[number]["id"];

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
