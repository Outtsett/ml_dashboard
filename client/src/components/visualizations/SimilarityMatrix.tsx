import { useMemo } from 'react';

interface SimilarityMatrixProps {
  matrix: number[][] | null;
  labels?: string[];
  title?: string;
  colorScale?: 'blue' | 'viridis' | 'coolwarm';
}

function getBlueColor(value: number): string {
  const intensity = Math.max(0, Math.min(1, value));
  if (intensity < 0.2) return 'rgba(59, 130, 246, 0.1)';
  if (intensity < 0.4) return 'rgba(59, 130, 246, 0.3)';
  if (intensity < 0.6) return 'rgba(59, 130, 246, 0.5)';
  if (intensity < 0.8) return 'rgba(59, 130, 246, 0.7)';
  return 'rgba(59, 130, 246, 0.9)';
}

function getCoolWarmColor(value: number): string {
  if (value < 0) {
    const intensity = Math.min(1, Math.abs(value));
    return `rgba(59, 130, 246, ${0.1 + intensity * 0.8})`;
  }
  const intensity = Math.min(1, value);
  return `rgba(239, 68, 68, ${0.1 + intensity * 0.8})`;
}

export function SimilarityMatrix({ 
  matrix, 
  labels,
  title,
  colorScale = 'blue'
}: SimilarityMatrixProps) {
  const processedData = useMemo(() => {
    if (!matrix || matrix.length === 0) return null;

    const size = matrix.length;
    const displayLabels = labels || Array.from({ length: size }, (_, i) => `${i + 1}`);
    const maxAbs = Math.max(...matrix.flat().map(Math.abs));

    return { matrix, labels: displayLabels, size, maxAbs };
  }, [matrix, labels]);

  if (!processedData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <svg className="w-8 h-8 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 3v18" />
          </svg>
          <p className="text-xs">No similarity data</p>
          <p className="text-[10px] opacity-60">Requires similarity matrix</p>
        </div>
      </div>
    );
  }

  const { matrix: displayMatrix, labels: displayLabels, size, maxAbs } = processedData;
  const cellSize = Math.min(Math.floor(180 / size), 20);
  const showLabels = size <= 15;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center">
      {title && (
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          {title}
        </div>
      )}
      
      <div className="overflow-auto max-h-full max-w-full">
        <div style={{ display: 'inline-block' }}>
          {showLabels && (
            <div className="flex" style={{ marginLeft: showLabels ? 20 : 0 }}>
              {displayLabels.map((label, i) => (
                <div 
                  key={`header-${i}`}
                  className="text-[7px] text-muted-foreground text-center overflow-hidden"
                  style={{ width: cellSize }}
                  title={label}
                >
                  {label.slice(0, 3)}
                </div>
              ))}
            </div>
          )}
          
          {displayMatrix.map((row, i) => (
            <div key={`row-${i}`} className="flex">
              {showLabels && (
                <div 
                  className="text-[7px] text-muted-foreground flex items-center justify-end pr-1 overflow-hidden"
                  style={{ width: 20 }}
                  title={displayLabels[i]}
                >
                  {displayLabels[i].slice(0, 3)}
                </div>
              )}
              {row.map((value, j) => {
                const normalizedValue = maxAbs > 0 ? value / maxAbs : 0;
                const bgColor = colorScale === 'coolwarm' 
                  ? getCoolWarmColor(normalizedValue)
                  : getBlueColor(Math.abs(normalizedValue));

                return (
                  <div
                    key={`cell-${i}-${j}`}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      backgroundColor: bgColor,
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                    title={`[${displayLabels[i]}, ${displayLabels[j]}]: ${value.toFixed(3)}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 text-[8px] text-muted-foreground">
        <span>Low</span>
        <div className="flex">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map(v => (
            <div 
              key={v}
              className="w-3 h-2"
              style={{ 
                backgroundColor: colorScale === 'coolwarm' 
                  ? getCoolWarmColor(v) 
                  : getBlueColor(v) 
              }}
            />
          ))}
        </div>
        <span>High</span>
      </div>
    </div>
  );
}

export default SimilarityMatrix;
