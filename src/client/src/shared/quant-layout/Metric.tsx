import { ResponsiveContainer, LineChart, Line, YAxis } from "recharts";
import { paletteColorDark } from "@/shared/theme/dataColors";

export function Metric({ 
  label, 
  value, 
  history = [],
  color = paletteColorDark(0),
  valuePrefix = "",
  valueSuffix = "",
}: { 
  label: string;
  value: number;
  history?: number[];
  color?: string;
  valuePrefix?: string;
  valueSuffix?: string;
}) {
  const data = history.length > 0 ? history.map((v, i) => ({ index: i, value: v })) : [{index: 0, value: 0}, {index: 1, value: 0}];
  const min = Math.min(...(history.length > 0 ? history : [0]));
  const max = Math.max(...(history.length > 0 ? history : [0]));

  return (
    <div className="flex flex-col gap-1 p-2 rounded-lg bg-neutral-900/50 border border-neutral-800/50">
      <div className="flex justify-between items-center">
        <span className="text-xs text-neutral-500 font-medium">{label}</span>
        <span className="text-sm font-mono text-neutral-200">
          {valuePrefix}{value.toFixed(4)}{valueSuffix}
        </span>
      </div>
      <div className="h-6 w-full opacity-75">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <YAxis domain={[min, max]} hide />
            <Line 
              type="monotone" 
              dataKey="value" 
              stroke={color} 
              strokeWidth={1.5} 
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
