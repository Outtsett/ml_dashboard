import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface MetricChartProps {
  title: string;
  data: { epoch: number; value: number }[];
  color?: string;
  domain?: [number, number];
  height?: number;
}

const PLACEHOLDER_DATA = [
  { epoch: 0, value: 0 },
  { epoch: 1, value: 0 },
];

export function MetricChart({
  title,
  data,
  color = "#3b82f6",
  domain,
  height = 200,
}: MetricChartProps) {
  const hasData = data.length > 0;
  const chartData = hasData ? data : PLACEHOLDER_DATA;

  return (
    <div className="border border-border rounded-lg p-4 bg-card/30">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </h3>
        <span className="text-xs font-mono tabular-nums" style={{ color: hasData ? color : "hsl(var(--muted-foreground))" }}>
          {hasData ? data[data.length - 1]!.value.toFixed(4) : "---"}
        </span>
      </div>

      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={hasData ? 0.5 : 0.25} />
            <XAxis
              dataKey="epoch"
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={false}
              label={hasData ? undefined : { value: "epoch", position: "insideBottom", offset: -2, fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.5 }}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              width={40}
              domain={domain}
              label={hasData ? undefined : { value: title.toLowerCase(), angle: -90, position: "insideLeft", offset: 10, fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.5 }}
            />
            {hasData && (
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  fontFamily: "monospace",
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke={hasData ? color : "transparent"}
              dot={false}
              strokeWidth={1.5}
              name={title}
            />
          </LineChart>
        </ResponsiveContainer>
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] text-muted-foreground/30 font-mono bg-card/80 px-2 py-0.5 rounded">
              awaiting metrics
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface MultiLineChartProps {
  title: string;
  data: Record<string, number | undefined>[];
  lines: { key: string; label: string; color: string }[];
  height?: number;
}

export function MultiLineChart({ title, data, lines, height = 200 }: MultiLineChartProps) {
  const hasData = data.length > 0;
  const chartData = hasData ? data : [{ epoch: 0 }, { epoch: 1 }];

  return (
    <div className="border border-border rounded-lg p-4 bg-card/30">
      <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {title}
      </h3>

      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={hasData ? 0.5 : 0.25} />
            <XAxis
              dataKey="epoch"
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={false}
              label={hasData ? undefined : { value: "epoch", position: "insideBottom", offset: -2, fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.5 }}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            {hasData && (
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  fontFamily: "monospace",
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                }}
              />
            )}
            <Legend
              wrapperStyle={{ fontSize: 10, fontFamily: "monospace", opacity: hasData ? 1 : 0.4 }}
            />
            {lines.map((line) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                name={line.label}
                stroke={hasData ? line.color : "transparent"}
                dot={false}
                strokeWidth={1.5}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[10px] text-muted-foreground/30 font-mono bg-card/80 px-2 py-0.5 rounded">
              awaiting metrics
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
