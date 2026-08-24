import { Card } from "@/shared/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";
import { Activity, TrendingUp } from "lucide-react";

interface HPOChartsSectionProps {
  chartData: any[];
  scatterData: any[];
  paramNames: string[];
  selectedParam: string;
  setSelectedParam: (val: string) => void;
  formatScore: (v: number | null | undefined) => string;
  trialsCount: number;
}

export function HPOChartsSection({
  chartData,
  scatterData,
  paramNames,
  selectedParam,
  setSelectedParam,
  formatScore,
  trialsCount,
}: HPOChartsSectionProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Optimization History Chart */}
      <Card className="bg-black/20 border-white/5 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Optimization History
          </h4>
          {chartData.length > 0 && (
            <div className="flex items-center gap-3 text-[9px] text-muted-foreground/50">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-0.5 rounded bg-[#3b82f680]" />
                Per-trial
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-0.5 rounded bg-emerald-500" />
                Best so far
              </span>
            </div>
          )}
        </div>
        <div className="px-4 pb-3" style={{ minHeight: 220 }}>
          {chartData.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground min-h-[200px]">
              <div className="text-center">
                <Activity className="h-5 w-5 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Waiting for trial results…</p>
                <p className="text-[10px] opacity-60 mt-1">
                  Data will appear as trials complete.
                </p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="trial"
                  tick={{ fontSize: 10, fill: "#888" }}
                  tickLine={false}
                  label={{ value: "Trial", position: "insideBottomRight", offset: -4, fontSize: 9, fill: "#666" }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#888" }}
                  tickLine={false}
                  width={65}
                  tickFormatter={(v: number) => formatScore(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1a1a1a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: 11,
                    borderRadius: 6,
                  }}
                  formatter={(value: number, name: string) => [
                    formatScore(value),
                    name === "bestSoFar" ? "Best so far" : "Score",
                  ]}
                  labelFormatter={(label) => `Trial ${label}`}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#3b82f680"
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    if (payload?.pruned) {
                      return (
                        <g key={`pruned-${payload.trial}`}>
                          <line x1={cx - 3} y1={cy - 3} x2={cx + 3} y2={cy + 3} stroke="#ef4444" strokeWidth={1.5} />
                          <line x1={cx + 3} y1={cy - 3} x2={cx - 3} y2={cy + 3} stroke="#ef4444" strokeWidth={1.5} />
                        </g>
                      );
                    }
                    return (
                      <circle
                        key={`dot-${payload?.trial}`}
                        cx={cx}
                        cy={cy}
                        r={2.5}
                        fill="#3b82f6"
                        stroke="none"
                      />
                    );
                  }}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
                <Line
                  type="stepAfter"
                  dataKey="bestSoFar"
                  stroke="#10b981"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Parameter vs Score Scatter */}
      <Card className="bg-black/20 border-white/5 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Parameter vs Score
          </h4>
          {paramNames.length > 0 && (
            <Select value={selectedParam} onValueChange={setSelectedParam}>
              <SelectTrigger className="h-6 w-[160px] text-[10px] bg-black/30 border-white/10">
                <SelectValue placeholder="Select param" />
              </SelectTrigger>
              <SelectContent>
                {paramNames.map((p) => (
                  <SelectItem key={p} value={p} className="text-[10px]">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="px-4 pb-3" style={{ minHeight: 200 }}>
          {scatterData.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground min-h-[180px]">
              <div className="text-center">
                <TrendingUp className="h-5 w-5 mx-auto mb-2 opacity-30" />
                <p className="text-xs">
                  {trialsCount === 0
                    ? "Awaiting trial data…"
                    : "No numeric data for this parameter."}
                </p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="value"
                  type="number"
                  tick={{ fontSize: 10, fill: "#888" }}
                  tickLine={false}
                  name={selectedParam}
                  label={{
                    value: selectedParam,
                    position: "insideBottomRight",
                    offset: -4,
                    fontSize: 9,
                    fill: "#666",
                  }}
                />
                <YAxis
                  dataKey="score"
                  type="number"
                  tick={{ fontSize: 10, fill: "#888" }}
                  tickLine={false}
                  width={65}
                  tickFormatter={(v: number) => formatScore(v)}
                  name="Score"
                />
                <ZAxis range={[20, 20]} />
                <Tooltip
                  contentStyle={{
                    background: "#1a1a1a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: 11,
                    borderRadius: 6,
                  }}
                  formatter={(value: number, name: string) => [
                    name === "Score" ? formatScore(value) : value,
                    name,
                  ]}
                  labelFormatter={() => ""}
                />
                <Scatter
                  data={scatterData}
                  fill="#3b82f6"
                  fillOpacity={0.7}
                  strokeWidth={0}
                />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
