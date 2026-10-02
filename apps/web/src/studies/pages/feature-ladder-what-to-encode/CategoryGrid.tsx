/**
 * The non-numeric columns of the ladder frame, each as its own graphic: the
 * count of rows per value (the numeric columns are drawn by ColumnGrid).
 */

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OKABE, TOOLTIP, fmtInt } from "@/studies/kit";

type Row = Record<string, unknown>;

export function CategoryGrid({ rows, columns, title }: { rows: readonly Row[]; columns: readonly string[]; title: string }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-neutral-200">{title}</div>
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
        {columns.map((column) => {
          const counts = new Map<string, number>();
          for (const row of rows) {
            const value = row[column];
            const key = value === null || value === undefined ? "missing" : String(value);
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
          const data = [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
          return (
            <div key={column} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
              <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={column}>
                {column}
              </div>
              <ResponsiveContainer width="100%" height={Math.max(60, 18 * data.length + 10)}>
                <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="value" width={130} tick={{ fill: "#a3a3a3", fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                  <Tooltip {...TOOLTIP} formatter={(value: number) => [fmtInt(value), "rows"]} />
                  <Bar dataKey="count" fill={OKABE.sky} isAnimationActive={false} label={{ position: "right", fill: "#d4d4d4", fontSize: 10 }} />
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-neutral-500">
                {data.length} distinct value{data.length === 1 ? "" : "s"}, {fmtInt(rows.length)} rows
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
