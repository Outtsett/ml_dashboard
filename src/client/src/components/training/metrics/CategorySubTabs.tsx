/**
 * CategorySubTabs — Tab bar to switch between metric groups within a category.
 *
 * Think of it as: the drawer dividers in a filing cabinet — Cluster Quality,
 * Separation, Significance, OOS, Trading — each tab reveals a different section.
 *
 * SRP: Tab selection only. No metric rendering. No data fetching.
 */

import { useMemo, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CategoryMetricsConfig } from "@shared/categoryMetrics";

interface CategorySubTabsProps {
  config: CategoryMetricsConfig;
  /** Currently active group id */
  activeGroup: string | null;
  /** Callback when a group tab is clicked */
  onGroupChange: (groupId: string) => void;
}

export default function CategorySubTabs({ config, activeGroup, onGroupChange }: CategorySubTabsProps) {
  const groups = config.groups;
  const active = activeGroup ?? groups[0]?.id ?? '';

  if (groups.length <= 1) return null; // No tabs needed for single-group categories

  return (
    <Tabs value={active} onValueChange={onGroupChange} className="w-full">
      <TabsList className="w-full justify-start bg-transparent border-b border-white/5 rounded-none h-auto p-0 gap-0">
        {groups.map((g) => (
          <TabsTrigger
            key={g.id}
            value={g.id}
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary
                       data-[state=active]:bg-transparent data-[state=active]:text-primary
                       text-muted-foreground/60 text-xs px-3 py-2 transition-colors"
          >
            {g.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/**
 * Hook to manage sub-tab state for a category.
 * Returns current group + setter. Resets when category changes.
 */
export function useCategorySubTab(config: CategoryMetricsConfig | null) {
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  // Reset to first group when config changes
  const resolvedGroup = useMemo(() => {
    if (!config?.groups.length) return null;
    const valid = config.groups.some((g) => g.id === activeGroup);
    return valid ? activeGroup : config.groups[0]!.id;
  }, [config, activeGroup]);

  return {
    activeGroup: resolvedGroup,
    setActiveGroup,
    currentGroupConfig: config?.groups.find((g) => g.id === resolvedGroup) ?? null,
  };
}
