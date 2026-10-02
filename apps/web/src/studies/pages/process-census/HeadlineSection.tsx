/**
 * "Right now": node.exe launcher plumbing against runtime across the whole
 * snapshot (the notebook applies no filter here), and the same two counts
 * across every landed snapshot.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Finding, GRID, OKABE, Section, Stat, TOOLTIP, fmtInt } from "@/studies/kit";
import { headline, type ProcessCensusBody, type ProcessRow } from "@shared/studies/process-census";
import { HatchPattern, Swatch } from "./hatch";
import { countAndMegabytes, megabytes, stamp } from "./format";

export function HeadlineSection({ body, rows }: { body: ProcessCensusBody; rows: readonly ProcessRow[] }) {
  const now = headline(rows);
  const history = body.snapshots.map((snapshot) => ({
    label: stamp(snapshot.snapshotTime).slice(11),
    plumbing: snapshot.plumbingNodeCount,
    runtime: snapshot.runtimeNodeCount,
    plumbingMegabytes: snapshot.plumbingNodeMegabytes,
    runtimeMegabytes: snapshot.runtimeNodeMegabytes,
    processCount: snapshot.processCount,
  }));
  const nodeCounts = body.snapshots.map((snapshot) => snapshot.nodeCount);

  return (
    <Section
      title="Right now"
      question="node.exe processes in the snapshot, split into launcher plumbing (does no work) and runtime (actually serving)."
    >
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="▨ Launcher plumbing" value={countAndMegabytes(now.plumbingCount, now.plumbingMegabytes)} tone={OKABE.sky} hint="node.exe processes whose only job is to start the next one; count · resident memory" />
        <Stat label="■ Runtime" value={countAndMegabytes(now.runtimeCount, now.runtimeMegabytes)} tone={OKABE.orange} hint="node.exe processes doing the work; count · resident memory" />
        <Stat label="Total node.exe" value={countAndMegabytes(now.totalCount, now.totalMegabytes)} hint="What Task Manager shows for node.exe" />
        <Stat label="Processes on the machine" value={fmtInt(now.machineProcessCount)} hint="Every process the collector could see" />
      </div>
      <Finding>
        Snapshot taken {stamp(body.snapshotTime)} ({body.source === "live" ? "sampled now by the dashboard server" : `landed, recipe ${body.recipe}`}), across {fmtInt(now.machineProcessCount)} processes on the machine.
        {now.totalCount > 0 && ` Of the ${fmtInt(now.totalCount)} node.exe processes, ${fmtInt(now.plumbingCount)} hold ${megabytes(now.plumbingMegabytes)} without serving anything.`}
      </Finding>

      {history.length > 1 && (
        <div className="mt-3 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-medium text-neutral-200">node.exe in each landed snapshot</span>
            <Swatch color={OKABE.sky} hatched label="launcher plumbing" />
            <Swatch color={OKABE.orange} hatched={false} label="runtime" />
          </div>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={history} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
              <HatchPattern id="history-hatch" color={OKABE.sky} />
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload, label }) => {
                  const row = payload?.[0]?.payload as (typeof history)[number] | undefined;
                  if (!row) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                      <div className="font-semibold">{label}</div>
                      <div>▨ launcher plumbing {fmtInt(row.plumbing)} · {megabytes(row.plumbingMegabytes)}</div>
                      <div>■ runtime {fmtInt(row.runtime)} · {megabytes(row.runtimeMegabytes)}</div>
                      <div>{fmtInt(row.processCount)} processes on the machine</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="plumbing" name="launcher plumbing" stackId="node" fill="url(#history-hatch)" stroke={OKABE.sky} isAnimationActive={false} />
              <Bar dataKey="runtime" name="runtime" stackId="node" fill={OKABE.orange} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <Finding>
            Across {history.length} landed snapshots node.exe ranged from {Math.min(...nodeCounts)} to {Math.max(...nodeCounts)} processes.
          </Finding>
        </div>
      )}
    </Section>
  );
}
