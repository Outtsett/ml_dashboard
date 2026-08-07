/**
 * WalkForwardPanel — Stability chart + window breakdown table.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { Diagnostics } from "@/training/lib/types";
import { getStabilityVerdict, CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "@/training/lib/types";

export function WalkForwardPanel({ diagnostics, wfWindResults, stability }: {
  diagnostics: Diagnostics; wfWindResults: any[]; stability: number;
}) {
  return (
    <div className="space-y-4">
      {/* Stability summary */}
      <div className="flex gap-3">
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Stability Score</div>
          <div className="text-3xl font-bold font-mono text-[hsl(var(--data-pos))]">{stability > 0 ? `${(stability * 100).toFixed(0)}%` : "--"}</div>
          <p className={`text-[10px] mt-1 ${getStabilityVerdict(stability).color}`}>{getStabilityVerdict(stability).text}</p>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Windows</div>
          <div className="text-3xl font-bold font-mono text-foreground/70">{diagnostics.walk_forward?.n_windows ?? 0}</div>
          <div className="text-[9px] text-muted-foreground/50 mt-1">sequential time periods</div>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Avg Confidence</div>
          <div className="text-3xl font-bold font-mono text-foreground/70">
            {diagnostics.walk_forward?.avg_oos_confidence
              ? `${(diagnostics.walk_forward.avg_oos_confidence * 100).toFixed(0)}%`
              : "--"}
          </div>
          <div className="text-[9px] text-muted-foreground/50 mt-1">average across windows</div>
        </div>
      </div>

      {/* Bar chart */}
      <div>
        <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Confidence & Switch Rate per Window</div>
        <div className="h-[260px]">
          {wfWindResults.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={wfWindResults.map((w, i) => ({
                window: `W${i + 1}`,
                confidence: w.avg_confidence ? Number((w.avg_confidence * 100).toFixed(1)) : 0,
                switchRate: w.switch_rate ? Number((w.switch_rate * 100).toFixed(1)) : 0,
                failed: w.failed,
              }))}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="window" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} unit="%" />
                <Tooltip {...CHART_TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: "9px" }} />
                <Bar dataKey="confidence" fill="hsl(160, 60%, 45%)" radius={[2, 2, 0, 0]} name="Confidence %" />
                <Bar dataKey="switchRate" fill="hsl(45, 90%, 55%)" radius={[2, 2, 0, 0]} name="Switch Rate %" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">No walk-forward data</div>
          )}
        </div>
      </div>

      {/* Window details table */}
      {wfWindResults.length > 0 && (
        <div>
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Window Details</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/5 text-muted-foreground">
                <th className="text-left py-2 px-3 font-medium">Window</th>
                <th className="text-right py-2 px-3 font-medium">Train</th>
                <th className="text-right py-2 px-3 font-medium">Test</th>
                <th className="text-right py-2 px-3 font-medium">Confidence</th>
                <th className="text-right py-2 px-3 font-medium">Switch Rate</th>
                <th className="text-center py-2 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {wfWindResults.map((w, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 px-3 font-mono text-foreground">W{i + 1}</td>
                  <td className="text-right py-2 px-3 font-mono text-muted-foreground">{w.train_size?.toLocaleString()}</td>
                  <td className="text-right py-2 px-3 font-mono text-muted-foreground">{w.test_size?.toLocaleString()}</td>
                  <td className="text-right py-2 px-3 font-mono text-[hsl(var(--data-pos))]">
                    {w.avg_confidence ? `${(w.avg_confidence * 100).toFixed(1)}%` : "--"}
                  </td>
                  <td className="text-right py-2 px-3 font-mono text-amber-400">
                    {w.switch_rate ? `${(w.switch_rate * 100).toFixed(1)}%` : "--"}
                  </td>
                  <td className="text-center py-2 px-3">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                      w.failed ? "bg-[hsl(var(--data-neg)/0.15)] text-[hsl(var(--data-neg))]" : "bg-[hsl(var(--data-pos)/0.15)] text-[hsl(var(--data-pos))]"
                    }`}>
                      {w.failed ? "FAIL" : "PASS"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
