/** Tab 3: the quarterly cycle, CME's roll date, and when the lake's volume actually rolled. */

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Empty, Finding, GRID, OKABE, Section, SelectControl, SliderControl, Stat, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import {
  LAKE_ROOTS, SPECIFICATION_SOURCE, compareRolls, quarterlyExpiries,
  type ExpiryRow, type FrontDay, type ObservedRoll, type RollComparisonRow, type RollsBody, type RootCoverage,
} from "@shared/studies/contract-specifications";
import { SortableTable, type Column } from "./parts";
import type { Controls, SetControl } from "./controls";

const CONTRACT_COLORS = [OKABE.blue, OKABE.orange, OKABE.sky, OKABE.vermillion, OKABE.green, OKABE.purple, OKABE.yellow, "#e5e5e5"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayOfYear(iso: string, year: number): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(year, 0, 1)) / 86_400_000);
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

const WIDTH = 900;
const HEIGHT = 150;
const PAD = 14;

/** One year: the front contract per day, expiries, CME roll dates and the lake's volume rolls, every mark with a hover title. */
function RollTimeline({ year, root, frontByDay, expiries, observed }: { year: number; root: string; frontByDay: readonly FrontDay[]; expiries: readonly ExpiryRow[]; observed: readonly ObservedRoll[] }) {
  const total = daysInYear(year);
  const span = WIDTH - 2 * PAD;
  const xOf = (iso: string) => PAD + (dayOfYear(iso, year) / total) * span;
  const dayWidth = Math.max(1.5, span / total);

  const contractOrder: string[] = [];
  for (const day of frontByDay) if (!contractOrder.includes(day.front_contract)) contractOrder.push(day.front_contract);
  const colorOf = (contract: string) => CONTRACT_COLORS[contractOrder.indexOf(contract) % CONTRACT_COLORS.length] ?? OKABE.grey;

  // First day of each run of the same front contract, to label it on the strip.
  const runStarts: FrontDay[] = [];
  frontByDay.forEach((day, index) => {
    if (index === 0 || frontByDay[index - 1]?.front_contract !== day.front_contract) runStarts.push(day);
  });

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label={`${root} ${year}: front contract by day, expiries, CME roll dates and the lake's observed volume rolls`}>
      {MONTH_LABELS.map((label, month) => {
        const x = PAD + (Math.round((Date.UTC(year, month, 1) - Date.UTC(year, 0, 1)) / 86_400_000) / total) * span;
        return (
          <g key={label}>
            <line x1={x} x2={x} y1={18} y2={108} stroke="#404040" strokeWidth={0.5} />
            <text x={x + 3} y={12} fontSize={9} fill="#a3a3a3">{label}</text>
          </g>
        );
      })}
      {frontByDay.map((day) => (
        <rect key={day.day} x={xOf(day.day)} y={50} width={dayWidth} height={30} fill={colorOf(day.front_contract)}>
          <title>{`${day.day}: front contract ${day.front_contract} (most volume that day)`}</title>
        </rect>
      ))}
      {expiries.map((expiry) => (
        <g key={`expiry-${expiry.month_code}`}>
          <line x1={xOf(expiry.third_friday_expiry)} x2={xOf(expiry.third_friday_expiry)} y1={22} y2={108} stroke="#e5e5e5" strokeWidth={1.5} strokeDasharray="6 3">
            <title>{`${expiry.month_code} (${expiry.month_name}): third Friday, expiry ${expiry.third_friday_expiry}`}</title>
          </line>
          <text x={xOf(expiry.third_friday_expiry) + 3} y={104} fontSize={9} fill="#e5e5e5">{`${expiry.month_code} expiry`}</text>
        </g>
      ))}
      {expiries.map((expiry) => (
        <line key={`roll-${expiry.month_code}`} x1={xOf(expiry.cme_roll_date)} x2={xOf(expiry.cme_roll_date)} y1={22} y2={108} stroke={OKABE.sky} strokeWidth={1.5}>
          <title>{`CME roll date ${expiry.cme_roll_date} (the Monday before the third Friday)`}</title>
        </line>
      ))}
      {observed.map((roll) => {
        const x = xOf(roll.roll_day);
        return (
          <path key={roll.roll_day} d={`M ${x - 7} 24 L ${x + 7} 24 L ${x} 40 Z`} fill={OKABE.vermillion} stroke="#0a0a0a" strokeWidth={0.5}>
            <title>{`Volume moved on ${roll.roll_day}: ${roll.previous_contract} to ${roll.front_contract} (${fmtInt(roll.front_contract_volume)} contracts that day)`}</title>
          </path>
        );
      })}
      {runStarts.map((day) => (
        <text key={`label-${day.day}`} x={xOf(day.day) + 2} y={94} fontSize={9} fill={colorOf(day.front_contract)}>{day.front_contract}</text>
      ))}
      <g fontSize={9} fill="#d4d4d4">
        <line x1={PAD} x2={PAD + 22} y1={132} y2={132} stroke="#e5e5e5" strokeWidth={1.5} strokeDasharray="6 3" />
        <text x={PAD + 28} y={135}>third-Friday expiry</text>
        <line x1={PAD + 140} x2={PAD + 162} y1={132} y2={132} stroke={OKABE.sky} strokeWidth={1.5} />
        <text x={PAD + 168} y={135}>CME roll date (Monday before)</text>
        <path d={`M ${PAD + 340} 127 L ${PAD + 352} 127 L ${PAD + 346} 138 Z`} fill={OKABE.vermillion} />
        <text x={PAD + 358} y={135}>lake's observed volume roll (▼)</text>
        <text x={PAD + 540} y={135}>strip colour and label: front contract, the one with most volume that day</text>
      </g>
    </svg>
  );
}

