import { useMemo } from 'react';

interface ConfusionMatrixHeatmapProps {
  matrix: number[][] | null;
  labels?: string[];
  title?: string;
  normalize?: boolean;
}

function getHeatmapColor(value: number, max: number): string {
  const intensity = max > 0 ? value / max : 0;
  if (intensity < 0.2) return 'rgba(59, 130, 246, 0.1)';
  if (intensity < 0.4) return 'rgba(59, 130, 246, 0.3)';
  if (intensity < 0.6) return 'rgba(59, 130, 246, 0.5)';
  if (intensity < 0.8) return 'rgba(59, 130, 246, 0.7)';
  return 'rgba(59, 130, 246, 0.9)';
}

function getDiagonalColor(value: number, max: number): string {
  const intensity = max > 0 ? value / max : 0;
  if (intensity < 0.2) return 'rgba(34, 197, 94, 0.1)';
  if (intensity < 0.4) return 'rgba(34, 197, 94, 0.3)';
  if (intensity < 0.6) return 'rgba(34, 197, 94, 0.5)';
  if (intensity < 0.8) return 'rgba(34, 197, 94, 0.7)';
  return 'rgba(34, 197, 94, 0.9)';
}

export function ConfusionMatrixHeatmap({ 
  matrix, 
  labels,
  title,
  normalize = false
}: ConfusionMatrixHeatmapProps) {
  const processedData = useMemo(() => {
    if (!matrix || matrix.length === 0) return null;

    const numClasses = matrix.length;
    const rowSums = matrix.map(row => row.reduce((a, b) => a + b, 0));
    const maxValue = Math.max(...matrix.flat());

    const normalizedMatrix = normalize
      ? matrix.map((row, i) => row.map(v => rowSums[i]! > 0 ? v / rowSums[i]! : 0))
      : matrix;

    const classLabels = labels || Array.from({ length: numClasses }, (_, i) => `C${i + 1}`);

    return { matrix: normalizedMatrix, labels: classLabels, maxValue, numClasses };
  }, [matrix, labels, normalize]);

  if (!processedData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <svg className="w-8 h-8 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          <p className="text-xs">No confusion matrix</p>
          <p className="text-[10px] opacity-60">Requires classification results</p>
        </div>
      </div>
    );
  }

  const { matrix: displayMatrix, labels: classLabels, maxValue, numClasses } = processedData;
  const cellSize = Math.min(Math.floor(150 / numClasses), 40);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center">
      {title && (
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          {title}
        </div>
      )}
      
      <div className="flex">
        <div className="flex flex-col justify-center mr-1">
          <div className="text-[8px] text-muted-foreground -rotate-90 whitespace-nowrap" style={{ width: 12 }}>
            Actual
          </div>
        </div>
        
        <div>
          <div className="flex ml-6">
            {classLabels.map((label, i) => (
              <div 
                key={`header-${i}`}
                className="text-[9px] text-muted-foreground text-center"
                style={{ width: cellSize }}
              >
                {label}
              </div>
            ))}
          </div>
          
          {displayMatrix.map((row, i) => (
            <div key={`row-${i}`} className="flex">
              <div 
                className="text-[9px] text-muted-foreground flex items-center justify-end pr-1"
                style={{ width: 24 }}
              >
                {classLabels[i]}
              </div>
              {row.map((value, j) => {
                const isDiagonal = i === j;
                const displayValue = normalize ? (value * 100).toFixed(0) : value;
                
                return (
                  <div
                    key={`cell-${i}-${j}`}
                    className="flex items-center justify-center border border-white/5 text-[9px] font-mono"
                    style={{
                      width: cellSize,
                      height: cellSize,
                      backgroundColor: isDiagonal 
                        ? getDiagonalColor(value, normalize ? 1 : maxValue)
                        : getHeatmapColor(value, normalize ? 1 : maxValue),
                      color: value > (normalize ? 0.5 : maxValue * 0.5) ? 'white' : 'rgba(255,255,255,0.7)',
                    }}
                    title={`Actual: ${classLabels[i]}, Predicted: ${classLabels[j]}, Value: ${value}`}
                  >
                    {displayValue}{normalize ? '%' : ''}
                  </div>
                );
              })}
            </div>
          ))}
          
          <div className="text-[8px] text-muted-foreground text-center mt-1 ml-6">
            Predicted
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConfusionMatrixHeatmap;
