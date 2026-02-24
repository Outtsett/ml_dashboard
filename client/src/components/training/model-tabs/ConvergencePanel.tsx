/**
 * ConvergencePanel — LL chart, active states chart, entropy/switch/dwell metrics.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Area,
} from "recharts";
import type { Diagnostics, ConvergencePoint } from "../types";
import { CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "../types";

export function ConvergencePanel({ diagnostics, convergencePoints, nBarsForLL, llPerBar }: {
  diagnostics: Diagnostics; convergencePoints: ConvergencePoint[]; nBarsForLL: number; llPerBar: number;
}) {
  const finalLL = diagnostics.convergence_summary?.final_log_likelihood ?? 0;
  const finalStates = diagnostics.convergence_summary?.final_active_states ?? 0;
  const nIter = diagnostics.convergence_summary?.n_iterations ?? 0;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="flex gap-3 flex-wrap">
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1 min-w-[120px]">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Final LL/bar</div>
          <div className="text-xl font-bold font-mono text-violet-400">{llPerBar.toFixed(2)}</div>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1 min-w-[120px]">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Total LL</div>
          <div className="text-xl font-bold font-mono text-violet-400/70">{finalLL.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1 min-w-[120px]">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Final States</div>
          <div className="text-xl font-bold font-mono text-amber-400">{finalStates}</div>
        </div>
        <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 flex-1 min-w-[120px]">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-1">Iterations</div>
          <div className="text-xl font-bold font-mono text-foreground/70">{nIter}</div>
        </div>
      </div>

      {/* LL Convergence Chart */}
      <div>
        <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Log-Likelihood per Bar over Gibbs Iterations</div>
        <div className="h-[260px]">
          {convergencePoints.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={convergencePoints}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="iter" {...CHART_AXIS} label={{ value: "Gibbs Iteration", position: "bottom", fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis {...CHART_AXIS} tickFormatter={(v: number) => nBarsForLL > 1 ? (v / nBarsForLL).toFixed(1) : v.toLocaleString()} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [nBarsForLL > 1 ? `${(v / nBarsForLL).toFixed(3)} per bar` : v.toLocaleString(), "Log-Likelihood"]} />
                <Area type="monotone" dataKey="log_likelihood" stroke="hsl(260, 80%, 70%)" fill="hsla(260, 80%, 70%, 0.1)" strokeWidth={2} name="LL (per bar)" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">No convergence data</div>
          )}
        </div>
      </div>

      {/* Active States Chart */}
      {convergencePoints.some(p => p.n_active_states !== undefined) && (
        <div>
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">Active States over Gibbs Iterations</div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={convergencePoints}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="iter" {...CHART_AXIS} />
                <YAxis {...CHART_AXIS} allowDecimals={false} />
                <Tooltip {...CHART_TOOLTIP} />
                <Line type="stepAfter" dataKey="n_active_states" stroke="hsl(45, 90%, 55%)" strokeWidth={2} dot={false} name="Active States" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Entropy + Switch Rate + Self-Transition + Avg Dwell */}
      {convergencePoints.some(p => p.entropy !== undefined && p.entropy > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Entropy */}
          <div>
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">
              Entropy (regime balance)
              <span className="ml-2 normal-case tracking-normal text-[8px] opacity-50">Higher = more evenly spread</span>
            </div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={convergencePoints}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="iter" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [v.toFixed(3), "Entropy"]} />
                  <Line type="monotone" dataKey="entropy" stroke="hsl(174, 72%, 56%)" strokeWidth={1.5} dot={false} name="Entropy" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Switch Rate */}
          <div>
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">
              Switch Rate
              <span className="ml-2 normal-case tracking-normal text-[8px] opacity-50">Fraction of bars where regime changes</span>
            </div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={convergencePoints}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="iter" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [v.toFixed(4), "Switch Rate"]} />
                  <Line type="monotone" dataKey="switch_rate" stroke="hsl(199, 89%, 48%)" strokeWidth={1.5} dot={false} name="Switch Rate" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Self-Transition */}
          <div>
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">
              Self-Transition (stickiness)
              <span className="ml-2 normal-case tracking-normal text-[8px] opacity-50">Higher = stickier regimes</span>
            </div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={convergencePoints}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="iter" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} domain={[0, 1]} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, "Self-Transition"]} />
                  <Line type="monotone" dataKey="self_transition" stroke="hsl(142, 76%, 36%)" strokeWidth={1.5} dot={false} name="Self-Transition" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Avg Dwell */}
          <div>
            <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest mb-2">
              Avg Dwell Time (bars per regime)
              <span className="ml-2 normal-case tracking-normal text-[8px] opacity-50">How long the model stays in one mood</span>
            </div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={convergencePoints}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="iter" {...CHART_AXIS} />
                  <YAxis {...CHART_AXIS} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => [`${v.toFixed(1)} bars`, "Avg Dwell"]} />
                  <Line type="monotone" dataKey="avg_dwell" stroke="hsl(280, 65%, 60%)" strokeWidth={1.5} dot={false} name="Avg Dwell" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
