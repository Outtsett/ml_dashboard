/**
 * Sparkline — visx-rendered 60-point mini line chart for KPI deltas.
 *
 * Keeps a fixed aspect ratio (60×16px by default) so a row of sparklines
 * aligns visually inside a KPI strip. Uses ParentSize for responsive width
 * when embedded in a flex/grid cell. No axes, no tooltips — read-only at-a-
 * glance trend.
 */

import { ParentSize } from "@visx/responsive";
import { Group } from "@visx/group";
import { LinePath, AreaClosed } from "@visx/shape";
import { scaleLinear } from "@visx/scale";
import { LinearGradient } from "@visx/gradient";
import { cn } from "@/shared/utils/utils";

export type SparkDirection = "pos" | "neg" | "neutral";

interface SparklineProps {
  /** Series, newest-last. Values are scaled internally. */
  data: number[];
  /** Color tone — drives stroke and gradient fill. */
  direction?: SparkDirection;
  /** Width — pass a fixed px or use 'parent' for responsive. */
  width?: number | "parent";
  /** Height. Default 16. */
  height?: number;
  /** Show area fill under the line. Default true. */
  fill?: boolean;
  /** Stroke width. Default 1.25 — sub-pixel-aware. */
  strokeWidth?: number;
  /** Optional testid. */
  testId?: string;
  className?: string;
}

const STROKE: Record<SparkDirection, string> = {
  pos: "hsl(var(--data-pos))",
  neg: "hsl(var(--data-neg))",
  neutral: "hsl(var(--data-neutral))",
};

export function Sparkline({
  data,
  direction = "neutral",
  width = "parent",
  height = 16,
  fill = true,
  strokeWidth = 1.25,
  testId,
  className,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <span
        data-testid={testId}
        className={cn("inline-block h-4 w-12 rounded-sm bg-white/[0.02]", className)}
        aria-hidden
      />
    );
  }

  const renderSpark = (w: number, h: number) => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    // Avoid a degenerate domain when every sample is identical — scale would
    // map all points to a single y and the SVG would collapse.
    const domainMin = min;
    const domainMax = max === min ? min + 1 : max;
    // Pad vertically so the line never touches the top/bottom edge.
    const padY = Math.max(1, h * 0.1);
    const x = scaleLinear<number>({ domain: [0, data.length - 1], range: [0, w] });
    const y = scaleLinear<number>({ domain: [domainMin, domainMax], range: [h - padY, padY] });
    const stroke = STROKE[direction];
    const gradId = `spark-grad-${direction}`;
    return (
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className={cn("block", className)}
        data-testid={testId}
        aria-label="sparkline"
        role="img"
      >
        <LinearGradient
          id={gradId}
          from={stroke}
          fromOpacity={0.35}
          to={stroke}
          toOpacity={0}
          x1={0}
          x2={0}
          y1={0}
          y2={1}
        />
        <Group>
          {fill && (
            <AreaClosed<number>
              data={data}
              x={(_v, i) => x(i)}
              y={(d) => y(d)}
              yScale={y}
              fill={`url(#${gradId})`}
              stroke="none"
            />
          )}
          <LinePath<number>
            data={data}
            x={(_v, i) => x(i)}
            y={(d) => y(d)}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Group>
      </svg>
    );
  };

  if (typeof width === "number") {
    return renderSpark(width, height);
  }

  return (
    <ParentSize parentSizeStyles={{ display: "block", width: "100%", height }}>
      {({ width: w }) => (w > 0 ? renderSpark(w, height) : null)}
    </ParentSize>
  );
}
