/**
 * Which programs crash, and whether a dump was kept. One horizontal bar per
 * application, four segments: crash or hang (solid or striped) by dump kept
 * (orange) or not (blue). Stripes carry the hang kind so it never rests on
 * opacity alone.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, GRID, OKABE, Section, SliderControl, TOOLTIP, fmtInt, fmtPercent } from "@/studies/kit";
import type { CoverageSection as CoverageBody } from "@shared/studies/machine-health";

interface ApplicationRow {
  applicationName: string;
  crashWithDump: number;
  crashWithoutDump: number;
  hangWithDump: number;
  hangWithoutDump: number;
}

function perApplication(rows: CoverageBody["rows"], limit: number): ApplicationRow[] {
  const order: string[] = [];
  const byName = new Map<string, ApplicationRow>();
  for (const row of rows) {
    let entry = byName.get(row.applicationName);
    if (!entry) {
      entry = { applicationName: row.applicationName, crashWithDump: 0, crashWithoutDump: 0, hangWithDump: 0, hangWithoutDump: 0 };
      byName.set(row.applicationName, entry);
      order.push(row.applicationName);
    }
    if (row.eventKind === "application_hang") {
      entry.hangWithDump += row.eventsWithDump;
      entry.hangWithoutDump += row.eventsWithoutDump;
    } else {
      entry.crashWithDump += row.eventsWithDump;
      entry.crashWithoutDump += row.eventsWithoutDump;
    }
  }
  return order.slice(0, limit).map((name) => byName.get(name) as ApplicationRow);
}

const SERIES = [
  { key: "crashWithDump", name: "crash, dump kept", color: OKABE.orange, striped: false },
  { key: "crashWithoutDump", name: "crash, no dump", color: OKABE.blue, striped: false },
  { key: "hangWithDump", name: "hang, dump kept", color: OKABE.orange, striped: true },
  { key: "hangWithoutDump", name: "hang, no dump", color: OKABE.blue, striped: true },
] as const;

export function CoverageSection({ coverage, applicationCount, onApplicationCount }: { coverage: CoverageBody; applicationCount: number; onApplicationCount: (value: number) => void }) {
  const applications = perApplication(coverage.rows, applicationCount);
  const events = coverage.rows.reduce((sum, row) => sum + row.eventCount, 0);
  const withDump = coverage.rows.reduce((sum, row) => sum + row.eventsWithDump, 0);
  const top = applications[0];

  return (
    <Section title="Which programs crash, and whether a dump was kept" question="Application crash and hang events per program, split by whether a dump file exists for the event.">
      <div className="space-y-3">
        <ControlBar>
          <SliderControl label="Applications shown" value={applicationCount} min={5} max={40} onChange={onApplicationCount} />
        </ControlBar>
        <Finding>
          {fmtInt(events)} crash and hang events across {fmtInt(coverage.applicationCount)} programs; a dump was kept for {fmtInt(withDump)} of them ({fmtPercent(events ? withDump / events : null)}).
          {top && ` ${top.applicationName} leads with ${fmtInt(top.crashWithDump + top.crashWithoutDump + top.hangWithDump + top.hangWithoutDump)}.`}
        </Finding>
        {applications.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">No application crash or hang events.</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-300">
              {SERIES.map((series) => (
                <li key={series.key} className="flex items-center gap-1.5">
                  <svg width="14" height="14" aria-hidden="true">
                    <rect width="14" height="14" fill={series.color} />
                    {series.striped && <rect width="14" height="14" fill="url(#machine-health-stripe)" />}
                  </svg>
                  {series.name}
                </li>
              ))}
            </ul>
            <ResponsiveContainer width="100%" height={24 * applications.length + 50}>
              <BarChart data={applications} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <defs>
                  {SERIES.filter((series) => series.striped).map((series) => (
                    <pattern key={series.key} id={`machine-health-${series.key}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="6" height="6" fill={series.color} />
                      <rect width="2.5" height="6" fill="#0a0a0a" fillOpacity="0.55" />
                    </pattern>
                  ))}
                  <pattern id="machine-health-stripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="2.5" height="6" fill="#0a0a0a" fillOpacity="0.55" />
                  </pattern>
                </defs>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...AXIS} />
                <YAxis type="category" dataKey="applicationName" width={150} interval={0} {...AXIS} />
                <Tooltip {...TOOLTIP} />
                {SERIES.map((series) => (
                  <Bar
                    key={series.key}
                    dataKey={series.key}
                    name={series.name}
                    stackId="coverage"
                    fill={series.striped ? `url(#machine-health-${series.key})` : series.color}
                    stroke="#e5e5e5"
                    strokeWidth={0.4}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </Section>
  );
}
