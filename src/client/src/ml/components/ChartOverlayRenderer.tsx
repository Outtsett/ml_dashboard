/**
 * ChartOverlayRenderer — Placeholder for predictions overlay on TradingChart.
 *
 * Shows compact summary (symbol, timeframe, prediction count) with a
 * "Open in chart view" link/button. Actual overlay rendering happens
 * in the TradingChart component.
 */

import type { RendererProps } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from './RendererShell';
import { cn } from "@/shared/utils/utils";

function countPredictions(value: RendererProps['metric']['value']): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v['count'] === 'number') return v['count'];
    return Object.keys(v).length;
  }
  return 0;
}

export function ChartOverlayRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);
  const predCount = countPredictions(props.metric.value);

  // Extract symbol/timeframe from data_source or context
  const dataSource = context.data_source ?? '';
  const parts = dataSource.split('/').filter(Boolean);
  const symbol = parts[0] ?? '--';
  const timeframe = parts[1] ?? '--';

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
      <div className={cn('flex flex-col items-center gap-3', compact ? 'py-2' : 'py-4')}>
        {/* Icon area — stylized chart representation */}
        <div className="relative w-16 h-10">
          <svg width="64" height="40" viewBox="0 0 64 40" className="overflow-visible">
            {/* Candlestick silhouettes */}
            <rect x="4" y="10" width="3" height="18" rx="1" fill="#3f3f46" opacity="0.5" />
            <line x1="5.5" y1="6" x2="5.5" y2="32" stroke="#3f3f46" strokeWidth="1" opacity="0.3" />
            <rect x="14" y="14" width="3" height="12" rx="1" fill="#22d3ee" opacity="0.4" />
            <line x1="15.5" y1="8" x2="15.5" y2="30" stroke="#22d3ee" strokeWidth="1" opacity="0.3" />
            <rect x="24" y="8" width="3" height="20" rx="1" fill="#ef4444" opacity="0.4" />
            <line x1="25.5" y1="4" x2="25.5" y2="32" stroke="#ef4444" strokeWidth="1" opacity="0.3" />
            <rect x="34" y="12" width="3" height="14" rx="1" fill="#22d3ee" opacity="0.4" />
            <line x1="35.5" y1="6" x2="35.5" y2="30" stroke="#22d3ee" strokeWidth="1" opacity="0.3" />
            <rect x="44" y="6" width="3" height="22" rx="1" fill="#34d399" opacity="0.4" />
            <line x1="45.5" y1="2" x2="45.5" y2="34" stroke="#34d399" strokeWidth="1" opacity="0.3" />
            <rect x="54" y="10" width="3" height="16" rx="1" fill="#3f3f46" opacity="0.5" />
            <line x1="55.5" y1="4" x2="55.5" y2="30" stroke="#3f3f46" strokeWidth="1" opacity="0.3" />
            {/* Overlay arrow indicators */}
            <polygon points="15.5,4 12,8 19,8" fill="#22d3ee" opacity="0.6" />
            <polygon points="45.5,36 42,32 49,32" fill="#ef4444" opacity="0.6" />
          </svg>
        </div>

        {/* Data summary */}
        <div className="flex items-center gap-3">
          {dataSource && (
            <>
              <span className="text-xs font-mono font-semibold text-zinc-300">{symbol}</span>
              <span className="w-px h-3 bg-zinc-700" />
              <span className="text-[10px] font-mono text-zinc-500">{timeframe}</span>
              <span className="w-px h-3 bg-zinc-700" />
            </>
          )}
          <span className="text-[10px] font-mono text-cyan-400">
            {predCount} prediction{predCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* CTA */}
        <div
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md',
            'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400',
            'text-[10px] font-mono font-medium uppercase tracking-wider',
            'hover:bg-cyan-500/15 hover:border-cyan-500/30 transition-colors cursor-pointer',
          )}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Open in chart view
        </div>
      </div>
    </RendererShell>
  );
}
