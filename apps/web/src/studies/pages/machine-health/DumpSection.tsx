/**
 * Dump files on disk: when each was written and how big it is, one marker
 * shape and colour per dump kind, the table of every file, and the size
 * column's own histogram with its eight numbers.
 */

import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AXIS, ColumnGrid, ControlBar, Finding, GRID, Section, Stat, SwitchControl, TOOLTIP, fmt, fmtInt, fmtTime } from "@/studies/kit";
import type { DumpRow, DumpSection as DumpBody } from "@shared/studies/machine-health";
import { DataTable, type TableColumn } from "./DataTable";
import { DUMP_PALETTE, DUMP_SHAPES, Marker, MarkerIcon } from "./markers";

function DumpTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DumpRow & { x: number; y: number } }> }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
      <div className="break-all font-mono text-neutral-100">{row.dumpPath}</div>
      <div className="text-neutral-300">{row.dumpKind}</div>
      <div className="text-neutral-300">{row.applicationName ?? "unknown application"}</div>
      <div className="font-mono text-neutral-100">{fmt(row.sizeMegabytes, 2)} megabytes, written {fmtTime(row.modifiedTime)}</div>
    </div>
  );
}

const COLUMNS: Array<TableColumn<DumpRow>> = [
  { key: "dump_path", header: "dump_path", value: (row) => row.dumpPath, className: "break-all" },
  { key: "dump_kind", header: "dump_kind", value: (row) => row.dumpKind },
  { key: "application_name", header: "application_name", value: (row) => row.applicationName },
  { key: "process_identifier", header: "process_identifier", value: (row) => row.processIdentifier, align: "right" },
  { key: "size_megabytes", header: "size_megabytes", value: (row) => row.sizeMegabytes, align: "right", decimals: 2 },
  { key: "created", header: "created (local)", value: (row) => row.createdTime, render: (row) => fmtTime(row.createdTime), align: "right" },
  { key: "modified", header: "modified (local)", value: (row) => row.modifiedTime, render: (row) => fmtTime(row.modifiedTime), align: "right" },
];

export function DumpSection({ dumps, logSize, onLogSize }: { dumps: DumpBody; logSize: boolean; onLogSize: (value: boolean) => void }) {
  const kinds = [...new Set(dumps.rows.map((row) => row.dumpKind))].sort();
  const plotted = dumps.rows.filter((row) => row.modifiedTime !== null && row.sizeMegabytes !== null && (!logSize || (row.sizeMegabytes ?? 0) > 0));
  const largest = dumps.rows.reduce<DumpRow | null>((best, row) => ((row.sizeMegabytes ?? 0) > (best?.sizeMegabytes ?? -1) ? row : best), null);
  const sizeRows = dumps.rows.filter((row) => row.sizeMegabytes !== null).map((row) => ({ size_megabytes: row.sizeMegabytes as number }));

  return (
    <Section title={`Dump files on disk: ${fmtInt(dumps.fileCount)} files, ${fmtInt(dumps.totalMegabytes)} megabytes`} question="When was each dump written, and how big is it?">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Stat label="Dump files" value={fmtInt(dumps.fileCount)} />
          <Stat label="Total size" value={`${fmt(dumps.totalMegabytes / 1024, 2)} gigabytes`} />
          <Stat label="Dump kinds" value={fmtInt(kinds.length)} />
          <Stat label="Largest" value={`${fmt(largest?.sizeMegabytes ?? null, 1)} MB`} hint={largest?.dumpPath} />
        </div>
        <ControlBar>
          <SwitchControl label="Logarithmic size axis" checked={logSize} onChange={onLogSize} />
        </ControlBar>
        {largest && (
          <Finding>
            The largest dump is {fmt(largest.sizeMegabytes, 1)} megabytes ({largest.applicationName ?? "unknown application"}, {largest.dumpKind}); the most recent was written {fmtTime(dumps.rows[0]?.modifiedTime)}.
          </Finding>
        )}
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-300">
          {kinds.map((kind, index) => (
            <li key={kind} className="flex items-center gap-1.5">
              <MarkerIcon shape={DUMP_SHAPES[index % DUMP_SHAPES.length] ?? "circle"} color={DUMP_PALETTE[index % DUMP_PALETTE.length] ?? "#999999"} size={4} />
              {kind}
            </li>
          ))}
        </ul>
        {plotted.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">No dump file to plot.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
              <CartesianGrid {...GRID} />
              <XAxis type="number" dataKey="x" name="written" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => new Date(value).toISOString().slice(0, 10)} {...AXIS} />
              <YAxis
                type="number"
                dataKey="y"
                name="size (megabytes)"
                scale={logSize ? "log" : "linear"}
                domain={logSize ? ["auto", "auto"] : [0, "auto"]}
                allowDataOverflow={false}
                width={56}
                tickFormatter={(value: number) => fmt(value, value < 10 ? 1 : 0)}
                {...AXIS}
              />
              <ZAxis range={[70, 70]} />
              <Tooltip content={<DumpTooltip />} cursor={{ strokeDasharray: "3 3" }} />
              {kinds.map((kind, index) => {
                const shape = DUMP_SHAPES[index % DUMP_SHAPES.length] ?? "circle";
                const color = DUMP_PALETTE[index % DUMP_PALETTE.length] ?? "#999999";
                const data = plotted.filter((row) => row.dumpKind === kind).map((row) => ({ ...row, x: row.modifiedTime as number, y: row.sizeMegabytes as number }));
                return (
                  <Scatter
                    key={kind}
                    name={kind}
                    data={data}
                    isAnimationActive={false}
                    shape={(props: { cx?: number; cy?: number }) => <Marker shape={shape} color={color} cx={props.cx ?? 0} cy={props.cy ?? 0} size={4.5} />}
                  />
                );
              })}
            </ScatterChart>
          </ResponsiveContainer>
        )}
        <DataTable rows={dumps.rows} columns={COLUMNS} pageSize={10} label="Every dump file, newest first" />
        <ColumnGrid rows={sizeRows} title="Every numeric column of the dump files" />
      </div>
    </Section>
  );
}
