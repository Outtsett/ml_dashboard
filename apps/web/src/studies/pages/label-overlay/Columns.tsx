/**
 * Every column of the label dataset, each as its own graphic with its numbers.
 *
 *   ColumnProfileGrid  the 32 continuous columns over all 2,340,445 rows: a
 *                      100-bin histogram of the 0.5th to 99.5th percentile
 *                      range (counts beyond it are stated, not drawn) and the
 *                      eight numbers, exact from the lake. Controls re-bin,
 *                      log-scale, sort and filter.
 *   ClassBalance       the 14 class columns: every class with its count and
 *                      share, as a bar and as words.
 *   HorizonBaselines   the direction labels' up-rate and majority class: the
 *                      bar a direction model must clear, per horizon.
 */

import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ControlBar, OKABE, SegmentControl, SwitchControl, TOOLTIP, fmt, fmtInt, fmtPercent } from "@/studies/kit";
import { DIRECTION_HORIZONS, directionColumn, majorityBaseline, rebin, type ColumnClassBalance, type ColumnProfile } from "@shared/studies/label-overlay";

const BIN_CHOICES = [10, 20, 25, 50, 100] as const;

type SortKey = "name" | "skewness" | "kurtosis";

function Profile({ profile, bins, logScale }: { profile: ColumnProfile; bins: number; logScale: boolean }) {
  const counts = rebin(profile.bins, bins);
  const width = (profile.histogramHigh - profile.histogramLow) / counts.length;
  const data = counts.map((count, index) => ({
    middle: profile.histogramLow + (index + 0.5) * width,
    count,
    shown: logScale ? Math.log10(count + 1) : count,
    lower: profile.histogramLow + index * width,
    upper: profile.histogramLow + (index + 1) * width,
  }));
  const numbers: Array<[string, number | null]> = [
    ["mean", profile.mean], ["median", profile.median], ["sd", profile.standardDeviation], ["skew", profile.skewness], ["kurt", profile.kurtosis],
    ["p25", profile.percentile25], ["p75", profile.percentile75], ["min", profile.minimum], ["max", profile.maximum],
  ];
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="truncate text-[11px] font-medium text-neutral-200" title={`${profile.name} (stored as ${profile.stored}): ${profile.meaning}`}>{profile.name}</div>
      <div className="mb-1 truncate text-[10px] text-neutral-500" title={profile.meaning}>{profile.unit} · {profile.meaning}</div>
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="middle" hide />
          <YAxis hide />
          <Tooltip
            {...TOOLTIP}
            formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "rows"]}
            labelFormatter={(_label, payload) => {
              const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return bin ? `${fmt(bin.lower, 5)} to ${fmt(bin.upper, 5)}` : "";
            }}
          />
          <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[10px] font-mono tnum">
        <dt className="col-span-3 text-neutral-500">
          n {fmtInt(profile.count)}
          {profile.belowRange + profile.aboveRange > 0 && ` · beyond the drawn range: ${fmtInt(profile.belowRange)} below, ${fmtInt(profile.aboveRange)} above`}
        </dt>
        {numbers.map(([label, number]) => (
          <div key={label} className="flex justify-between gap-1">
            <span className="text-neutral-500">{label}</span>
            <span className="text-neutral-200">{fmt(number, 3)}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ColumnProfileGrid({ profiles }: { profiles: readonly ColumnProfile[] }) {
  const [bins, setBins] = useState<number>(25);
  const [logScale, setLogScale] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [filter, setFilter] = useState("");
  const shown = profiles
    .filter((profile) => `${profile.name} ${profile.stored}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : Math.abs(b[sort] ?? 0) - Math.abs(a[sort] ?? 0)));
  return (
    <div className="space-y-2">
      <ControlBar>
        <span className="self-center text-xs font-semibold text-neutral-200">Every continuous label column, whole dataset</span>
        <SegmentControl label="Bins" value={bins} options={BIN_CHOICES.map((b) => ({ value: b, label: String(b) }))} onChange={setBins} />
        <SwitchControl label="Log counts" checked={logScale} onChange={setLogScale} />
        <SegmentControl<SortKey> label="Sort by" value={sort} options={[{ value: "name", label: "name" }, { value: "skewness", label: "|skew|" }, { value: "kurtosis", label: "|kurtosis|" }]} onChange={setSort} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Filter</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="column name" className="h-7 w-40 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" />
        </label>
      </ControlBar>
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
        {shown.map((profile) => (
          <Profile key={profile.stored} profile={profile} bins={bins} logScale={logScale} />
        ))}
      </div>
    </div>
  );
}

const VALUE_WORDS: Record<string, Record<string, string>> = {
  tbl_label: { "1": "take-profit first (+1)", "-1": "stop-loss first (-1)", "0": "vertical barrier (0)" },
  swing_label: { "1": "next pivot is a high (+1)", "-1": "next pivot is a low (-1)", "0": "timeout (0)" },
  vol_regime: { "0": "low volatility (0)", "1": "middle volatility (1)", "2": "high volatility (2)" },
  zero_range: { "1": "zero-range bar (1)", "0": "bar has a range (0)" },
  meta_armed: { "1": "rule armed (1)", "0": "not armed (0)" },
  meta_side: { "1": "long (+1)", "-1": "short (-1)", "0": "no side (0)" },
  meta_label: { "1": "take-profit first (1)", "0": "not take-profit first (0)" },
};

function valueWord(stored: string, value: number | null): string {
  if (value === null) return "no label";
  if (stored.startsWith("dir_h")) return value === 1 ? "up (1)" : "down (0)";
  return VALUE_WORDS[stored]?.[String(value)] ?? String(value);
}

const CLASS_COLOURS = [OKABE.blue, OKABE.orange, OKABE.purple, OKABE.sky];

function Balance({ column }: { column: ColumnClassBalance }) {
  const total = column.counts.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="truncate text-[11px] font-medium text-neutral-200" title={`${column.name} (stored as ${column.stored})`}>{column.name}</div>
      <div className="mb-1 truncate text-[10px] text-neutral-500" title={column.meaning}>{column.meaning}</div>
      <ul className="space-y-1">
        {column.counts.map((entry, index) => {
          const share = total > 0 ? entry.count / total : 0;
          return (
            <li key={String(entry.value)} className="text-[10px] font-mono tnum">
              <div className="flex justify-between gap-2 text-neutral-300">
                <span className="truncate font-sans">{valueWord(column.stored, entry.value)}</span>
                <span>{fmtInt(entry.count)} · {fmtPercent(share, 2)}</span>
              </div>
              <div className="h-1.5 w-full rounded bg-neutral-800">
                <div className="h-1.5 rounded" style={{ width: `${Math.max(share * 100, share > 0 ? 0.6 : 0)}%`, backgroundColor: entry.value === null ? "#737373" : (CLASS_COLOURS[index % CLASS_COLOURS.length] as string) }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ClassBalanceGrid({ columns }: { columns: readonly ColumnClassBalance[] }) {
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
      {columns.map((column) => (
        <Balance key={column.stored} column={column} />
      ))}
    </div>
  );
}

export function HorizonBaselines({ columns }: { columns: readonly ColumnClassBalance[] }) {
  const rows = DIRECTION_HORIZONS.map((horizon) => {
    const column = columns.find((entry) => entry.name === directionColumn(horizon));
    return { horizon, ...majorityBaseline(column?.counts ?? []) };
  });
  return (
    <table className="w-full text-[11px] font-mono tnum">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="py-0.5 font-normal">bars ahead</th>
          <th className="py-0.5 text-right font-normal">up rate</th>
          <th className="py-0.5 text-right font-normal">majority class</th>
          <th className="py-0.5 text-right font-normal">accuracy of always guessing it</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.horizon} className="border-t border-neutral-900">
            <td className="py-0.5 text-neutral-200">{row.horizon}</td>
            <td className="py-0.5 text-right text-neutral-200">{fmtPercent(row.upRate, 2)}</td>
            <td className="py-0.5 text-right font-sans" style={{ color: row.majority === "up" ? OKABE.orange : OKABE.blue }}>{row.majority === "up" ? "▲ up" : row.majority === "down" ? "▼ down" : "unknown"}</td>
            <td className="py-0.5 text-right text-neutral-200">{fmtPercent(row.majorityRate, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
