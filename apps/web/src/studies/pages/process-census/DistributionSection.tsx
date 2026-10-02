/**
 * Distribution of resident memory by owner: the eight numbers per owner, every
 * process drawn as a point on its owner's row (triangle = launcher plumbing,
 * circle = runtime), and one histogram panel per numeric column.
 */

import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AXIS, ColumnGrid, ControlBar, Finding, GRID, OKABE, Section, SwitchControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import { ownerLabel, ownerStatistics, type ProcessRow } from "@shared/studies/process-census";
import { megabytes, statistic } from "./format";

const STATISTIC_COLUMNS: Array<[string, (summary: ReturnType<typeof ownerStatistics>[number]["summary"]) => number | null]> = [
  ["mean", (s) => s.mean],
  ["median", (s) => s.median],
  ["standard deviation", (s) => s.standardDeviation],
  ["skewness", (s) => s.skewness],
  ["kurtosis", (s) => s.kurtosis],
  ["25th percentile", (s) => s.percentile25],
  ["75th percentile", (s) => s.percentile75],
  ["minimum", (s) => s.minimum],
  ["maximum", (s) => s.maximum],
];

/** Identifiers, not measurements: a histogram of process numbers says nothing. */
const IDENTIFIER_COLUMNS = ["process_identifier", "parent_process_identifier"];
const LOG_FLOOR_MEGABYTES = 0.1;

interface Point {
  owner: string;
  megabytes: number;
  processName: string;
  processIdentifier: number;
  commandLine: string;
}

export function DistributionSection({ rows, logScale, onLogScale }: { rows: readonly ProcessRow[]; logScale: boolean; onLogScale: (value: boolean) => void }) {
  const statistics = ownerStatistics(rows);
  const toPoint = (row: ProcessRow): Point => ({
    owner: ownerLabel(row.owner_category),
    megabytes: logScale ? Math.max(row.resident_memory_megabytes, LOG_FLOOR_MEGABYTES) : row.resident_memory_megabytes,
    processName: row.process_name,
    processIdentifier: row.process_identifier,
    commandLine: row.command_line.slice(0, 160),
  });
  const plumbing = rows.filter((row) => row.is_launcher_plumbing).map(toPoint);
  const runtime = rows.filter((row) => !row.is_launcher_plumbing).map(toPoint);
  const heaviest = statistics.reduce<(typeof statistics)[number] | null>((best, candidate) => (best === null || (candidate.summary.maximum ?? 0) > (best.summary.maximum ?? 0) ? candidate : best), null);

  return (
    <Section
      title="Distribution of resident memory, by owner"
      question="Mean and standard deviation describe a Gaussian and process memory is not Gaussian: skewness and kurtosis show the one fat process that drags the mean, and the maximum names it."
    >
      {rows.length === 0 ? (
        <Finding>No process passes the filter.</Finding>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full min-w-[720px] text-[11px]">
              <thead>
                <tr className="text-right text-neutral-500">
                  <th className="px-2 py-1 text-left font-normal">owner category</th>
                  <th className="px-2 py-1 font-normal">count</th>
                  {STATISTIC_COLUMNS.map(([heading]) => (
                    <th key={heading} className="px-2 py-1 font-normal">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tnum text-neutral-200">
                {statistics.map(({ ownerCategory, summary }) => (
                  <tr key={ownerCategory} className="border-t border-neutral-900 text-right">
                    <td className="px-2 py-1 text-left font-sans text-neutral-300">{ownerCategory}</td>
                    <td className="px-2 py-1">{fmtInt(summary.count)}</td>
                    {STATISTIC_COLUMNS.map(([heading, pick]) => (
                      <td key={heading} className="px-2 py-1">
                        {statistic(pick(summary))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-neutral-500">Resident memory in MB. Skewness needs 3 processes and kurtosis 4, below that the cell reads NaN. Sample estimators, as pandas computes them.</p>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <ControlBar>
                <SwitchControl label="Log memory axis" checked={logScale} onChange={onLogScale} hint="Memory spans orders of magnitude" />
              </ControlBar>
              <span className="inline-flex items-center gap-1 text-[11px] text-neutral-300">
                <span style={{ color: OKABE.sky }}>▲</span> launcher plumbing
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-neutral-300">
                <span style={{ color: OKABE.orange }}>●</span> runtime
              </span>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(160, 30 * statistics.length + 60)}>
              <ScatterChart margin={{ top: 6, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" dataKey="megabytes" name="resident memory" unit=" MB" {...AXIS} scale={logScale ? "log" : "auto"} domain={logScale ? [LOG_FLOOR_MEGABYTES, "auto"] : [0, "auto"]} allowDataOverflow />
                <YAxis type="category" dataKey="owner" width={190} {...AXIS} interval={0} allowDuplicatedCategory={false} />
                <ZAxis range={[40, 40]} />
                <Tooltip
                  {...TOOLTIP}
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    const point = payload?.[0]?.payload as Point | undefined;
                    if (!point) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="max-w-[320px] space-y-0.5 px-2 py-1 text-[11px]">
                        <div className="font-semibold">{point.processName} · pid {point.processIdentifier}</div>
                        <div>{point.owner}</div>
                        <div>{megabytes(point.megabytes, 1)}</div>
                        <div className="break-all text-neutral-400">{point.commandLine}</div>
                      </div>
                    );
                  }}
                />
                <Scatter name="launcher plumbing" data={plumbing} fill={OKABE.sky} shape="triangle" isAnimationActive={false} />
                <Scatter name="runtime" data={runtime} fill={OKABE.orange} shape="circle" isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
            {heaviest && (
              <Finding>
                The single largest process is in {heaviest.ownerCategory} at {fmt(heaviest.summary.maximum, 1)} MB; that owner&apos;s median is {fmt(heaviest.summary.median, 1)} MB.
              </Finding>
            )}
          </div>

          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-neutral-200">Every numeric column, one panel each</h4>
            <p className="text-[11px] text-neutral-400">Nothing summarised without also being seen. Process identifiers are labels, not measurements, and are left out.</p>
            <ColumnGrid rows={rows} exclude={IDENTIFIER_COLUMNS} title="Columns of the processes shown" />
          </div>
        </div>
      )}
    </Section>
  );
}
