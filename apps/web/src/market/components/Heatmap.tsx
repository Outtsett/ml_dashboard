import { useMemo } from "react";

interface HeatmapProps {
  data: number[][];
  rowLabels?: string[];
  colLabels?: string[];
  colorRange?: [string, string, string]; // [low, mid, high]
  title?: string;
  width?: number;
  height?: number;
}

function blendHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const r = Math.round(ar! + (br! - ar!) * t);
  const g = Math.round(ag! + (bg! - ag!) * t);
  const bl = Math.round(ab! + (bb! - ab!) * t);
  return `rgb(${r},${g},${bl})`;
}

export function Heatmap({
  data,
  rowLabels,
  colLabels,
  colorRange = ["#1e40af", "#fafafa", "#0072B2"],
  title,
  width = 400,
  height = 300,
}: HeatmapProps) {
  const { cells } = useMemo(() => {
    if (data.length === 0 || !data[0] || data[0].length === 0) {
      return { cells: [] };
    }

    const flat = data.flat();
    const min = Math.min(...flat);
    const max = Math.max(...flat);
    const range = max - min || 1;

    const rows = data.length;
    const cols = data[0].length;
    const cellW = cols > 0 ? (width - 60) / cols : 0;
    const cellH = rows > 0 ? (height - 40) / rows : 0;

    const cells = data.flatMap((row, r) =>
      row.map((value, c) => ({
        r,
        c,
        value,
        x: 60 + c * cellW,
        y: 20 + r * cellH,
        w: cellW,
        h: cellH,
        norm: (value - min) / range,
      }))
    );

    return { cells };
  }, [data, width, height]);

  const interpolateColor = (t: number): string => {
    const [lo, mid, hi] = colorRange;
    if (t < 0.5) {
      const s = t * 2;
      return blendHex(lo, mid, s);
    } else {
      const s = (t - 0.5) * 2;
      return blendHex(mid, hi, s);
    }
  };

  if (cells.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-xs" style={{ width, height }}>
        No heatmap data
      </div>
    );
  }

  return (
    <div>
      {title && <h4 className="text-xs font-mono font-medium mb-1">{title}</h4>}
      <svg width={width} height={height} className="font-mono">
        {cells.map((cell) => (
          <g key={`${cell.r}-${cell.c}`}>
            <rect
              x={cell.x}
              y={cell.y}
              width={Math.max(cell.w - 1, 0)}
              height={Math.max(cell.h - 1, 0)}
              fill={interpolateColor(cell.norm)}
              rx={2}
            >
              <title>{`[${cell.r},${cell.c}]: ${cell.value.toFixed(3)}`}</title>
            </rect>
          </g>
        ))}
        {/* Row labels */}
        {rowLabels?.map((label, i) => {
          const rows = data.length;
          const cellH = rows > 0 ? (height - 40) / rows : 0;
          return (
            <text
              key={`row-${i}`}
              x={55}
              y={20 + i * cellH + cellH / 2}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {label}
            </text>
          );
        })}
        {/* Col labels */}
        {colLabels?.map((label, j) => {
          const cols = data[0]?.length || 1;
          const cellW = cols > 0 ? (width - 60) / cols : 0;
          return (
            <text
              key={`col-${j}`}
              x={60 + j * cellW + cellW / 2}
              y={height - 5}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default Heatmap;
