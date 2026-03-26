/**
 * TransitionMatrixHeatmap — N x N grid of regime transition probabilities.
 *
 * Diagonal cells are bright (self-transitions = sticky behavior).
 * Updates when overlay events arrive with regime info.
 * Optional `animate` prop: cells pulse briefly when values change between renders.
 */

import { useRef, useEffect, memo } from "react";

interface TransitionMatrixHeatmapProps {
  /** diagnostics.transition_matrix from the latest model */
  matrix: number[][] | null;
  /** Number of active regimes */
  nRegimes: number;
  /** Regime labels from overlay payload */
  regimeLabels?: Record<string, string>;
  /** Regime colors from overlay payload */
  regimeColors?: Record<string, string>;
  /** When true, cells pulse on value changes */
  animate?: boolean;
}

function TransitionMatrixHeatmapInner({
  matrix,
  nRegimes,
  regimeLabels,
  regimeColors,
  animate = false,
}: TransitionMatrixHeatmapProps) {
  const prevMatrixRef = useRef<number[][] | null>(null);
  const changedCellsRef = useRef<Set<string>>(new Set());

  // Track which cells changed
  useEffect(() => {
    if (!animate || !matrix) {
      prevMatrixRef.current = matrix;
      return;
    }

    const prev = prevMatrixRef.current;
    const changed = new Set<string>();

    if (prev) {
      const N = Math.min(matrix.length, prev.length);
      for (let i = 0; i < N; i++) {
        const M = Math.min(matrix[i]?.length ?? 0, prev[i]?.length ?? 0);
        for (let j = 0; j < M; j++) {
          const curr = matrix[i]?.[j] ?? 0;
          const old = prev[i]?.[j] ?? 0;
          if (Math.abs(curr - old) > 0.001) {
            changed.add(`${i}-${j}`);
          }
        }
      }
    }

    changedCellsRef.current = changed;
    prevMatrixRef.current = matrix?.map((row) => [...row]) ?? null;
  }, [matrix, animate]);

  if (!matrix || nRegimes === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground/40">
        <p className="text-xs font-mono">Waiting for transition data...</p>
      </div>
    );
  }

  const N = Math.min(nRegimes, matrix.length);
  const changedCells = animate ? changedCellsRef.current : null;

  return (
    <div className="h-full w-full flex flex-col">
      {animate && (
        <style>{`
          @keyframes tmh-pulse {
            0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.4); }
            50% { box-shadow: 0 0 6px 2px rgba(255,255,255,0.2); }
            100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
          }
          .tmh-cell-pulse {
            animation: tmh-pulse 0.6s ease-out;
          }
        `}</style>
      )}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <span className="text-[10px] font-mono text-emerald-400 font-medium">Transition Matrix</span>
        <span className="text-[9px] font-mono text-muted-foreground/50">{N}x{N}</span>
      </div>
      <div className="flex-1 p-2 flex items-center justify-center overflow-auto">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `auto repeat(${N}, 1fr)`,
            gap: '2px',
            maxWidth: '100%',
          }}
        >
          {/* Header row */}
          <div /> {/* empty corner cell */}
          {Array.from({ length: N }, (_, j) => (
            <div
              key={`h-${j}`}
              style={{
                textAlign: 'center',
                fontSize: '8px',
                fontFamily: 'monospace',
                color: regimeColors?.[String(j)] ?? '#888',
                padding: '2px',
              }}
            >
              {j}
            </div>
          ))}

          {/* Data rows */}
          {Array.from({ length: N }, (_, i) => (
            <div key={`row-${i}`} style={{ display: 'contents' }}>
              {/* Row label */}
              <div
                style={{
                  fontSize: '8px',
                  fontFamily: 'monospace',
                  color: regimeColors?.[String(i)] ?? '#888',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingRight: '4px',
                }}
              >
                {i}
              </div>
              {/* Cells */}
              {Array.from({ length: N }, (_, j) => {
                const val = matrix[i]?.[j] ?? 0;
                const isDiag = i === j;
                const alpha = Math.min(1, val * 1.5);
                const bg = isDiag
                  ? `rgba(34, 197, 94, ${alpha})`
                  : `rgba(59, 130, 246, ${alpha * 0.8})`;
                const cellKey = `${i}-${j}`;
                const isPulsing = changedCells?.has(cellKey);

                return (
                  <div
                    key={cellKey}
                    className={isPulsing ? "tmh-cell-pulse" : undefined}
                    title={`P(${i}\u2192${j}) = ${val.toFixed(3)}`}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      minWidth: '18px',
                      maxWidth: '36px',
                      background: bg,
                      borderRadius: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '7px',
                      fontFamily: 'monospace',
                      color: alpha > 0.5 ? '#fff' : 'rgba(255,255,255,0.3)',
                      transition: animate ? 'background 0.3s ease' : undefined,
                    }}
                  >
                    {val > 0.01 ? val.toFixed(2) : ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const TransitionMatrixHeatmap = memo(TransitionMatrixHeatmapInner);

// Keep default export for backward compatibility
export default TransitionMatrixHeatmap;
