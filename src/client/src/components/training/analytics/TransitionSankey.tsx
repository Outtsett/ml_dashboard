/**
 * TransitionSankey — SVG Sankey diagram of regime transitions.
 *
 * SRP: Renders transition flow only. Data from diagnostics.transitions + transition_matrix.
 */

import { useMemo } from "react";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function TransitionSankey({ diagnostics }: AnalyticsComponentProps) {
  const { transitions, regime_stats } = diagnostics;

  const links = useMemo(() => {
    if (!transitions?.length) return [];
    return transitions
      .filter(t => t.probability > 0.05 && t.from !== t.to)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 15);
  }, [transitions]);

  if (links.length === 0 || !regime_stats?.length) {
    return (
      <ChartCard title="Transition Flow">
        <EmptyState message="No transition data" hint="Requires at least 2 regimes with cross-transitions" />
      </ChartCard>
    );
  }

  const nRegimes = regime_stats.length;
  const nodeH = 180 / Math.max(nRegimes, 2);
  const W = 320;
  const H = Math.max(nRegimes * nodeH + 20, 120);

  return (
    <ChartCard title="Transition Flow" subtitle={`${links.length} significant transitions (>5%)`} minHeight={H + 20}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {/* Source nodes (left) */}
        {regime_stats.map((rs, i) => {
          const color = getRegimeColor(i);
          const y = 10 + i * nodeH;
          return (
            <g key={`src-${i}`}>
              <rect x={0} y={y} width={12} height={nodeH - 4} rx={3} fill={color.fill} opacity={0.7} />
              <text x={16} y={y + nodeH / 2} className="text-[8px]" fill="currentColor" dominantBaseline="middle" opacity={0.5}>
                {rs.label}
              </text>
            </g>
          );
        })}

        {/* Target nodes (right) */}
        {regime_stats.map((rs, i) => {
          const color = getRegimeColor(i);
          const y = 10 + i * nodeH;
          return (
            <g key={`tgt-${i}`}>
              <rect x={W - 12} y={y} width={12} height={nodeH - 4} rx={3} fill={color.fill} opacity={0.7} />
              <text x={W - 16} y={y + nodeH / 2} className="text-[8px]" fill="currentColor" dominantBaseline="middle" textAnchor="end" opacity={0.5}>
                {rs.label}
              </text>
            </g>
          );
        })}

        {/* Links */}
        {links.map((link, i) => {
          const srcY = 10 + link.from * nodeH + (nodeH - 4) / 2;
          const tgtY = 10 + link.to * nodeH + (nodeH - 4) / 2;
          const thickness = Math.max(1, link.probability * 20);
          const color = getRegimeColor(link.from).fill;
          return (
            <path
              key={i}
              d={`M 12 ${srcY} C ${W / 2} ${srcY}, ${W / 2} ${tgtY}, ${W - 12} ${tgtY}`}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              opacity={0.25}
            >
              <title>{`${regime_stats[link.from]?.label} → ${regime_stats[link.to]?.label}: ${(link.probability * 100).toFixed(1)}%`}</title>
            </path>
          );
        })}
      </svg>
    </ChartCard>
  );
}
