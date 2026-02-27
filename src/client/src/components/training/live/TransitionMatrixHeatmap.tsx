/**
 * TransitionMatrixHeatmap — N x N grid of regime transition probabilities.
 *
 * Diagonal cells are bright (self-transitions = sticky behavior).
 * Updates when overlay events arrive with regime info.
 */

interface TransitionMatrixHeatmapProps {
  /** diagnostics.transition_matrix from the latest model */
  matrix: number[][] | null;
  /** Number of active regimes */
  nRegimes: number;
  /** Regime labels from overlay payload */
  regimeLabels?: Record<string, string>;
  /** Regime colors from overlay payload */
  regimeColors?: Record<string, string>;
}

export function TransitionMatrixHeatmap({ matrix, nRegimes, regimeLabels, regimeColors }: TransitionMatrixHeatmapProps) {
  if (!matrix || nRegimes === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground/40">
        <p className="text-xs font-mono">Waiting for transition data...</p>
      </div>
    );
  }

  const N = Math.min(nRegimes, matrix.length);

  return (
    <div className="h-full w-full flex flex-col">
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
            <>
              {/* Row label */}
              <div
                key={`r-${i}`}
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
                return (
                  <div
                    key={`${i}-${j}`}
                    title={`P(${i}→${j}) = ${val.toFixed(3)}`}
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
                    }}
                  >
                    {val > 0.01 ? val.toFixed(2) : ''}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </div>
    </div>
  );
}
