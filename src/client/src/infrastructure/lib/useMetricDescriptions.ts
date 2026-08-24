/**
 * useMetricDescriptions — Load metric descriptions for a model type.
 *
 * Reads from config/metric-descriptions.json (served via /api/training/config).
 * Merges global defaults with model-specific overrides.
 * Returns a map of metric key — description object.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export interface MetricDescription {
  title: string;
  unit: string;
  color: string;
  format: "millions" | "percent" | "integer" | "decimal3" | "scientific" | "raw";
  description: string;
  detects: string;
  purpose: string;
  usage: string;
  crossMetrics: string;
  effect: string;
  healthy: string;
  target?: number;
  targetDirection?: "above" | "below";
  controlParameters?: string[];
  prescriptive?: {
    flags: Array<{ name: string; direction: string }>;
    low_signal_action?: string;
    high_overfit_action?: string;
    poor_calibration_action?: string;
    no_trades_action?: string;
  };
}

interface MetricDescriptionsConfig {
  version: number;
  global: Record<string, Partial<MetricDescription>>;
  models: Record<string, {
    metrics: Record<string, Partial<MetricDescription>>;
    metricOrder: string[];
    controlParameters?: Record<string, string[]>;
  }>;
}

async function fetchMetricDescriptions(signal?: AbortSignal): Promise<MetricDescriptionsConfig> {
  const resp = await fetch("/api/training/metric-descriptions", { signal });
  if (!resp.ok) throw new Error(`Failed to load metric descriptions: ${resp.status}`);
  return resp.json();
}

export function useMetricDescriptions(modelType: string) {
  const { data: config } = useQuery({
    queryKey: ["metric-descriptions"],
    queryFn: ({ signal }) => fetchMetricDescriptions(signal),
    staleTime: 60 * 60 * 1000, // 1 hour — config rarely changes
  });

  return useMemo(() => {
    if (!config) return { descriptions: {} as Record<string, MetricDescription>, metricOrder: [] as string[] };

    const globalMetrics = config.global ?? {};
    const modelConfig = config.models?.[modelType];
    const modelMetrics = modelConfig?.metrics ?? {};
    const metricOrder = modelConfig?.metricOrder ?? Object.keys(modelMetrics);
    const modelControls = modelConfig?.controlParameters ?? {};

    // Merge: model-specific overrides global
    const descriptions: Record<string, MetricDescription> = {};

    for (const key of metricOrder) {
      const global = globalMetrics[key] ?? {};
      const model = modelMetrics[key] ?? {};
      descriptions[key] = {
        title: model.title ?? global.title ?? key,
        unit: model.unit ?? global.unit ?? "raw",
        color: model.color ?? global.color ?? "#6b7280",
        format: (model.format ?? global.format ?? "raw") as MetricDescription["format"],
        description: model.description ?? global.description ?? "",
        detects: model.detects ?? global.detects ?? "",
        purpose: model.purpose ?? global.purpose ?? "",
        usage: model.usage ?? global.usage ?? "",
        crossMetrics: model.crossMetrics ?? global.crossMetrics ?? "",
        effect: model.effect ?? global.effect ?? "",
        healthy: model.healthy ?? global.healthy ?? "",
        target: model.target ?? global.target,
        targetDirection: model.targetDirection ?? global.targetDirection,
        controlParameters: modelControls[key] ?? [],
        prescriptive: model.prescriptive ?? global.prescriptive,
      };
    }

    return { descriptions, metricOrder };
  }, [config, modelType]);
}

/** Format a metric value for display based on its format type. */
export function formatMetricValue(value: number, format: MetricDescription["format"]): string {
  switch (format) {
    case "millions":
      return `${(value / 1e6).toFixed(2)}M`;
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "integer":
      return String(Math.round(value));
    case "decimal3":
      return value.toFixed(3);
    case "scientific":
      return value.toExponential(2);
    default:
      return value.toFixed(2);
  }
}
