import React, { useMemo } from 'react';
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

const Plot = createPlotlyComponent(Plotly);

export interface LossSurface3DProps {
  currentLoss?: number;
  // If the backend provides actual surface grid data:
  xGrid?: number[][];
  yGrid?: number[][];
  zGrid?: number[][];
}

/**
 * 3D Loss Surface Plot using Plotly.js.
 * Displays the theoretical or computed loss landscape of the model.
 */
export function LossSurface3D({ currentLoss = 0.5, xGrid, yGrid, zGrid }: LossSurface3DProps) {
  // Generate a smooth mock convex landscape if no real grid is provided
  const { x, y, z } = useMemo(() => {
    if (xGrid && yGrid && zGrid) {
      return { x: xGrid, y: yGrid, z: zGrid };
    }
    
    // Generate a default convex "bowl" shape with some noise, anchored around currentLoss at the center
    const size = 50;
    const xRange = Array.from({ length: size }, (_, i) => -5 + (i * 10) / (size - 1));
    const yRange = Array.from({ length: size }, (_, i) => -5 + (i * 10) / (size - 1));
    
    const xMatrix = [];
    const yMatrix = [];
    const zMatrix = [];
    
    for (let i = 0; i < size; i++) {
      const xRow = [];
      const yRow = [];
      const zRow = [];
      for (let j = 0; j < size; j++) {
        const xv = xRange[i]!;
        const yv = yRange[j]!;
        xRow.push(xv);
        yRow.push(yv);
        
        // Base convex function (paraboloid) + local minimums + base loss
        const base = (xv * xv) / 10 + (yv * yv) / 10;
        const noise = Math.sin(xv * 2) * Math.cos(yv * 2) * 0.2;
        zRow.push(Math.max(0, currentLoss + base + noise));
      }
      xMatrix.push(xRow);
      yMatrix.push(yRow);
      zMatrix.push(zRow);
    }
    
    return { x: xMatrix, y: yMatrix, z: zMatrix };
  }, [xGrid, yGrid, zGrid, currentLoss]);

  return (
    <div className="w-full h-full relative overflow-hidden rounded-md border border-white/10 bg-black/50">
      <Plot
        data={[
          {
            x,
            y,
            z,
            type: 'surface',
            colorscale: 'Viridis',
            showscale: false,
            contours: {
              z: {
                show: true,
                usecolormap: true,
                highlightcolor: "limegreen",
                project: { z: true }
              }
            }
          }
        ]}
        layout={{
          autosize: true,
          margin: { l: 0, r: 0, b: 0, t: 0 },
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          scene: {
            xaxis: { title: 'Param Direction 1', showgrid: false, zeroline: false, showline: false, ticks: '', showticklabels: false },
            yaxis: { title: 'Param Direction 2', showgrid: false, zeroline: false, showline: false, ticks: '', showticklabels: false },
            zaxis: { title: 'Loss', showgrid: true, gridcolor: '#333' },
            camera: {
              eye: { x: 1.5, y: 1.5, z: 1.2 }
            }
          }
        }}
        useResizeHandler={true}
        style={{ width: '100%', height: '100%' }}
        config={{ displayModeBar: false }}
      />
      
      {/* Current point overlay hint */}
      <div className="absolute top-2 left-2 text-[10px] text-white/50 font-mono pointer-events-none">
        Loss Landscape / PCA Projection
        <br />
        Center Z: {currentLoss.toFixed(4)}
      </div>
    </div>
  );
}
