import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Line,
  LineChart,
} from "recharts";

interface ReliabilityBin {
  predicted: number;
  observed: number;
  count: number;
}

interface ReliabilityDiagramProps {
  bins: ReliabilityBin[];
  ece?: number;
}

export function ReliabilityDiagram({ bins, ece }: ReliabilityDiagramProps) {
  if (bins.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-xs h-40">
        No calibration data
      </div>
    );
  }

  // Add perfect calibration line data
  const lineData = [
    { predicted: 0, observed: 0 },
    ...bins.map((b) => ({ predicted: b.predicted, observed: b.observed })),
    { predicted: 1, observed: 1 },
  ].sort((a, b) => a.predicted - b.predicted);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-mono font-medium">Reliability Diagram</h3>
        {ece !== undefined && (
          <span className="text-xs font-mono text-muted-foreground">
            ECE: {ece.toFixed(4)}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={lineData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="predicted"
            tick={{ fontSize: 10 }}
            domain={[0, 1]}
            label={{ value: "Predicted", position: "bottom", fontSize: 10, offset: -5 }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            domain={[0, 1]}
            label={{ value: "Observed", angle: -90, position: "insideLeft", fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, fontFamily: "monospace" }}
            formatter={(value: number) => [value.toFixed(3), ""]}
          />
          <ReferenceLine
            segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
            stroke="#666"
            strokeDasharray="3 3"
            label=""
          />
          <Line
            type="monotone"
            dataKey="observed"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 4, fill: "#3b82f6" }}
            name="Calibration"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ReliabilityDiagram;
