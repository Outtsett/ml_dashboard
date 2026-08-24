/**
 * RegimeCentroidScatter — PCA 2D scatter of regime centroids.
 *
 * Client-side PCA: subtract mean, covariance, power iteration for top 2 eigenvectors.
 * Bubble size proportional to bar_count. Colored by regime.
 */

import { memo, useMemo } from "react";
import { useTrainingModelState } from "@/shared/contexts/TrainingModelStateCtx";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ZAxis,
} from "recharts";
import { ChartCard } from "./shared";

const REGIME_FILLS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

/**
 * Simple PCA via power iteration — projects K rows of D-dimensional data to 2D.
 * Sufficient for small K (number of regimes, typically 3-12).
 */
function pca2D(matrix: number[][]): { x: number; y: number }[] {
  const K = matrix.length;
  if (K === 0) return [];
  const D = matrix[0]!.length;
  if (D === 0) return matrix.map(() => ({ x: 0, y: 0 }));

  // 1. Center: subtract column means
  const means: number[] = new Array(D).fill(0);
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < D; j++) {
      means[j]! += matrix[i]![j]!;
    }
  }
  for (let j = 0; j < D; j++) means[j] = means[j]! / K;

  const centered: number[][] = matrix.map((row) =>
    row.map((v, j) => v - means[j]!)
  );

  // If K <= 2 or D === 1, skip PCA — just use first two dims or zero-pad
  if (D === 1) {
    return centered.map((row) => ({ x: row[0]!, y: 0 }));
  }
  if (K <= 2 && D >= 2) {
    return centered.map((row) => ({ x: row[0]!, y: row[1]! }));
  }

  // 2. Covariance matrix (D x D)
  const cov: number[][] = Array.from({ length: D }, () => new Array(D).fill(0));
  for (let a = 0; a < D; a++) {
    for (let b = a; b < D; b++) {
      let sum = 0;
      for (let i = 0; i < K; i++) {
        sum += centered[i]![a]! * centered[i]![b]!;
      }
      const val = sum / Math.max(1, K - 1);
      cov[a]![b] = val;
      cov[b]![a] = val;
    }
  }

  // 3. Power iteration for top eigenvector
  function powerIteration(mat: number[][], deflateVec?: number[]): number[] {
    const n = mat.length;
    let vec = new Array(n).fill(0).map(() => Math.random() - 0.5);

    // Build working matrix (possibly deflated)
    let work = mat;
    if (deflateVec) {
      // Deflate: M' = M - lambda * v * v^T (we approximate lambda from Rayleigh)
      let lambda = 0;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += mat[i]![j]! * deflateVec[j]!;
        lambda += sum * deflateVec[i]!;
      }
      work = mat.map((row, i) =>
        row.map((v, j) => v - lambda * deflateVec[i]! * deflateVec[j]!)
      );
    }

    for (let iter = 0; iter < 100; iter++) {
      const next = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          next[i] += work[i]![j]! * vec[j]!;
        }
      }
      let norm = 0;
      for (let i = 0; i < n; i++) norm += next[i]! * next[i]!;
      norm = Math.sqrt(norm);
      if (norm < 1e-12) break;
      for (let i = 0; i < n; i++) next[i] /= norm;

      // Check convergence
      let diff = 0;
      for (let i = 0; i < n; i++) diff += (next[i]! - vec[i]!) ** 2;
      vec = next;
      if (diff < 1e-10) break;
    }
    return vec;
  }

  const pc1 = powerIteration(cov);
  const pc2 = powerIteration(cov, pc1);

  // 4. Project
  return centered.map((row) => {
    let x = 0, y = 0;
    for (let j = 0; j < D; j++) {
      x += row[j]! * pc1[j]!;
      y += row[j]! * pc2[j]!;
    }
    return { x, y };
  });
}

function RegimeCentroidScatterInner() {
  const { modelState } = useTrainingModelState();

  const scatterData = useMemo(() => {
    if (!modelState) return [];
    const snap = modelState.snapshot;
    const emission = snap.emission_heatmap;
    const profiles = snap.regime_profiles;
    if (!emission || emission.length === 0) return [];

    const projected = pca2D(emission);

    return projected.map((pt, k) => ({
      x: pt.x,
      y: pt.y,
      regime: k,
      barCount: profiles?.[k]?.bar_count ?? 1,
      sharpe: profiles?.[k]?.sharpe ?? 0,
      label: profiles?.[k]?.label ?? `Regime ${k}`,
    }));
  }, [modelState]);

  const hasData = scatterData.length > 0;
  const maxBarCount = hasData ? Math.max(...scatterData.map((d) => d.barCount), 1) : 1;
  const subtitle = hasData ? `${scatterData.length} regimes projected to 2D` : undefined;

  return (
    <ChartCard
      title="Regime Centroids (PCA)"
      subtitle={subtitle}
      minHeight={220}
    >
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            type="number"
            dataKey="x"
            name="PC1"
            domain={hasData ? ["auto", "auto"] : [-1, 1]}
            tick={{ fontSize: 9, fontFamily: "monospace", fill: "rgba(255,255,255,0.3)" }}
            tickLine={false}
            axisLine={false}
            label={{ value: "PC1", position: "bottom", fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="PC2"
            domain={hasData ? ["auto", "auto"] : [-1, 1]}
            tick={{ fontSize: 9, fontFamily: "monospace", fill: "rgba(255,255,255,0.3)" }}
            tickLine={false}
            axisLine={false}
            width={40}
            label={{ value: "PC2", angle: -90, position: "insideLeft", fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
          />
          <ZAxis
            type="number"
            dataKey="barCount"
            range={[60, 400]}
            domain={[0, maxBarCount]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(0,0,0,0.9)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              fontSize: 10,
              fontFamily: "monospace",
            }}
            formatter={(_: any, name: string, props: any) => {
              const d = props.payload;
              if (name === "x") return [d.x.toFixed(3), "PC1"];
              if (name === "y") return [d.y.toFixed(3), "PC2"];
              return [String(_), name];
            }}
            labelFormatter={(_: any, payload: any[]) => {
              const d = payload?.[0]?.payload;
              if (!d) return "";
              return `${d.label}: ${d.barCount} bars, Sharpe ${d.sharpe.toFixed(2)}`;
            }}
          />
          {hasData && (
            <Scatter data={scatterData} isAnimationActive={false}>
              {scatterData.map((entry) => (
                <Cell
                  key={`cell-${entry.regime}`}
                  fill={REGIME_FILLS[entry.regime % REGIME_FILLS.length]}
                  fillOpacity={0.8}
                  stroke={REGIME_FILLS[entry.regime % REGIME_FILLS.length]}
                  strokeWidth={1}
                />
              ))}
            </Scatter>
          )}
        </ScatterChart>
      </ResponsiveContainer>

      {/* Legend */}
      {hasData && (
        <div className="flex flex-wrap items-center gap-3 mt-1 px-1">
          {scatterData.map((d) => (
            <span key={d.regime} className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/50">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: REGIME_FILLS[d.regime % REGIME_FILLS.length] }}
              />
              {d.label}
            </span>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

export const RegimeCentroidScatter = memo(RegimeCentroidScatterInner);
export default RegimeCentroidScatter;