const COMPARISON_COLUMNS: Array<Column<RollComparisonRow>> = [
  { key: "month_code", label: "month code", title: "month_code", value: (row) => row.month_code },
  { key: "month_name", label: "month", title: "month", value: (row) => row.month_name },
  { key: "third_friday_expiry", label: "third Friday (expiry)", title: "third_friday_expiry", value: (row) => row.third_friday_expiry },
  { key: "cme_roll_date", label: "CME roll date", title: "cme_roll_date", value: (row) => row.cme_roll_date },
  { key: "lake_observed_roll_day", label: "lake observed roll day", title: "lake_observed_roll_day", value: (row) => row.lake_observed_roll_day ?? "no bars" },
  { key: "days_before_expiry", label: "days before expiry", title: "days_before_expiry", numeric: true, value: (row) => row.days_before_expiry },
  { key: "from_contract", label: "from contract", title: "from_contract", value: (row) => row.from_contract },
  { key: "to_contract", label: "to contract", title: "to_contract", value: (row) => row.to_contract },
];

export function RollsTab({ rolls, coverage, controls, set }: { rolls: RollsBody | undefined; coverage: readonly RootCoverage[]; controls: Controls; set: SetControl }) {
  const year = controls.rollYear;
  const expiries = quarterlyExpiries(year);
  const comparison = rolls ? compareRolls(expiries, rolls.observedRolls) : [];
  const thisCoverage = coverage.find((row) => row.root === controls.rollRoot);
  const matched = comparison.filter((row) => row.lake_observed_roll_day !== null);
  const meanDaysBefore = matched.length > 0 ? matched.reduce((sum, row) => sum + (row.days_before_expiry ?? 0), 0) / matched.length : null;
  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-3">
      <Section
        title="Months: the quarterly cycle, and when the lake's volume actually rolled"
        question="Stock-index futures list on the H, M, U, Z cycle and stop trading on the third Friday. CME's roll date is the Monday before; the lake shows the first day the next contract out-traded the expiring one, from daily per-contract bars."
      >
        <ControlBar>
          <SelectControl label="Root" value={controls.rollRoot} options={LAKE_ROOTS.map((root) => ({ value: root, label: root }))} onChange={(value) => set("rollRoot", value)} />
          <SliderControl label="Year" value={year} min={2016} max={currentYear + 1} onChange={(value) => set("rollYear", value)} />
        </ControlBar>

        <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Stat label={`Rolls in ${year}`} value={rolls ? fmtInt(rolls.observedRolls.length) : "—"} hint="Days the daily-volume leader changed" />
          <Stat label="Mean days before expiry" value={meanDaysBefore === null ? "—" : fmt(meanDaysBefore, 1)} hint="Over the quarters with a matching roll" />
          <Stat label={`${controls.rollRoot} first day`} value={thisCoverage?.first_day ?? "—"} hint="First daily bar of an outright contract" />
          <Stat label={`${controls.rollRoot} last day`} value={thisCoverage?.last_day ?? "—"} hint="Last daily bar of an outright contract" />
        </div>

        {!rolls || rolls.frontByDay.length === 0 ? (
          <Empty>The lake has no daily bars for {controls.rollRoot} in {year}.</Empty>
        ) : (
          <div className="mt-2 min-w-0 rounded border border-neutral-800 bg-neutral-950/60 p-2">
            <RollTimeline year={year} root={controls.rollRoot} frontByDay={rolls.frontByDay} expiries={expiries} observed={rolls.observedRolls} />
          </div>
        )}

        <div className="mt-2">
          <Finding>
            Rolls the lake recorded for {controls.rollRoot} in {year}: {rolls ? rolls.observedRolls.length : "—"}. A quarterly contract gives four a year; more means the volume leader flipped back and forth around a roll, fewer means missing days.
            {thisCoverage && ` The lake's ${controls.rollRoot} daily bars run ${thisCoverage.first_day} to ${thisCoverage.last_day} (${fmtInt(thisCoverage.day_count)} days).`}
          </Finding>
        </div>
      </Section>

      <Section title="Expiry, CME roll date and the lake's roll, quarter by quarter" question={SPECIFICATION_SOURCE.cmeRollRule}>
        <SortableTable rows={comparison} columns={COMPARISON_COLUMNS} rowKey={(row) => row.month_code} maxHeight={260} />
      </Section>

      <Section title="Rolls per year" question={`${controls.rollRoot}: four a year is the quarterly cycle; the first year starts mid-cycle and the last ends mid-cycle.`}>
        {!rolls || rolls.rollCountByYear.length === 0 ? (
          <Empty>No rolls recorded for {controls.rollRoot}.</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rolls.rollCountByYear} margin={{ top: 8, right: 14, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="year" {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip {...TOOLTIP} formatter={(value) => [fmtInt(Number(value)), "rolls"]} />
              <ReferenceLine y={4} stroke={OKABE.sky} strokeDasharray="4 3" label={{ value: "4 a year", fill: OKABE.sky, fontSize: 10, position: "insideTopRight" }} />
              <Bar dataKey="roll_count" name="rolls" fill={OKABE.blue} stroke="#e5e5e5" strokeWidth={0.5} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Section>
    </div>
  );
}
