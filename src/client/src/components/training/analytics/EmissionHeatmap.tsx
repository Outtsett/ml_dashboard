/**
 * EmissionHeatmap — K x D heatmap of normalized emission parameters.
 *
 * Inline SVG with diverging blue-white-red color scale.
 * X axis: feature names, Y axis: regime IDs.
 */

import { memo, useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { ChartCard } from "./shared";

/** Diverging blue-white-red: val in [-1, 1] */
function divergingColor(val: number): string {
  const clamped = Math.max(-1, Math.min(1, val));
  if (clamped >= 0) {
    // white to red
    const t = clamped;
    const r = 255;
    const g = Math.round(255 * (1 - t));
    const b = Math.round(255 * (1 - t));
    return `rgb(${r},${g},${b})`;
  } else {
    // blue to white
    const t = -clamped;
    const r = Math.round(255 * (1 - t));
    const g = Math.round(255 * (1 - t));
    const b = 255;
    return `rgb(${r},${g},${b})`;
  }
}

/** Normalize matrix values to [-1, 1] based on global abs max */
function normalizeMatrix(matrix: number[][]): { normalized: number[][]; absMax: number } {
  let absMax = 0;
  for (const row of matrix) {
    for (const v of row) {
      const av = Math.abs(v);
      if (av > absMax) absMax = av;
    }
  }
  if (absMax === 0) absMax = 1;
  const normalized = matrix.map((row) => row.map((v) => v / absMax));
  return { normalized, absMax };
}

function EmissionHeatmapInner() {
  const { modelState } = useTrainingModelState();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(400);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    regime: number;
    feature: string;
    value: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const { normalized, featureNames, K, D } = useMemo(() => {
    if (!modelState) return { normalized: [], featureNames: [], K: 0, D: 0 };
    const snap = modelState.snapshot;
    const matrix = snap.emission_heatmap;
    const names = snap.feature_names ?? [];
    if (!matrix || matrix.length === 0) return { normalized: [], featureNames: names, K: 0, D: 0 };
    const { normalized: norm } = normalizeMatrix(matrix);
    return { normalized: norm, featureNames: names, K: matrix.length, D: matrix[0]?.length ?? 0 };
  }, [modelState]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>, regime: number, featureIdx: number, value: number) => {
      const rect = (e.target as SVGRectElement).getBoundingClientRect();
      setTooltip({
        x: rect.left + rect.width / 2,
        y: rect.top,
        regime,
        feature: featureNames[featureIdx] ?? `F${featureIdx}`,
        value,
      });
    },
    [featureNames]
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  if (!modelState || K === 0 || D === 0) {
    return (
      <ChartCard title="Emission Heatmap" minHeight={120}>
        <div className="w-full h-full flex items-center justify-center min-h-[100px]">
          <span className="text-[10px] font-mono text-muted-foreground/30">
            Emission parameters will appear during training
          </span>
        </div>
      </ChartCard>
    );
  }

  // Layout
  const labelWidth = 30;
  const labelHeight = 50;
  const legendWidth = 50;
  const chartWidth = containerWidth - labelWidth - legendWidth - 8;
  const cellW = Math.max(4, Math.floor(chartWidth / D));
  const cellH = Math.max(12, Math.min(28, Math.floor(200 / K)));
  const svgW = labelWidth + cellW * D + legendWidth + 8;
  const svgH = labelHeight + cellH * K + 4;

  const rawMatrix = modelState.snapshot.emission_heatmap;

  return (
    <ChartCard
      title="Emission Heatmap"
      subtitle={`${K} regimes x ${D} features`}
      minHeight={Math.max(120, svgH + 10)}
    >
      <div ref={containerRef} className="w-full overflow-x-auto">
        <svg width={svgW} height={svgH} className="block">
          {/* Feature name labels (rotated) */}
          {featureNames.map((name, j) => (
            <text
              key={`fl-${j}`}
              x={labelWidth + j * cellW + cellW / 2}
              y={labelHeight - 4}
              textAnchor="end"
              fontSize={7}
              fontFamily="monospace"
              fill="rgba(255,255,255,0.35)"
              transform={`rotate(-45 ${labelWidth + j * cellW + cellW / 2} ${labelHeight - 4})`}
            >
              {name.length > 10 ? name.slice(0, 9) + "\u2026" : name}
            </text>
          ))}

          {/* Heatmap cells */}
          {normalized.map((row, i) =>
            row.map((val, j) => (
              <rect
                key={`c-${i}-${j}`}
                x={labelWidth + j * cellW}
                y={labelHeight + i * cellH}
                width={cellW - 1}
                height={cellH - 1}
                rx={1}
                fill={divergingColor(val)}
                onMouseMove={(e) =>
                  handleMouseMove(e, i, j, rawMatrix[i]?.[j] ?? val)
                }
                onMouseLeave={handleMouseLeave}
                style={{ cursor: "crosshair" }}
              />
            ))
          )}

          {/* Regime row labels */}
          {Array.from({ length: K }, (_, i) => (
            <text
              key={`rl-${i}`}
              x={labelWidth - 4}
              y={labelHeight + i * cellH + cellH / 2 + 3}
              textAnchor="end"
              fontSize={8}
              fontFamily="monospace"
              fill="rgba(255,255,255,0.5)"
            >
              R{i}
            </text>
          ))}

          {/* Color legend */}
          {(() => {
            const lx = labelWidth + cellW * D + 12;
            const ly = labelHeight;
            const lh = cellH * K;
            const lw = 10;
            const steps = 20;
            const stepH = lh / steps;
            return (
              <>
                {Array.from({ length: steps }, (_, s) => {
                  const v = 1 - (s / (steps - 1)) * 2; // 1 to -1
                  return (
                    <rect
                      key={`lg-${s}`}
                      x={lx}
                      y={ly + s * stepH}
                      width={lw}
                      height={stepH + 0.5}
                      fill={divergingColor(v)}
                    />
                  );
                })}
                <text x={lx + lw + 3} y={ly + 6} fontSize={7} fontFamily="monospace" fill="rgba(255,255,255,0.4)">
                  +
                </text>
                <text x={lx + lw + 3} y={ly + lh / 2 + 3} fontSize={7} fontFamily="monospace" fill="rgba(255,255,255,0.4)">
                  0
                </text>
                <text x={lx + lw + 3} y={ly + lh} fontSize={7} fontFamily="monospace" fill="rgba(255,255,255,0.4)">
                  -
                </text>
              </>
            );
          })()}
        </svg>

        {/* Floating tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 pointer-events-none bg-black/90 border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-white"
            style={{
              left: tooltip.x,
              top: tooltip.y - 30,
              transform: "translateX(-50%)",
            }}
          >
            Regime {tooltip.regime}, {tooltip.feature}: {tooltip.value.toFixed(4)}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

export const EmissionHeatmap = memo(EmissionHeatmapInner);
export default EmissionHeatmap;
