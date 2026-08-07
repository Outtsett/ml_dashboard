/**
 * PercentRenderer — Horizontal fill bar from 0-100%.
 *
 * Gradient fill colored by severity.
 * Percentage value overlaid on the bar.
 * Baseline marker if context.baseline exists.
 */

import { useMemo } from 'react';
import type { RendererProps } from "@/ml/lib/diagnostics-schema";
import { getMetricSeverity, SEVERITY_COLORS } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from './RendererShell';
import { cn } from "@/shared/utils/utils";

const FILL_GRADIENT: Record<string, string> = {
  great: 'from-[hsl(var(--data-pos))] to-[hsl(var(--data-pos))]',
  good: 'from-cyan-600 to-cyan-400',
  neutral: 'from-zinc-600 to-zinc-400',
  bad: 'from-[hsl(var(--data-neg))] to-[hsl(var(--data-neg))]',
};

const FILL_SHADOW: Record<string, string> = {
  great: 'shadow-[0_0_12px_rgba(52,211,153,0.3)]',
  good: 'shadow-[0_0_12px_rgba(34,211,238,0.3)]',
  neutral: 'shadow-[0_0_12px_rgba(113,113,122,0.2)]',
  bad: 'shadow-[0_0_12px_rgba(248,113,113,0.3)]',
};

export function PercentRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);
  const rawValue = typeof props.metric.value === 'number' ? props.metric.value : 0;

  // Normalize: if value is 0-1, treat as fraction; if > 1, treat as already percentage
  const fraction = rawValue > 1 ? rawValue / 100 : rawValue;
  const percent = Math.max(0, Math.min(100, fraction * 100));
  const severity = getMetricSeverity(rawValue, context);

  const baselinePercent = useMemo(() => {
    if (context.baseline == null) return null;
    const bl = context.baseline > 1 ? context.baseline : context.baseline * 100;
    return Math.max(0, Math.min(100, bl));
  }, [context.baseline]);

  const barHeight = compact ? 'h-6' : 'h-8';

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity={severity}>
      <div className={cn('flex flex-col gap-2', compact ? 'py-1' : 'py-2')}>
        {/* Value display */}
        <div className="flex items-baseline justify-between">
          <span
            className={cn(
              'font-mono font-bold metric-glow',
              SEVERITY_COLORS[severity],
              compact ? 'text-xl' : 'text-2xl',
            )}
          >
            {percent.toFixed(context.decimals ?? 1)}%
          </span>
          {baselinePercent != null && (
            <span className="text-[9px] font-mono text-amber-400/60 tracking-wide">
              baseline {baselinePercent.toFixed(1)}%
            </span>
          )}
        </div>

        {/* Bar container */}
        <div className={cn('relative w-full rounded-sm overflow-hidden bg-zinc-800/60', barHeight)}>
          {/* Fill gradient */}
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-sm bg-gradient-to-r transition-all duration-700 ease-out',
              FILL_GRADIENT[severity],
              FILL_SHADOW[severity],
            )}
            style={{ width: `${percent}%` }}
          />

          {/* Baseline marker */}
          {baselinePercent != null && (
            <div
              className="absolute inset-y-0 w-[2px] z-10"
              style={{ left: `${baselinePercent}%` }}
            >
              <div className="w-full h-full border-l-2 border-dashed border-amber-400/50" />
            </div>
          )}

          {/* Percentage text overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className={cn(
                'font-mono font-semibold text-white/80 drop-shadow-sm',
                compact ? 'text-[10px]' : 'text-xs',
              )}
            >
              {percent.toFixed(context.decimals ?? 1)}%
            </span>
          </div>
        </div>

        {/* Scale markers */}
        <div className="flex justify-between text-[8px] font-mono text-zinc-600">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    </RendererShell>
  );
}
