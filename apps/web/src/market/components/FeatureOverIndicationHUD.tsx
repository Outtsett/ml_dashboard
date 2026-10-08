import { memo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Layers, AlertTriangle, CheckCircle2, Sparkles, X } from 'lucide-react';
import type { FeatureOverIndicationResult } from '@/market/lib/useFeatureOverIndication';

interface FeatureOverIndicationHUDProps {
  metrics: FeatureOverIndicationResult;
  onRemoveIndicator?: (instanceId: string) => void;
  onClearAll?: () => void;
}

export const FeatureOverIndicationHUD = memo(function FeatureOverIndicationHUD({
  metrics,
  onClearAll,
}: FeatureOverIndicationHUDProps) {
  const [open, setOpen] = useState(false);

  const {
    totalCount,
    categories,
    saturationScore,
    saturationLevel,
    effectiveDegreesOfFreedom,
    redundancyAlerts,
    recommendations,
    isOverIndicated,
  } = metrics;

  // Visual status palette mapping
  const badgeClasses = {
    balanced:
      'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.15)]',
    moderate:
      'border-amber-500/30 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.15)]',
    'over-indicated':
      'border-rose-500/40 text-rose-400 bg-rose-500/15 hover:bg-rose-500/25 shadow-[0_0_10px_rgba(244,63,94,0.2)] animate-pulse',
  }[saturationLevel];

  const statusLabel = {
    balanced: 'Balanced Features',
    moderate: 'Moderate Density',
    'over-indicated': 'Over-Indicated',
  }[saturationLevel];

  const barColor = {
    balanced: 'bg-emerald-500',
    moderate: 'bg-amber-500',
    'over-indicated': 'bg-rose-500',
  }[saturationLevel];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono font-medium transition-all ${badgeClasses}`}
          title="Click to view Feature Engineering & Over-Indication Analysis"
        >
          {isOverIndicated ? (
            <AlertTriangle className="h-3 w-3 text-rose-400 shrink-0" />
          ) : saturationLevel === 'moderate' ? (
            <Layers className="h-3 w-3 text-amber-400 shrink-0" />
          ) : (
            <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
          )}
          <span>{totalCount} ind</span>
          <span className="opacity-40">·</span>
          <span>{saturationScore}%</span>
          <span className="hidden sm:inline text-[10px] opacity-80">({statusLabel})</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[360px] p-4 bg-neutral-950/95 border-white/10 shadow-2xl backdrop-blur-xl text-neutral-200"
      >
        <div className="space-y-3.5">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <div>
                <h4 className="text-xs font-semibold tracking-wide text-foreground">
                  Feature Saturation & Collinearity
                </h4>
                <p className="text-[10px] text-muted-foreground">
                  Engineering diagnostics for ML input features
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] font-mono font-semibold px-2 py-0.5 ${badgeClasses}`}
            >
              {statusLabel}
            </Badge>
          </div>

          {/* Saturation Gauge Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-muted-foreground">Over-Indication Index:</span>
              <span className="font-bold text-foreground">{saturationScore}%</span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className={`h-full transition-all duration-500 rounded-full ${barColor}`}
                style={{ width: `${saturationScore}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[9px] text-muted-foreground/70 font-mono">
              <span>0% (Parsimonious)</span>
              <span>50%</span>
              <span>100% (High Collinearity)</span>
            </div>
          </div>

          {/* Metric Stats Grid */}
          <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
            <div className="p-2 rounded bg-white/[0.03] border border-white/[0.06]">
              <div className="text-[10px] text-muted-foreground">Active Indicators</div>
              <div className="text-base font-semibold text-foreground mt-0.5">{totalCount}</div>
            </div>
            <div className="p-2 rounded bg-white/[0.03] border border-white/[0.06]">
              <div className="text-[10px] text-muted-foreground">Effective Orthogonal DoF</div>
              <div className="text-base font-semibold text-primary mt-0.5">
                ~{effectiveDegreesOfFreedom} <span className="text-[10px] text-muted-foreground">dims</span>
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          {categories.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Active Feature Domains
              </span>
              <div className="space-y-1">
                {categories.map((cat) => (
                  <div
                    key={cat.category}
                    className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-white/[0.02] border border-white/[0.04]"
                  >
                    <span className="text-foreground/90 truncate mr-2">{cat.label}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-muted-foreground">({cat.indicatorNames.join(', ')})</span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 font-mono ${
                          cat.count >= 3
                            ? 'bg-rose-500/20 text-rose-400'
                            : cat.count === 2
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-white/10 text-neutral-300'
                        }`}
                      >
                        {cat.count}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Redundancy Alerts */}
          {redundancyAlerts.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-semibold tracking-wider text-rose-400 uppercase flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Collinearity Warnings
              </span>
              <div className="space-y-1">
                {redundancyAlerts.map((alert, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded bg-rose-500/[0.07] border border-rose-500/20 text-[11px] text-rose-300 leading-snug"
                  >
                    {alert}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feature Engineering Recommendations */}
          {recommendations.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-semibold tracking-wider text-primary uppercase flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> ML Guidance
              </span>
              <ul className="space-y-1 text-[11px] text-muted-foreground leading-snug list-disc pl-4">
                {recommendations.map((rec, idx) => (
                  <li key={idx}>{rec}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          {totalCount > 0 && onClearAll && (
            <div className="pt-2 border-t border-white/10 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-rose-400 gap-1"
                onClick={() => {
                  onClearAll();
                  setOpen(false);
                }}
              >
                <X className="h-3 w-3" /> Clear All Indicators
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
