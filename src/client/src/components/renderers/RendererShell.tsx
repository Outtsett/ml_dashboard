/**
 * Shared card shell for all metric renderers.
 * Provides consistent chrome: mission header, severity-tinted border, compact mode.
 * When metric.value is null/undefined, shows an "awaiting data" overlay with context goals.
 * Hover tooltip shows mission, direction, and all threshold values.
 */

import type { ReactNode } from 'react';
import type { RendererProps, MetricContext } from '@/lib/diagnostics-schema';
import { cn } from '@/lib/utils';
import { Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface RendererShellProps {
  metricKey: string;
  mission: string;
  compact?: boolean;
  severity?: 'great' | 'good' | 'neutral' | 'bad';
  className?: string;
  /** When true, shows awaiting-data overlay instead of children */
  awaitingData?: boolean;
  /** Context thresholds to display as goals in awaiting state and tooltip */
  context?: MetricContext;
  /** Optional section-colored border accent (hex or tailwind color string) */
  groupColor?: string;
  children: ReactNode;
}

const BORDER_TINT: Record<string, string> = {
  great: 'border-emerald-500/15',
  good: 'border-cyan-500/15',
  neutral: 'border-zinc-700/60',
  bad: 'border-red-500/15',
};

const GLOW_TINT: Record<string, string> = {
  great: 'shadow-[0_0_20px_-8px_rgba(52,211,153,0.12)]',
  good: 'shadow-[0_0_20px_-8px_rgba(34,211,238,0.12)]',
  neutral: '',
  bad: 'shadow-[0_0_20px_-8px_rgba(248,113,113,0.12)]',
};

function AwaitingOverlay({ context, compact }: { context?: MetricContext; compact?: boolean }) {
  const goals: string[] = [];
  if (context?.good != null) goals.push(`Good: ${context.good}${context.unit ? ' ' + context.unit : ''}`);
  if (context?.great != null) goals.push(`Great: ${context.great}${context.unit ? ' ' + context.unit : ''}`);
  if (context?.breakeven != null) goals.push(`Breakeven: ${context.breakeven}`);
  if (context?.baseline != null) goals.push(`Baseline: ${context.baseline}`);

  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "py-4" : "py-6")}>
      <Clock className="w-5 h-5 text-zinc-600 mb-2" />
      <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-2">
        Awaiting Training
      </span>
      {goals.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
          {goals.map((g, i) => (
            <span key={i} className="text-[9px] font-mono text-zinc-500/70">
              {g}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TooltipBody({ mission, context }: { mission: string; context?: MetricContext }) {
  const unit = context?.unit ? ` ${context.unit}` : '';

  const thresholds: { label: string; value: number }[] = [];
  if (context?.great != null) thresholds.push({ label: 'Great', value: context.great });
  if (context?.good != null) thresholds.push({ label: 'Good', value: context.good });
  if (context?.breakeven != null) thresholds.push({ label: 'Breakeven', value: context.breakeven });
  if (context?.baseline != null) thresholds.push({ label: 'Baseline', value: context.baseline });
  if (context?.bad != null) thresholds.push({ label: 'Bad', value: context.bad });

  const direction =
    context?.higher_is_better === true
      ? 'Higher is better'
      : context?.higher_is_better === false
        ? 'Lower is better'
        : null;

  return (
    <div className="space-y-1.5 max-w-[220px]">
      <p className="text-zinc-200 font-medium leading-snug">{mission}</p>
      {direction && (
        <p className="text-zinc-500 text-[10px] uppercase tracking-wider">{direction}</p>
      )}
      {thresholds.length > 0 && (
        <div className="border-t border-zinc-700/50 pt-1.5 space-y-0.5">
          {thresholds.map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-zinc-500">{label}</span>
              <span className="text-zinc-300 font-mono">
                {value}{unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RendererShell({
  metricKey,
  mission,
  compact,
  severity = 'neutral',
  className,
  awaitingData,
  context,
  groupColor,
  children,
}: RendererShellProps) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div
          data-metric={metricKey}
          style={groupColor ? { borderColor: groupColor } : undefined}
          className={cn(
            'glass-elevated gradient-accent-top rounded-lg overflow-hidden transition-all duration-300',
            'border',
            awaitingData ? 'border-zinc-800/60 opacity-80' : groupColor ? '' : BORDER_TINT[severity],
            awaitingData ? '' : GLOW_TINT[severity],
            compact ? 'p-2.5' : 'p-3.5',
            className,
          )}
        >
          <div className={cn('mb-2', compact && 'mb-1.5')}>
            <h4
              className={cn(
                'font-mono font-medium uppercase tracking-wider leading-tight',
                awaitingData ? 'text-zinc-500' : 'text-zinc-400',
                compact ? 'text-[9px]' : 'text-[10px]',
              )}
            >
              {metricKey.replace(/_/g, ' ')}
            </h4>
          </div>
          {awaitingData ? <AwaitingOverlay context={context} compact={compact} /> : children}
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="bg-zinc-900 border border-zinc-700/50 px-3 py-2 text-xs"
      >
        <TooltipBody mission={mission} context={context} />
      </TooltipContent>
    </Tooltip>
  );
}

/** Extracts common shell props from RendererProps, including awaiting-data detection. */
export function useShellProps(props: RendererProps) {
  const value = props.metric.value;
  const awaitingData = value === null || value === undefined;
  return {
    metricKey: props.metricKey,
    mission: props.metric.mission,
    compact: props.compact,
    context: props.metric.context,
    awaitingData,
  };
}
