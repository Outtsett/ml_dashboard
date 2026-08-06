/**
 * useVisualizationRegistry — Resolve visualization components for a model category.
 *
 * SRP: Fetches config, resolves component list. No rendering.
 * DIP: Components depend on this hook, not raw API calls.
 */

import { useQuery } from "@tanstack/react-query";

interface VisualizationConfig {
  universal: string[];
  components: string[];
  conditional: Record<string, string[]>;
}

export function useVisualizationRegistry(subcategory: string | null) {
  return useQuery<VisualizationConfig>({
    queryKey: ["visualizations", subcategory],
    queryFn: async () => {
      if (!subcategory) return { universal: [], components: [], conditional: {} };
      const res = await fetch(`/api/training/visualizations/${subcategory}`);
      if (!res.ok) throw new Error("Failed to load visualization config");
      return res.json();
    },
    enabled: !!subcategory,
    staleTime: Infinity, // Config doesn't change during a session
  });
}

/** Resolve all component IDs for a model (universal + group + conditional). */
export function resolveComponents(
  config: VisualizationConfig | undefined,
  modelType?: string,
): string[] {
  if (!config) return [];

  const components = [...config.universal, ...config.components];

  // Add conditional components if modelType matches a trigger
  if (modelType && config.conditional) {
    for (const [trigger, extras] of Object.entries(config.conditional)) {
      if (modelType.includes(trigger)) {
        components.push(...extras);
      }
    }
  }

  return components;
}
