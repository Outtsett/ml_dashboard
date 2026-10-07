/**
 * Which expert the gate chose, bar by bar, for a mixture of experts: a stacked
 * area of each expert's gate probability over the fold's test walk, each
 * expert's share of the fold, and how decisive the gate was (entropy). Reads
 * the run view (`cycle_gate_routing` per fold); nothing here fetches.
 */
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { RunGateRouting } from "@shared/runs/types";
import { Chip } from "@/runs/learning";
import { formatBarTime } from "@/runs/barTime";

const AXIS = { fontSize: 10, fill: "hsl(var(--muted-foreground))", fontFamily: "ui-monospace, monospace" } as const;
const GRID = "hsl(var(--border))";
const TOOLTIP_STYLE = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11, fontFamily: "ui-monospace, monospace" } as const;
/** One Okabe-Ito colour per expert, reinforced by the expert's number in every label. */
const EXPERT_COLORS = ["#E69F00", "#56B4E9", "#009E73", "#CC79A7", "#0072B2", "#D55E00", "#F0E442", "#999999"];
/** Bars drawn per fold: the walk is thinned by row count, never by clock span. */
const MAX_DRAWN_BARS = 600;

function thin<T>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows;
  const step = rows.length / limit;
  const out: T[] = [];
  for (let position = 0; position < limit; position += 1) out.push(rows[Math.floor(position * step)]!);
  return out;
}

export function GateRoutingPanel({ routings, modelLabel }: { routings: RunGateRouting[]; modelLabel: string | null }) {
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<"share" | "entropy">("share");
  const active = routings[Math.min(index, Math.max(0, routings.length - 1))] ?? null;
  const rows = active
    ? thin(
        active.timestamps.map((time, bar) => {
          const row: Record<string, number> = { time, entropy: active.entropy[bar] ?? 0 };
          active.probabilities[bar]?.forEach((probability, expert) => {
            row[`expert_${expert}`] = probability;
          });
          return row;
        }),
        MAX_DRAWN_BARS,
      )
    : [];
  const maxEntropy = active && active.expertCount > 1 ? Math.log(active.expertCount) : 1;
  const switches = active ? active.chosenExpert.reduce((count, expert, bar) => count + (bar > 0 && expert !== active.chosenExpert[bar - 1] ? 1 : 0), 0) : 0;

  return (
    <div className="rounded-md border border-border bg-card/60 p-3" data-testid="gate-routing">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-foreground">Which expert the gate chose, bar by bar</div>
          <div className="text-[11px] leading-snug text-muted-foreground">
            {view === "share"
              ? "Each bar of the test walk is a column; the coloured bands are the gate's probability per expert, stacking to 1. One expert filling the whole height means the gate hands every bar to it; interleaved bands mean it switches by regime."
              : "How decisive the gate was on each bar: 0 means one expert took it all, the grey line is an even split across every expert. A gate living near the grey line is not routing, it is averaging."}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {routings.map((routing, position) => (
            <Chip key={routing.foldIndex ?? position} active={position === index} onClick={() => setIndex(position)}>Fold {(routing.foldIndex ?? 0) + 1}</Chip>
          ))}
          {routings.length > 0 && (
            <>
              <Chip active={view === "share"} onClick={() => setView("share")}>Expert share</Chip>
              <Chip active={view === "entropy"} onClick={() => setView("entropy")}>Decisiveness</Chip>
            </>
          )}
        </div>
      </div>
      {active === null ? (
        <div className="mt-3 text-[11px] text-muted-foreground">
          {modelLabel ? `${modelLabel} has no gate: only a mixture of experts routes bars between experts. ` : ""}A mixture's routing lands after each fold's test walk.
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
            {active.usage.map((share, expert) => (
              <span key={expert} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: EXPERT_COLORS[expert % EXPERT_COLORS.length] }} />
                expert {expert + 1}: {(share * 100).toFixed(1)}% of the fold
              </span>
            ))}
            <span>· {active.timestamps.length.toLocaleString("en-US")} bars · the winning expert changed {switches.toLocaleString("en-US")} times</span>
          </div>
          <div className="mt-2 h-56">
            <ResponsiveContainer width="100%" height="100%">
              {view === "share" ? (
                <AreaChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }} stackOffset="expand">
                  <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
                  <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} tickFormatter={(value: number) => formatBarTime(value).slice(5)} minTickGap={60} />
                  <YAxis tick={AXIS} width={40} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(value: number) => formatBarTime(value)} formatter={(value: number, name: string) => [`${(value * 100).toFixed(1)}%`, name]} />
                  {Array.from({ length: active.expertCount }, (_, expert) => (
                    <Area key={expert} dataKey={`expert_${expert}`} name={`expert ${expert + 1}`} stackId="gate" stroke="none" fill={EXPERT_COLORS[expert % EXPERT_COLORS.length]} fillOpacity={0.85} isAnimationActive={false} />
                  ))}
                </AreaChart>
              ) : (
                <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
                  <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} tickFormatter={(value: number) => formatBarTime(value).slice(5)} minTickGap={60} />
                  <YAxis tick={AXIS} width={40} domain={[0, maxEntropy]} tickFormatter={(value: number) => value.toFixed(2)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(value: number) => formatBarTime(value)} formatter={(value: number) => [value.toFixed(3), "entropy"]} />
                  <ReferenceLine y={maxEntropy} stroke="#808A99" strokeDasharray="6 3" label={{ value: "even split", fontSize: 9, fill: "#808A99", position: "insideTopRight" }} />
                  <Line dataKey="entropy" name="entropy" stroke="#E69F00" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
