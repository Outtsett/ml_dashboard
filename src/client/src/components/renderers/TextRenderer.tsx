/**
 * TextRenderer — Plain text display with optional severity coloring.
 *
 * Supports multi-line. Monospace font for code/data.
 * Severity coloring based on context thresholds if value is numeric.
 */

import type { RendererProps } from '@/lib/diagnostics-schema';
import { getMetricSeverity, SEVERITY_COLORS } from '@/lib/diagnostics-schema';
import { RendererShell, useShellProps } from './RendererShell';
import { cn } from '@/lib/utils';

function extractText(value: RendererProps['metric']['value']): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(v => String(v)).join('\n');
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  }
  return '';
}

export function TextRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);
  const text = extractText(props.metric.value);

  // If the value is numeric, compute severity for coloring
  const numericValue = typeof props.metric.value === 'number' ? props.metric.value : null;
  const severity = numericValue != null ? getMetricSeverity(numericValue, context) : 'neutral';
  const textColor = numericValue != null && (context.good != null || context.bad != null || context.great != null)
    ? SEVERITY_COLORS[severity]
    : 'text-zinc-300';

  const lines = text.split('\n');
  const isMultiLine = lines.length > 1;

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity={severity}>
      <div className={cn(compact ? 'py-1' : 'py-2')}>
        {isMultiLine ? (
          <pre
            className={cn(
              'font-mono whitespace-pre-wrap break-words leading-relaxed',
              textColor,
              compact ? 'text-[10px]' : 'text-xs',
              'bg-zinc-900/50 rounded-md p-2 border border-zinc-800/50',
            )}
          >
            {lines.map((line, i) => (
              <span key={i}>
                {line}
                {i < lines.length - 1 && '\n'}
              </span>
            ))}
          </pre>
        ) : (
          <p
            className={cn(
              'font-mono leading-relaxed',
              textColor,
              compact ? 'text-xs' : 'text-sm',
            )}
          >
            {text || '--'}
          </p>
        )}
      </div>
    </RendererShell>
  );
}
