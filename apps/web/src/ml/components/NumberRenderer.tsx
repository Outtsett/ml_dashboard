/**
 * NumberRenderer — Large formatted number with severity coloring.
 *
 * Animated count-up on mount using requestAnimationFrame.
 * Shows mission as subtitle, unit suffix from context.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { RendererProps } from "@/ml/lib/diagnostics-schema";
import { getMetricSeverity, formatMetricValue, SEVERITY_COLORS } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from './RendererShell';
import { cn } from "@/shared/utils/utils";

const ANIM_DURATION_MS = 800;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function NumberRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);
  const value = typeof props.metric.value === 'number' ? props.metric.value : 0;
  const severity = getMetricSeverity(value, context);
  const formatted = formatMetricValue(value, context);

  const [displayValue, setDisplayValue] = useState('0');
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const animate = useCallback(
    (timestamp: number) => {
      if (startTimeRef.current === null) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / ANIM_DURATION_MS, 1);
      const easedProgress = easeOutCubic(progress);

      const currentValue = easedProgress * value;
      const decimals = context.decimals ?? 2;
      const unit = context.unit ?? '';

      if (unit === '%') {
        setDisplayValue(`${(currentValue * 100).toFixed(decimals)}%`);
      } else {
        setDisplayValue(`${currentValue.toFixed(decimals)}${unit ? ' ' + unit : ''}`);
      }

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(formatted);
      }
    },
    [value, context, formatted],
  );

  useEffect(() => {
    startTimeRef.current = null;
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [animate]);

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity={severity}>
      <div className={cn('flex flex-col items-center justify-center', compact ? 'py-2' : 'py-4')}>
        <span
          className={cn(
            'font-mono font-black tracking-tighter metric-glow transition-colors duration-300',
            SEVERITY_COLORS[severity],
            compact ? 'text-3xl' : 'text-5xl',
          )}
        >
          {displayValue}
        </span>
        <span
          className={cn(
            'uppercase tracking-[0.25em] text-zinc-500 font-semibold mt-2',
            compact ? 'text-[8px]' : 'text-[10px]',
          )}
        >
          {metricKey.replace(/_/g, ' ')}
        </span>
      </div>
    </RendererShell>
  );
}
