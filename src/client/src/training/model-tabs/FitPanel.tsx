/**
 * FitPanel — Deep dive into LL, fit gauge, convergence quality.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Area,
} from "recharts";
import { FitGauge } from "../MicroComponents";
import type { Diagnostics, ConvergencePoint } from "@/training/lib/types";
import { getFitLevel, getFitVerdict, CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "@/training/lib/types";

export function FitPanel({ diagnostics, convergencePoints, nBarsForLL, llPerBar, ll }: {
  diagnostics: Diagnostics; convergencePoints: ConvergencePoint[]; nBarsForLL: number; llPerBar: number; ll: number;
}) {
  const fitLevel = getFitLevel(llPerBar);
  const fitVerdict = getFitVerdict(llPerBar);

  // Calculate convergence quality metrics
  const lastN = convergencePoints.slice(-10);
  const avgDelta = lastN.length > 1
    ? lastN.reduce((sum, p, i) => i === 0 ? sum : sum + Math.abs((p.log_likelihood - lastN[i-1]!.log_likelihood)), 0) / (lastN.length - 1)
    : 0;
  const converged = avgDelta < Math.abs(ll * 0.001); // <0.1% change

  return (
    <div className="space-y-4">
      {/* Big LL/bar display */}
      <div className="flex gap-4 items-start">
        <div className="bg-white/[0.02] rounded-xl p-5 border border-white/5 flex-1">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Log-Likelihood per Bar</div>
          <div className="text-5xl font-bold font-mono text-violet-400">{llPerBar.toFixed(2)}</div>
          <p className={`text-[11px] mt-2 ${fitVerdict.color}`}>{fitVerdict.text}</p>
          <FitGauge level={fitLevel} />
          <div className="mt-3 text-[10px] text-muted-foreground/50">
            <span className="font-mono text-violet-400/60">{ll.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> total across {nBarsForLL.toLocaleString()} bars
          </div>
        </div>
        <div className="flex flex-col gap-3 w-48">
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Convergence</div>
            <div className={`text-lg font-bold font-mono ${converged ? "text-emerald-400" : "text-amber-400"}`}>
              {converged ? "Converged" : "Not yet"}
            </div>
            <div className="text-[9px] text-muted-foreground/50">avg Δ = {avgDelta.toFixed(0)} (last 10)</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Iterations</div>
            <div className="text-lg font-bold font-mono text-foreground/70">{diagnostics.convergence_summary?.n_iterations ?? 0}</div>
            <div className="text-[9px] text-muted-foreground/50">burn-in: {diagnostics.training_config?.burn_in ?? 0}</div>
          </div>
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5">
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Features</div>
            <div className="text-lg font-bold font-mono text-foreground/70">{diagnostics.n_features}</div>
            <div className="text-[9px] text-muted-foreground/50 truncate" title={diagnostics.feature_names?.join(", ")}>
              {diagnostics.feature_names?.slice(0, 3).join(", ")}...
            </div>
          </div>
        </div>
      </div>

      {/* Full convergence chart */}
      {convergencePoints.length > 0 && (
        <div>
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Convergence Trajectory</div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={convergencePoints}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="iter" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} tickFormatter={(v: number) => nBarsForLL > 1 ? (v / nBarsForLL).toFixed(1) : v.toLocaleString()} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [nBarsForLL > 1 ? `${(v / nBarsForLL).toFixed(3)} per bar` : v.toLocaleString(), "Log-Likelihood"]} />
                <Area type="monotone" dataKey="log_likelihood" stroke="hsl(260, 80%, 70%)" fill="hsla(260, 80%, 70%, 0.1)" strokeWidth={2} name="LL" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Delta chart — how quickly convergence improved */}
      {convergencePoints.length > 2 && convergencePoints.some(p => p.delta !== undefined) && (
        <div>
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Convergence Speed (Δ per iteration)</div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={convergencePoints.filter(p => p.delta !== undefined)}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="iter" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} />
                <Tooltip {...CHART_TOOLTIP} />
                <Line type="monotone" dataKey="delta" stroke="hsl(160, 60%, 50%)" strokeWidth={1.5} dot={false} name="Delta (LL change)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
