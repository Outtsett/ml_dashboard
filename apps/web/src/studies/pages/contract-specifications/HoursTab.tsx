/** Tab 4: the Globex schedule seen in the bars. The one stamped hour with no bars is the daily halt. */

import { Bar, BarChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ColumnGrid, ControlBar, Empty, Finding, GRID, OKABE, Section, SegmentControl, SelectControl, Stat, TOOLTIP, fmtInt } from "@/studies/kit";
import { LAKE_ROOTS, barsByHour, type HoursBody, type HoursSeries } from "@shared/studies/contract-specifications";
import type { Controls, SetControl } from "./controls";

const SERIES_OPTIONS: ReadonlyArray<{ value: HoursSeries; label: string }> = [
  { value: "allContracts", label: "every outright contract" },
  { value: "rootSeries", label: "symbol = root (notebook)" },
];

export function HoursTab({ hours, controls, set }: { hours: HoursBody | undefined; controls: Controls; set: SetControl }) {
  const rows = hours ? barsByHour(hours.counts) : [];
  const central = controls.clock === "central";
  const hourLabel = (row: { stamped_hour_pacific: number; hour_central_time: number }) => String(central ? row.hour_central_time : row.stamped_hour_pacific);
  const data = rows.map((row) => ({ ...row, label: hourLabel(row) }));
  const empty = rows.filter((row) => row.no_bars);
  const emptyHours = empty.map((row) => row.stamped_hour_pacific);
  const isHalt = emptyHours.length === 1 && emptyHours[0] === 14;

  return (
    <div className="space-y-3">
      <Section
        title="Hours: the exchange schedule, seen in the bars"
        question="CME Globex equity-index futures trade Sunday 5:00 p.m. to Friday 4:00 p.m. Central with a daily halt from 4:00 to 5:00 p.m. The lake stamps futures bars in Pacific wall-clock time, so the halt is stamped hour 14 and the week opens at stamped 15:00 on Sunday."
      >
        <ControlBar>
          <SelectControl label="Root (1-minute bars)" value={controls.hoursRoot} options={LAKE_ROOTS.map((root) => ({ value: root, label: root }))} onChange={(value) => set("hoursRoot", value)} />
          <SegmentControl label="Bars counted" value={controls.hoursSeries as HoursSeries} options={SERIES_OPTIONS} onChange={(value) => set("hoursSeries", value)} hint="Only MNQ carries a bare-root series (symbol = MNQ); for every root, all its outright contracts are counted." />
          <SegmentControl label="Axis clock" value={controls.clock} options={[{ value: "pacific", label: "stamped (Pacific)" }, { value: "central", label: "Central" }]} onChange={(value) => set("clock", value)} hint="Central = stamped Pacific + 2 hours" />
        </ControlBar>

        <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Stat label="1-minute bars counted" value={hours ? fmtInt(hours.totalBars) : "—"} />
          <Stat label="First bar" value={hours?.firstTimestamp ?? "—"} hint="Stamped Pacific wall clock" />
          <Stat label="Last bar" value={hours?.lastTimestamp ?? "—"} hint="Stamped Pacific wall clock" />
          <Stat label="Stamped hours with no bars" value={hours && hours.counts.length > 0 ? (emptyHours.length > 0 ? emptyHours.join(", ") : "none") : "—"} tone={isHalt ? OKABE.sky : undefined} />
        </div>

        {!hours || hours.counts.length === 0 ? (
          <Empty>No 1-minute bars for this root and series.</Empty>
        ) : (
          <div className="mt-2">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data} margin={{ top: 8, right: 14, left: 8, bottom: 22 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="label" interval={0} {...AXIS} label={{ value: central ? "hour (Central time)" : "stamped hour (Pacific wall-clock, as stored in the lake)", position: "insideBottom", offset: -12, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis {...AXIS} tickFormatter={(value: number) => fmtInt(value)} label={{ value: "1-minute bars in the lake", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                {empty.map((row) => (
                  <ReferenceArea key={row.stamped_hour_pacific} x1={hourLabel(row)} x2={hourLabel(row)} fill={OKABE.vermillion} fillOpacity={0.3} stroke={OKABE.vermillion} strokeDasharray="4 3" label={{ value: "no bars", fill: OKABE.vermillion, fontSize: 10, position: "insideTop" }} />
                ))}
                <Tooltip
                  {...TOOLTIP}
                  content={({ payload }) => {
                    const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                    if (!row) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                        <div>stamped hour (Pacific) {row.stamped_hour_pacific}</div>
                        <div>hour (Central) {row.hour_central_time}</div>
                        <div>1-minute bars {fmtInt(row.one_minute_bar_count)}{row.no_bars ? " · no bars: the halt" : ""}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="one_minute_bar_count" fill={OKABE.blue} stroke="#e5e5e5" strokeWidth={0.5} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-neutral-400"><span style={{ color: OKABE.blue }}>■ bars present</span> · <span style={{ color: OKABE.vermillion }}>▨ dashed band: no bars in that hour</span></p>
            <Finding>
              Empty stamped hours for {hours.root}: [{emptyHours.join(", ")}]
              {isHalt ? " — hour 14 Pacific is 16:00 Central, the daily halt." : " — compare with the CME schedule above."}
            </Finding>
          </div>
        )}
      </Section>

      {rows.length > 0 && hours && hours.counts.length > 0 && (
        <Section title="Every column of the hour frame">
          <ColumnGrid rows={rows.map((row) => ({ stamped_hour_pacific: row.stamped_hour_pacific, one_minute_bar_count: row.one_minute_bar_count, hour_central_time: row.hour_central_time }))} title="Hour columns" />
        </Section>
      )}
    </div>
  );
}
