/**
 * Background processes for one snapshot: the machine totals, the process
 * groups by private memory and by CPU, one histogram per numeric column of
 * the snapshot (every column seen, with its eight numbers), and the private
 * memory of each group across snapshots.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SelectControl, SliderControl, Stat, SwitchControl, TOOLTIP,
  eightNumberSummary, fmt, fmtInt, fmtTime,
} from "@/studies/kit";
import {
  PROCESS_COLUMNS, fullRangeBins, logOnePlus,
  type ComparisonRow, type ProcessGroup, type ProcessSection as ProcessBody,
} from "@shared/studies/machine-health";
import { DataTable, type TableColumn } from "./DataTable";

const PANEL_COLORS = ["#0072B2", "#E69F00", "#56B4E9", "#D55E00", "#CC79A7", "#009E73"] as const;
const SUMMARY_KEYS = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "sd"], ["skewness", "skew"], ["kurtosis", "kurt"],
  ["percentile25", "p25"], ["percentile75", "p75"], ["minimum", "min"], ["maximum", "max"],
] as const;

function GroupBars({ groups, dataKey, color, title, xLabel }: { groups: ProcessGroup[]; dataKey: "privateMegabytes" | "cpuPercentOfOneCore"; color: string; title: string; xLabel: string }) {
  const top = groups;
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] font-medium text-neutral-300">{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(120, 18 * top.length + 40)}>
        <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 18 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" label={{ value: xLabel, position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} {...AXIS} />
          <YAxis type="category" dataKey="processName" width={140} interval={0} {...AXIS} />
          <Tooltip
            {...TOOLTIP}
            formatter={(value: number, name: string) => [fmt(value, 1), name]}
            labelFormatter={(label, payload) => {
              const row = payload?.[0]?.payload as ProcessGroup | undefined;
              return row ? `${label}: ${fmtInt(row.processCount)} processes, ${fmt(row.cpuSecondsTotal, 1)} CPU seconds` : String(label);
            }}
          />
          <Bar dataKey={dataKey} fill={color} stroke="#e5e5e5" strokeWidth={0.4} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ColumnPanel({ name, values, bins, logValues, color }: { name: string; values: number[]; bins: number; logValues: boolean; color: string }) {
  const summary = eightNumberSummary(values);
  const plotted = logValues ? values.map(logOnePlus) : values;
  const data = fullRangeBins(plotted, bins).map((bin) => ({ ...bin, middle: (bin.lower + bin.upper) / 2 }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={name}>{name.replaceAll("_", " ")}</div>
      <ResponsiveContainer width="100%" height={130}>
        <BarChart data={data} margin={{ top: 2, right: 4, left: 0, bottom: 16 }} barCategoryGap={0}>
          <XAxis
            dataKey="middle"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) => fmt(value, logValues ? 1 : 0)}
            label={{ value: logValues ? `log10(1 + ${name})` : name, position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 9 }}
            {...AXIS}
          />
          <YAxis allowDecimals={false} width={28} {...AXIS} />
          <Tooltip
            {...TOOLTIP}
            formatter={(value: number) => [fmtInt(value), "processes"]}
            labelFormatter={(_, payload) => {
              const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return bin ? `${fmt(bin.lower, 2)} to ${fmt(bin.upper, 2)}` : "";
            }}
          />
          <Bar dataKey="count" fill={color} stroke="#e5e5e5" strokeWidth={0.4} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[10px] font-mono tnum">
        <dt className="col-span-3 text-neutral-500">n {fmtInt(summary.count)} (eight numbers of the raw values)</dt>
        {SUMMARY_KEYS.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-1">
            <span className="text-neutral-500">{label}</span>
            <span className="text-neutral-200">{fmt(summary[key] as number | null, 2)}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ProcessSection({
  processes, comparison, groupCount, columnBins, columnLog, onLabel, onGroupCount, onColumnBins, onColumnLog,
}: {
  processes: ProcessBody;
  comparison: ComparisonRow[];
  groupCount: number;
  columnBins: number;
  columnLog: boolean;
  onLabel: (label: string) => void;
  onGroupCount: (value: number) => void;
  onColumnBins: (value: number) => void;
  onColumnLog: (value: boolean) => void;
}) {
  const machine = processes.machine;
  const byMemory = [...processes.groups].sort((a, b) => b.privateMegabytes - a.privateMegabytes || a.processName.localeCompare(b.processName)).slice(0, groupCount);
  const byCpu = [...processes.groups].sort((a, b) => b.cpuPercentOfOneCore - a.cpuPercentOfOneCore || a.processName.localeCompare(b.processName)).slice(0, groupCount);
  const topMemory = byMemory[0];
  const comparisonLabels = comparison[0] ? Object.keys(comparison[0].privateMegabytes) : processes.labels;
  const sampleSeconds = machine?.cpuSampleSeconds ?? null;

  const comparisonColumns: Array<TableColumn<ComparisonRow>> = [
    { key: "process_name", header: "process_name", value: (row) => row.processName },
    ...comparisonLabels.map((label) => ({
      key: `label:${label}`,
      header: `${label} (private megabytes)`,
      value: (row: ComparisonRow) => row.privateMegabytes[label] ?? 0,
      align: "right" as const,
    })),
  ];

  return (
    <Section title="Background processes" question="What is running, and what does it cost in memory and CPU?">
      <div className="space-y-3">
        <ControlBar>
          {processes.labels.length > 0 && (
            <SelectControl label="Background snapshot" value={processes.label ?? processes.labels[0] ?? ""} options={processes.labels.map((label) => ({ value: label, label }))} onChange={onLabel} />
          )}
          <SliderControl label="Process groups shown" value={groupCount} min={10} max={60} onChange={onGroupCount} />
        </ControlBar>
        {machine && (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <Stat label="Snapshot taken" value={fmtTime(machine.snapshotTime)} hint="Pacific wall clock" />
            <Stat label="Booted" value={fmtTime(machine.bootTime)} />
            <Stat label="Physical memory free" value={`${fmt(machine.physicalAvailableGigabytes, 1)} of ${fmt(machine.physicalTotalGigabytes, 1)} GB`} />
            <Stat label="Page file used" value={`${fmt(machine.pagefileUsedGigabytes, 1)} of ${fmt(machine.pagefileTotalGigabytes, 1)} GB`} />
            <Stat label="Processes" value={fmtInt(machine.processCount)} />
            <Stat label="Private memory, all processes" value={`${fmt(machine.privateTotalGigabytes, 1)} GB`} />
            <Stat label="CPU sample" value={`${fmtInt(sampleSeconds)} seconds`} hint="cpu_percent_of_one_core is measured over this sample; 100 is one full core" />
            <Stat label="Process groups" value={fmtInt(processes.groups.length)} />
          </div>
        )}
        {topMemory && (
          <Finding>
            {processes.groups.length} process groups across {fmtInt(processes.processCount)} processes (process_id 0 excluded). {topMemory.processName} holds the most private memory:
            {" "}{fmt(topMemory.privateMegabytes, 0)} megabytes in {fmtInt(topMemory.processCount)} process{topMemory.processCount === 1 ? "" : "es"}.
          </Finding>
        )}
        {processes.groups.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">No process rows for this snapshot.</p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <GroupBars groups={byMemory} dataKey="privateMegabytes" color={OKABE.blue} title="Private memory by process group" xLabel="private memory (megabytes)" />
            <GroupBars groups={byCpu} dataKey="cpuPercentOfOneCore" color={OKABE.orange} title="CPU by process group" xLabel={`CPU over the ${sampleSeconds ?? 30} second sample (100 = one core)`} />
          </div>
        )}

        <div className="space-y-2">
          <div className="text-xs font-semibold text-neutral-200">Every numeric column of the process snapshot, one panel each</div>
          <ControlBar>
            <SliderControl label="Bins per panel" value={columnBins} min={10} max={80} onChange={onColumnBins} />
            <SwitchControl label="log10(1 + value)" checked={columnLog} onChange={onColumnLog} />
          </ControlBar>
          <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
            {PROCESS_COLUMNS.map((column, index) => (
              <ColumnPanel key={column} name={column} values={processes.columns[column]} bins={columnBins} logValues={columnLog} color={PANEL_COLORS[index % PANEL_COLORS.length] ?? OKABE.blue} />
            ))}
          </div>
          {columnLog && (
            <FormulaCard
              tex={String.raw`y_i = \log_{10}\left(1 + \max(x_i,\, 0)\right)`}
              caption="Each panel's horizontal axis when the switch is on; the eight numbers beside each panel are always of the raw values."
              symbols={[
                { tex: String.raw`y_i`, name: "the value plotted for process i", value: "log10 scale" },
                { tex: String.raw`x_i`, name: "the raw column value of process i (megabytes, seconds, percent, or a count)", value: `${fmtInt(processes.processCount)} processes` },
                { tex: String.raw`\max(x_i, 0)`, name: "the value floored at zero, so the logarithm of 1 + x is defined", value: "floor 0" },
              ]}
            />
          )}
        </div>

        {comparisonLabels.length > 1 ? (
          <DataTable rows={comparison} columns={comparisonColumns} pageSize={15} label="Private megabytes per process group, per snapshot" />
        ) : (
          <Finding>
            Only the {comparisonLabels[0] ?? "before"} snapshot exists. The after_restart snapshot is recorded at the next sign-in, then this becomes a side-by-side comparison.
          </Finding>
        )}
      </div>
    </Section>
  );
}
