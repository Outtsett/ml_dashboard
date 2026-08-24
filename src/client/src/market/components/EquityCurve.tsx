import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine,
} from "recharts";

interface EquityDataPoint {
  step: number;
  pnl: number;
  drawdown: number;
}

interface EquityCurveProps {
  data: EquityDataPoint[];
}

export function EquityCurve({ data }: EquityCurveProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-xs h-40">
        No equity data available
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg p-4">
        <h3 className="text-sm font-mono font-medium mb-2">Cumulative PnL</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="step" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ fontSize: 11, fontFamily: "monospace" }}
              formatter={(value: number) => [value.toFixed(4), ""]}
            />
            <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke="#10b981"
              fill="#10b98133"
              strokeWidth={2}
              name="PnL"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="border border-border rounded-lg p-4">
        <h3 className="text-sm font-mono font-medium mb-2">Drawdown</h3>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="step" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              contentStyle={{ fontSize: 11, fontFamily: "monospace" }}
              formatter={(value: number) => [value.toFixed(4), ""]}
            />
            <Area
              type="monotone"
              dataKey="drawdown"
              stroke="#ef4444"
              fill="#ef444433"
              strokeWidth={2}
              name="Drawdown"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default EquityCurve;
