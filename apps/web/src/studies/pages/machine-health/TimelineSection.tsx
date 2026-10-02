/**
 * Every crash, hang, kernel crash and hard reset on one strip (x = Pacific
 * wall-clock time, y = event kind, colour AND marker shape per kind), with the
 * weekly counts stacked by kind below it. Two controls choose what is shown:
 * the day window (range slider) and the kinds (one toggle chip per kind).
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AXIS, Finding, GRID, Section, TOOLTIP, fmtInt, fmtTime } from "@/studies/kit";
import {
  joinList, parseList, styleOf,
  type EventRow, type EventsSection, type WeekCount,
} from "@shared/studies/machine-health";
import { Marker, MarkerIcon } from "./markers";
import { RangeSlider } from "./RangeSlider";

const DAY_MILLISECONDS = 86_400_000;
const WEEK_MILLISECONDS = 7 * DAY_MILLISECONDS;

function dayToMilliseconds(day: string | null): number {
  return day ? Date.parse(`${day}T00:00:00Z`) : 0;
}

function EventTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: EventRow & { x: number } }> }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const fields: Array<[string, string | null]> = [
    ["local time", fmtTime(row.localTime)],
    ["event kind", row.eventKind],
    ["application", row.applicationName],
    ["bugcheck code", row.bugcheckCode],
    ["exception code", row.exceptionCode],
    ["faulting module", row.faultingModuleName],
    ["error report bucket", row.windowsErrorReportingBucket],
    ["dump kept", row.dumpKept ? "yes" : "no"],
  ];
  return (
    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
      {fields.filter(([, value]) => value).map(([name, value]) => (
        <div key={name} className="flex gap-2">
          <span className="text-neutral-400">{name}</span>
          <span className="break-all font-mono text-neutral-100">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** Weeks from the first to the last week present, each with a count per kind (an empty week is a zero, not a gap). */
export function weeklySeries(weeks: readonly WeekCount[], kinds: readonly string[]): Array<Record<string, number | string>> {
  if (weeks.length === 0) return [];
  const starts = weeks.map((week) => week.weekStart);
  const first = Math.min(...starts);
  const last = Math.max(...starts);
  const byWeek = new Map<number, Map<string, number>>();
  for (const week of weeks) {
    const entry = byWeek.get(week.weekStart) ?? new Map<string, number>();
    entry.set(week.eventKind, week.eventCount);
    byWeek.set(week.weekStart, entry);
  }
  const out: Array<Record<string, number | string>> = [];
  for (let start = first; start <= last; start += WEEK_MILLISECONDS) {
    const row: Record<string, number | string> = { week: new Date(start).toISOString().slice(0, 10) };
    for (const kind of kinds) row[kind] = byWeek.get(start)?.get(kind) ?? 0;
    out.push(row);
  }
  return out;
}

export function TimelineSection({
  events, dayStart, dayEnd, hiddenKinds, onWindow, onHiddenKinds,
}: {
  events: EventsSection;
  dayStart: number;
  /** -1 is the last day. */
  dayEnd: number;
  hiddenKinds: string;
  onWindow: (start: number, end: number) => void;
  onHiddenKinds: (value: string) => void;
}) {
  const hidden = parseList(hiddenKinds);
  const visibleKinds = events.kinds.map((kind) => kind.eventKind).filter((kind) => !hidden.includes(kind));
  const end = dayEnd < 0 ? events.totalDays : dayEnd;
  const firstMilliseconds = dayToMilliseconds(events.firstDay);
  const indexOfKind = new Map(visibleKinds.map((kind, index) => [kind, index]));

  const toggle = (kind: string) => {
    const next = hidden.includes(kind) ? hidden.filter((item) => item !== kind) : [...hidden, kind];
    onHiddenKinds(joinList(next));
  };

  const weeks = weeklySeries(events.weeks, visibleKinds);

  return (
    <Section title="Every crash, hang, kernel crash and hard reset" question="When did each event happen, and of what kind? Pacific wall-clock time.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2">
          <RangeSlider
            label={`Days since ${events.firstDay ?? "the first event"}`}
            value={[Math.min(dayStart, events.totalDays), Math.min(end, events.totalDays)]}
            min={0}
            max={Math.max(1, events.totalDays)}
            onCommit={([start, stop]) => onWindow(start, stop >= events.totalDays ? -1 : stop)}
            hint="Drag either end to choose the window"
          />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-[10px] uppercase tracking-wider text-neutral-500">Event kinds shown (click to hide or show)</legend>
          <div className="flex flex-wrap gap-1.5">
            {events.kinds.map((kind) => {
              const style = styleOf(kind.eventKind);
              const shown = !hidden.includes(kind.eventKind);
              return (
                <button
                  key={kind.eventKind}
                  type="button"
                  aria-pressed={shown}
                  onClick={() => toggle(kind.eventKind)}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${shown ? "border-neutral-500 bg-neutral-800 text-neutral-100" : "border-neutral-800 text-neutral-500 line-through"}`}
                >
                  <MarkerIcon shape={style.shape} color={style.color} size={4} />
                  {kind.eventKind}
                  <span className="font-mono text-neutral-400">{fmtInt(kind.eventCount)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <Finding>
          {fmtInt(events.selectedCount)} of {fmtInt(events.totalEventCount)} events are inside the window and the picked kinds
          {events.rowsCapped ? `; the strip draws the first ${fmtInt(events.rows.length)}, the weekly bars count them all` : ""}.
        </Finding>

        {visibleKinds.length === 0 || events.selectedCount === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">No event inside this window and selection.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={Math.max(180, 42 * visibleKinds.length + 50)}>
              <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid {...GRID} />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="local time"
                  domain={[firstMilliseconds + dayStart * DAY_MILLISECONDS, firstMilliseconds + (end + 1) * DAY_MILLISECONDS]}
                  tickFormatter={(value: number) => new Date(value).toISOString().slice(0, 10)}
                  {...AXIS}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  domain={[-0.5, visibleKinds.length - 0.5]}
                  ticks={visibleKinds.map((_, index) => index)}
                  tickFormatter={(value: number) => visibleKinds[value] ?? ""}
                  width={190}
                  interval={0}
                  {...AXIS}
                />
                <ZAxis range={[60, 60]} />
                <Tooltip content={<EventTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                {visibleKinds.map((kind) => {
                  const style = styleOf(kind);
                  const data = events.rows
                    .filter((row) => row.eventKind === kind)
                    .map((row) => ({ ...row, x: row.localTime, y: indexOfKind.get(kind) ?? 0 }));
                  return (
                    <Scatter
                      key={kind}
                      name={kind}
                      data={data}
                      isAnimationActive={false}
                      shape={(props: { cx?: number; cy?: number }) => (
                        <Marker shape={style.shape} color={style.color} cx={props.cx ?? 0} cy={props.cy ?? 0} size={4.5} />
                      )}
                    />
                  );
                })}
              </ScatterChart>
            </ResponsiveContainer>

            <div className="text-[11px] font-medium text-neutral-300">Events per week (weeks start on Sunday), stacked by kind</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weeks} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="week" minTickGap={28} {...AXIS} />
                <YAxis allowDecimals={false} width={40} {...AXIS} />
                <Tooltip {...TOOLTIP} />
                {visibleKinds.map((kind) => (
                  <Bar key={kind} dataKey={kind} stackId="events" fill={styleOf(kind).color} stroke="#e5e5e5" strokeWidth={0.4} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </Section>
  );
}
