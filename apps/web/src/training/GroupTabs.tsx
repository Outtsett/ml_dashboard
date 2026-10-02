/**
 * GroupTabs — Auto-generated group tab navigation from metric declarations.
 *
 * Extracts unique group names from SelfDescribingDiagnostics or metric
 * declarations, sorts them via GROUP_ORDER, and renders horizontal tabs
 * with section colors. Fully model-agnostic — different models produce
 * different tabs automatically.
 */

import { useMemo } from 'react';
import { getSectionColor, METRIC_GROUP_ORDER } from '@/ml/components/MetricGrid';
import { cn } from "@/shared/utils/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface GroupTabsProps {
  /** Metric declarations or diagnostics to extract groups from */
  metrics: Record<string, { group?: string }>;
  /** Currently active group */
  activeGroup: string;
  /** Callback when user clicks a different tab */
  onGroupChange: (group: string) => void;
  /** Optional className */
  className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractSortedGroups(
  metrics: Record<string, { group?: string }>,
): string[] {
  const groupSet = new Set<string>();
  for (const metric of Object.values(metrics)) {
    groupSet.add(metric.group ?? 'general');
  }

  return Array.from(groupSet).sort((a, b) => {
    const orderA = METRIC_GROUP_ORDER[a] ?? 50;
    const orderB = METRIC_GROUP_ORDER[b] ?? 50;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b);
  });
}

function formatLabel(group: string): string {
  return group.replace(/_/g, ' ').toUpperCase();
}

// ─── Component ──────────────────────────────────────────────────────────────

export function GroupTabs({
  metrics,
  activeGroup,
  onGroupChange,
  className,
}: GroupTabsProps) {
  const groups = useMemo(() => extractSortedGroups(metrics), [metrics]);

  if (groups.length <= 1) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1 border-b border-white/5 bg-[#111113] px-1',
        className,
      )}
    >
      {groups.map((group) => {
        const isActive = group === activeGroup;
        const colors = getSectionColor(group);

        return (
          <button
            key={group}
            type="button"
            onClick={() => onGroupChange(group)}
            className={cn(
              'relative px-3 py-2 text-xs font-medium uppercase tracking-widest transition-colors',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20',
              isActive
                ? colors.text
                : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {formatLabel(group)}

            {/* Active indicator — colored bottom border */}
            {isActive && (
              <span
                className={cn(
                  'absolute inset-x-0 bottom-0 h-0.5 rounded-full',
                  colors.line,
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default GroupTabs;
