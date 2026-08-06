/**
 * ElbowBicCurve — Regime count and balance summary.
 *
 * For nonparametric models, shows discovered K and balance.
 * SRP: Renders regime count quality only.
 */

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor, getRegimeVerdict, CHART_TOOLTIP } from "@/training/lib/types";
import { ChartCard, EmptyState } from "./shared";

export default function ElbowBicCurve({ diagnostics }: AnalyticsComponentProps) {
  const { regime_stats, n_regimes } = diagnostics;

  if (!regime_stats?.length) {
    return (
      <ChartCard title="Regime Balance">
        <EmptyState message="No regime data" />
      </ChartCard>
    );
  }

  const pieData = regime_stats.map((rs, i) => ({
    name: rs.label,
    value: rs.pct,
    fill: getRegimeColor(i).fill,
  }));

  const verdict = getRegimeVerdict(n_regimes);

  return (
    <ChartCard title="Regime Balance" subtitle={`${n_regimes} regimes discovered`} minHeight={180}>
      <div className="flex items-center gap-4">
        <div className="w-32 h-32">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius={25}
                outerRadius={50}
                paddingAngle={2}
                isAnimationActive={false}
              >
                {pieData.map((d, i) => (
                  <Cell key={i} fill={d.fill} stroke="transparent" />
                ))}
              </Pie>
              <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v.toFixed(1)}%`} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1">
          <div className="space-y-1">
            {regime_stats.map((rs, i) => (
              <div key={i} className="flex items-center gap-2 text-[9px]">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: getRegimeColor(i).fill }} />
                <span className="truncate">{rs.label}</span>
                <span className="font-mono text-muted-foreground/50 ml-auto">{rs.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className={`text-[9px] mt-2 ${verdict.color}`}>{verdict.text}</div>
        </div>
      </div>
    </ChartCard>
  );
}
