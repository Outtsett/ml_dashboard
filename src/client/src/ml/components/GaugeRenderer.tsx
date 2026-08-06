/**
 * GaugeRenderer  Raised half-ring HUD standard.
 *
 * Arc sweeps from -90deg to +90deg (180deg total range).
 * Centered value below the ring for institutional look.
 * Severity zone backgrounds with high-contrast value fill.
 */

import { useMemo } from "react";
import { Arc } from "@visx/shape";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { Text } from "@visx/text";
import type { RendererProps } from "@/ml/lib/diagnostics-schema";
import { getMetricSeverity, formatMetricValue } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from "./RendererShell";

// Half-ring spans -90deg to +90deg = 180deg total
const START_ANGLE = -Math.PI / 2;
const END_ANGLE = Math.PI / 2;

const ZONE_HEX = {
  bad: "#ef4444",
  neutral: "#71717a",
  good: "#3b82f6", // Institutional blue
  great: "#10b981", // Institutional emerald
} as const;

const ZONE_HEX_DIM = {
  bad: "#7f1d1d40",
  neutral: "#3f3f4640",
  good: "#1e3a8a40",
  great: "#064e3b40",
} as const;

export function GaugeRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);
  const value = typeof props.metric.value === "number" ? props.metric.value : 0;

  const min = context.min ?? 0;
  const max = context.max ?? (value * 2 || 1);
  const severity = getMetricSeverity(value, context);
  const formatted = formatMetricValue(value, context);

  const size = compact ? 120 : 160;
  const outerR = size / 2 - 4;
  const innerR = outerR - (compact ? 8 : 12);
  const cx = size / 2;
  const cy = size / 2 + (compact ? 15 : 20);

  const angleScale = useMemo(
    () => scaleLinear<number>({ domain: [min, max], range: [START_ANGLE, END_ANGLE], clamp: true }),
    [min, max]
  );

  const zones = useMemo(() => {
    const thresholds: { value: number; zone: keyof typeof ZONE_HEX }[] = [];
    const hib = context.higher_is_better ?? true;

    if (context.bad != null) thresholds.push({ value: context.bad, zone: "bad" });
    if (context.good != null) thresholds.push({ value: context.good, zone: "good" });
    if (context.great != null) thresholds.push({ value: context.great, zone: "great" });

    if (thresholds.length === 0) {
      return [{ startAngle: START_ANGLE, endAngle: END_ANGLE, color: ZONE_HEX_DIM.neutral }];
    }

    thresholds.sort((a, b) => a.value - b.value);
    const arcs: { startAngle: number; endAngle: number; color: string }[] = [];

    if (hib) {
      const badEnd = context.bad != null ? angleScale(context.bad) : START_ANGLE;
      const goodStart = context.good != null ? angleScale(context.good) : END_ANGLE;
      const greatStart = context.great != null ? angleScale(context.great) : END_ANGLE;

      if (badEnd > START_ANGLE) arcs.push({ startAngle: START_ANGLE, endAngle: badEnd, color: ZONE_HEX_DIM.bad });
      arcs.push({ startAngle: badEnd, endAngle: goodStart, color: ZONE_HEX_DIM.neutral });
      if (goodStart < greatStart) arcs.push({ startAngle: goodStart, endAngle: greatStart, color: ZONE_HEX_DIM.good });
      if (greatStart < END_ANGLE) arcs.push({ startAngle: greatStart, endAngle: END_ANGLE, color: ZONE_HEX_DIM.great });
    } else {
      const greatEnd = context.great != null ? angleScale(context.great) : START_ANGLE;
      const goodEnd = context.good != null ? angleScale(context.good) : START_ANGLE;
      const badStart = context.bad != null ? angleScale(context.bad) : END_ANGLE;

      if (greatEnd > START_ANGLE) arcs.push({ startAngle: START_ANGLE, endAngle: greatEnd, color: ZONE_HEX_DIM.great });
      if (goodEnd > greatEnd) arcs.push({ startAngle: greatEnd, endAngle: goodEnd, color: ZONE_HEX_DIM.good });
      arcs.push({ startAngle: goodEnd, endAngle: badStart, color: ZONE_HEX_DIM.neutral });
      if (badStart < END_ANGLE) arcs.push({ startAngle: badStart, endAngle: END_ANGLE, color: ZONE_HEX_DIM.bad });
    }

    return arcs.filter((a) => a.endAngle > a.startAngle);
  }, [context, angleScale]);

  const valueAngle = angleScale(Math.max(min, Math.min(max, value)));
  const breakevenAngle = context.breakeven != null ? angleScale(context.breakeven) : null;

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity={severity}>
      <div className="flex flex-col items-center">
        <svg width={size} height={size * 0.6} className="overflow-visible">
          <Group top={cy} left={cx}>
            {/* Background zones */}
            {zones.map((zone, i) => (
              <Arc
                key={i}
                startAngle={zone.startAngle}
                endAngle={zone.endAngle}
                outerRadius={outerR}
                innerRadius={innerR}
                fill={zone.color}
                cornerRadius={1}
              />
            ))}

            {/* Value fill */}
            <Arc
              startAngle={START_ANGLE}
              endAngle={valueAngle}
              outerRadius={outerR}
              innerRadius={innerR}
              fill={ZONE_HEX[severity]}
              opacity={0.9}
              cornerRadius={1}
              style={{ filter: `drop-shadow(0 0 8px ${ZONE_HEX[severity]}60)` }}
            />

            {/* Breakeven line */}
            {breakevenAngle != null && (() => {
              const bx = Math.cos(breakevenAngle - Math.PI / 2);
              const by = Math.sin(breakevenAngle - Math.PI / 2);
              return (
                <line
                  x1={bx * (innerR - 4)} y1={by * (innerR - 4)}
                  x2={bx * (outerR + 4)} y2={by * (outerR + 4)}
                  stroke="#fbbf24" strokeWidth={2} strokeDasharray="2 2"
                />
              );
            })()}

            {/* Needle */}
            {(() => {
              const nx = Math.cos(valueAngle - Math.PI / 2);
              const ny = Math.sin(valueAngle - Math.PI / 2);
              return (
                <line
                  x1={nx * (innerR - 2)} y1={ny * (innerR - 2)}
                  x2={nx * (outerR + 2)} y2={ny * (outerR + 2)}
                  stroke="#fff" strokeWidth={2} strokeLinecap="round"
                />
              );
            })()}

            {/* Centered Value BELOW the ring */}
            <Text
              textAnchor="middle"
              verticalAnchor="middle"
              y={compact ? 12 : 18}
              fill={ZONE_HEX[severity]}
              fontSize={compact ? 20 : 28}
              fontFamily="font-mono"
              fontWeight={800}
              style={{ textShadow: "0 0 20px rgba(0,0,0,0.5)" }}
            >
              {formatted}
            </Text>

            {/* Min/Max indicators */}
            <Text
              textAnchor="start"
              verticalAnchor="middle"
              x={-outerR}
              y={8}
              fill="#71717a"
              fontSize={8}
              fontFamily="font-mono"
            >
              {min}
            </Text>
            <Text
              textAnchor="end"
              verticalAnchor="middle"
              x={outerR}
              y={8}
              fill="#71717a"
              fontSize={8}
              fontFamily="font-mono"
            >
              {max}
            </Text>
          </Group>
        </svg>
      </div>
    </RendererShell>
  );
}
