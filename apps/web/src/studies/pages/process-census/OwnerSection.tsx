/**
 * Who owns each process: count and resident memory by owner category, each
 * bar split into launcher plumbing (hatched) and runtime (solid).
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Finding, GRID, OKABE, Section, TOOLTIP, fmtInt } from "@/studies/kit";
import { ownerBars, ownerLabel, type OwnerBar, type ProcessRow } from "@shared/studies/process-census";
import { HatchPattern, Swatch } from "./hatch";
import { megabytes } from "./format";

function OwnerChart({ bars, metric, id }: { bars: OwnerBar[]; metric: "count" | "memory"; id: string }) {
  const data = bars.map((bar) => ({
    ...bar,
    label: ownerLabel(bar.ownerCategory),
    plumbing: metric === "count" ? bar.plumbingCount : bar.plumbingMegabytes,
    runtime: metric === "count" ? bar.runtimeCount : bar.runtimeMegabytes,
  }));
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] font-medium text-neutral-200">{metric === "count" ? "Process count by owner" : "Resident memory by owner (MB)"}</div>
      <ResponsiveContainer width="100%" height={Math.max(150, 26 * data.length + 50)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 4 }}>
          <HatchPattern id={id} color={OKABE.sky} />
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} allowDecimals={metric === "memory"} />
          <YAxis type="category" dataKey="label" width={190} {...AXIS} interval={0} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{row.ownerCategory}</div>
                  <div>▨ launcher plumbing {fmtInt(row.plumbingCount)} · {megabytes(row.plumbingMegabytes, 1)}</div>
                  <div>■ runtime {fmtInt(row.runtimeCount)} · {megabytes(row.runtimeMegabytes, 1)}</div>
                  <div>total {fmtInt(row.totalCount)} · {megabytes(row.totalMegabytes, 1)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="plumbing" name="launcher plumbing" stackId="role" fill={`url(#${id})`} stroke={OKABE.sky} isAnimationActive={false} />
          <Bar dataKey="runtime" name="runtime" stackId="role" fill={OKABE.orange} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OwnerSection({ rows, scopeLabel }: { rows: readonly ProcessRow[]; scopeLabel: string }) {
  const byCount = ownerBars(rows, "count");
  const byMemory = ownerBars(rows, "memory");
  const plumbingCount = rows.filter((row) => row.is_launcher_plumbing).length;
  const plumbingMegabytes = rows.reduce((sum, row) => sum + (row.is_launcher_plumbing ? row.resident_memory_megabytes : 0), 0);
  const totalMegabytes = rows.reduce((sum, row) => sum + row.resident_memory_megabytes, 0);

  return (
    <Section title="Who owns each process" question={`Owner category of every process shown: ${scopeLabel}.`}>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Swatch color={OKABE.sky} hatched label="launcher plumbing" />
        <Swatch color={OKABE.orange} hatched={false} label="runtime" />
      </div>
      {rows.length === 0 ? (
        <Finding>No process passes the filter.</Finding>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <OwnerChart bars={byCount} metric="count" id="owner-count-hatch" />
            <OwnerChart bars={byMemory} metric="memory" id="owner-memory-hatch" />
          </div>
          <Finding>
            {fmtInt(rows.length)} processes hold {megabytes(totalMegabytes)}; {fmtInt(plumbingCount)} of them are launcher plumbing, holding {megabytes(plumbingMegabytes)}.
            {byMemory[0] && ` The largest owner by memory is ${byMemory[0].ownerCategory} at ${megabytes(byMemory[0].totalMegabytes)} across ${fmtInt(byMemory[0].totalCount)} ${byMemory[0].totalCount === 1 ? "process" : "processes"}.`}
          </Finding>
        </>
      )}
    </Section>
  );
}
