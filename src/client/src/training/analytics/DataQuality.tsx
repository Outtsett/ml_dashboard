/**
 * DataQuality — Feature count, data coverage, and training configuration summary.
 *
 * SRP: Data quality overview only. No analysis or recommendations.
 */

import type { AnalyticsComponentProps } from "./index";
import { ChartCard } from "./shared";

export default function DataQuality({ diagnostics }: AnalyticsComponentProps) {
  const { n_features, feature_names, n_bars_total, training_config } = diagnostics;

  return (
    <ChartCard title="Data Quality" subtitle={`${n_features} features \u00b7 ${n_bars_total?.toLocaleString() ?? "?"} bars`}>
      <div className="mt-1">
        <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-1">Features ({n_features})</div>
        <div className="flex flex-wrap gap-1">
          {feature_names.slice(0, 20).map((f: string) => (
            <span key={f} className="text-[8px] font-mono bg-white/[0.04] px-1.5 py-0.5 rounded text-muted-foreground/60">
              {f}
            </span>
          ))}
          {feature_names.length > 20 && (
            <span className="text-[8px] text-muted-foreground/30">+{feature_names.length - 20} more</span>
          )}
        </div>
      </div>

      {training_config && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[
            { label: "Iterations", value: training_config.gibbs_iter },
            { label: "Burn-in", value: training_config.burn_in },
            { label: "Test Split", value: `${((training_config.test_split ?? 0) * 100).toFixed(0)}%` },
            { label: "Alpha (CRP)", value: training_config.alpha },
            { label: "Gamma", value: training_config.gamma },
            { label: "Kappa", value: training_config.kappa },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <div className="text-[8px] text-muted-foreground/40 uppercase">{label}</div>
              <div className="text-[11px] font-mono">{value}</div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}
