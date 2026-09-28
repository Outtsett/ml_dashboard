/**
 * The FinBERT family for one instrument over the last day, computed by the hub
 * from its scored headlines with the same code the models train on
 * (lake.sentiment) — what a model reading this symbol right now would see.
 */

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SentimentGrid } from "./types";

const SERIES: { name: string; color: string; dash?: string }[] = [
  { name: "finbert_sentiment_decayed_short", color: "#E69F00" },
  { name: "finbert_sentiment_decayed_long", color: "#0072B2" },
  { name: "finbert_macro_sentiment_decayed_short", color: "#CC79A7", dash: "4 3" },
  { name: "finbert_news_intensity_decayed", color: "#56B4E9", dash: "2 2" },
  { name: "finbert_news_coverage_flag", color: "#999999", dash: "1 3" },
];

export function SentimentChart({ grid, root }: { grid: SentimentGrid | undefined; root: string }) {
  const data = grid?.roots[root];
  if (!data) return <div className="text-xs text-neutral-500 py-6">No sentiment for {root} yet.</div>;
  const rows = data.t.map((t, i) => {
    const row: Record<string, number> = { t };
    for (const series of SERIES) row[series.name] = data.features[series.name]?.[i] ?? 0;
    return row;
  });
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => new Date(t).toISOString().slice(11, 16)}
            stroke="#737373"
            fontSize={10}
            label={{ value: "time (UTC)", position: "insideBottomRight", fill: "#737373", fontSize: 10, offset: -2 }}
          />
          <YAxis stroke="#737373" fontSize={10} width={36} label={{ value: "value", angle: -90, position: "insideLeft", fill: "#737373", fontSize: 10 }} />
          <Tooltip
            contentStyle={{ background: "#0a0a0a", border: "1px solid #404040", fontSize: 11 }}
            labelFormatter={(t: number) => `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`}
            formatter={(value: number, name: string) => [value.toFixed(3), grid?.displayNames[name] ?? name]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} formatter={(name: string) => grid?.displayNames[name] ?? name} />
          {SERIES.map((series) => (
            <Line key={series.name} type="stepAfter" dataKey={series.name} stroke={series.color} strokeDasharray={series.dash} dot={false} strokeWidth={1.5} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
