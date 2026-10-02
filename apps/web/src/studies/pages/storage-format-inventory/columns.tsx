/**
 * Every column of the inventory table as its own graphic, each with its
 * numbers: file_bytes and file_gibibytes (log10 histograms), modified_timestamp
 * (files per month), the five label columns (their commonest values), and the
 * path (graphed by depth, since every path is unique). The panels follow the
 * page's controls; the bins slider re-bins the numeric ones.
 */

import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ControlBar, OKABE, SegmentControl, SliderControl, SwitchControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import type { ColumnProfile } from "@shared/studies/storage-format-inventory";
import { PARQUET_COLOR, NOT_PARQUET_COLOR, familyColor, familyGlyph, formatBytes } from "./formats";

type Kind = "all" | "label" | "number" | "time";

function compact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return Math.round(value).toLocaleString("en-US");
  if (magnitude >= 1) return fmt(value, 3);
  if (magnitude === 0) return "0";
  return value.toPrecision(3);
}

const SUMMARY_KEYS = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "standard deviation"], ["skewness", "skewness"],
  ["kurtosis", "kurtosis"], ["percentile25", "25th percentile"], ["percentile75", "75th percentile"], ["minimum", "minimum"], ["maximum", "maximum"],
] as const;

function PanelFrame({ profile, children }: { profile: ColumnProfile; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="truncate font-mono text-[11px] font-medium text-neutral-100" title={profile.column}>
        {profile.column}
      </div>
      <p className="mb-1 text-[10px] leading-snug text-neutral-500">{profile.description}</p>
      {children}
      <p className="mt-1 text-[10px] text-neutral-500">
        {fmtInt(profile.nonNullCount)} values{profile.nullCount > 0 ? ` · ${fmtInt(profile.nullCount)} empty` : ""}
        {profile.kind === "categorical" ? ` · ${fmtInt(profile.distinctCount)} distinct` : ""}
      </p>
    </div>
  );
}

function NumberGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="mt-1 grid grid-cols-1 gap-x-3 text-[10px] font-mono tnum">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-1">
          <dt className="text-neutral-500">{label}</dt>
          <dd className="truncate text-neutral-200" title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MiniBars({ data, logCounts, rangeLabel, color }: { data: Array<{ key: string; count: number; label: string }>; logCounts: boolean; rangeLabel: (key: string) => string; color: string }) {
  const shaped = data.map((row) => ({ ...row, shown: logCounts ? Math.log10(row.count + 1) : row.count }));
  return (
    <ResponsiveContainer width="100%" height={92}>
      <BarChart data={shaped} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
        <XAxis dataKey="key" hide />
        <YAxis hide />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
          content={({ payload }) => {
            const row = payload?.[0]?.payload as { key: string; count: number; label: string } | undefined;
            if (!row) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="px-2 py-1 text-[11px]">
                <div className="font-semibold">{rangeLabel(row.key)}</div>
                <div>{fmtInt(row.count)} files</div>
              </div>
            );
          }}
        />
        <Bar dataKey="shown" fill={color} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function NumericPanel({ profile, logCounts }: { profile: Extract<ColumnProfile, { kind: "numeric" }>; logCounts: boolean }) {
  const { summary } = profile;
  const edge = (value: number) => {
    const real = profile.logScaled ? 10 ** value : value;
    if (profile.unit === "bytes") return formatBytes(real);
    if (profile.unit === "GiB") return formatBytes(real * 1024 ** 3);
    return compact(real);
  };
  const byKey = new Map(profile.bins.map((bin) => [String(bin.lower), bin]));
  const show = (value: number | null) => {
    if (value === null) return "—";
    if (profile.unit === "bytes") return formatBytes(value);
    if (profile.unit === "GiB") return formatBytes(value * 1024 ** 3);
    return compact(value);
  };
  return (
    <PanelFrame profile={profile}>
      <MiniBars
        data={profile.bins.map((bin) => ({ key: String(bin.lower), count: bin.count, label: "" }))}
        logCounts={logCounts}
        color={OKABE.sky}
        rangeLabel={(key) => {
          const bin = byKey.get(key);
          if (!bin) return "";
          return profile.unit === "segments" ? `${compact(bin.lower)}${bin.upper - bin.lower === 1 ? "" : ` to ${compact(bin.upper)}`} segments` : `${edge(bin.lower)} to ${edge(bin.upper)}`;
        }}
      />
      <p className="text-[10px] text-neutral-500">{profile.logScaled ? `histogram on log10 of ${profile.unit}` : `histogram in ${profile.unit}`}</p>
      <NumberGrid rows={[["count", fmtInt(summary.count)], ...SUMMARY_KEYS.map(([key, label]): [string, string] => [label, key === "skewness" || key === "kurtosis" ? fmt(summary[key], 2) : show(summary[key])])]} />
    </PanelFrame>
  );
}

function TimestampPanel({ profile, logCounts }: { profile: Extract<ColumnProfile, { kind: "timestamp" }>; logCounts: boolean }) {
  const { summary, dates } = profile;
  return (
    <PanelFrame profile={profile}>
      <MiniBars data={profile.months.map((month) => ({ key: month.value, count: month.count, label: month.value }))} logCounts={logCounts} color={OKABE.sky} rangeLabel={(key) => key} />
      <p className="text-[10px] text-neutral-500">files per calendar month</p>
      <NumberGrid
        rows={[
          ["count", fmtInt(summary.count)],
          ["mean", dates.mean ?? "—"],
          ["median", dates.median ?? "—"],
          ["standard deviation (days)", compact(summary.standardDeviation)],
          ["skewness", fmt(summary.skewness, 2)],
          ["kurtosis", fmt(summary.kurtosis, 2)],
          ["25th percentile", dates.percentile25 ?? "—"],
          ["75th percentile", dates.percentile75 ?? "—"],
          ["minimum", dates.minimum ?? "—"],
          ["maximum", dates.maximum ?? "—"],
        ]}
      />
    </PanelFrame>
  );
}

function CategoricalPanel({ profile, logCounts }: { profile: Extract<ColumnProfile, { kind: "categorical" }>; logCounts: boolean }) {
  const shown = profile.top.slice(0, 8);
  const scale = (count: number) => (logCounts ? Math.log10(count + 1) : count);
  const largest = Math.max(1, ...shown.map((row) => scale(row.count)));
  const colorOf = (value: string): string => {
    if (profile.column === "format_family") return familyColor(value);
    if (profile.column === "is_parquet") return value === "true" ? PARQUET_COLOR : value === "false" ? NOT_PARQUET_COLOR : OKABE.grey;
    return OKABE.sky;
  };
  const glyphOf = (value: string): string => {
    if (profile.column === "format_family") return familyGlyph(value);
    if (profile.column === "is_parquet") return value === "true" ? "●" : value === "false" ? "▨" : "?";
    return "";
  };
  const hidden = profile.distinctCount - shown.filter((row) => row.value !== "unknown").length;
  return (
    <PanelFrame profile={profile}>
      <ul className="space-y-0.5">
        {shown.map((row) => (
          <li key={row.value} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[10px]" title={`${row.value}: ${fmtInt(row.count)} files`}>
            <span className="truncate text-neutral-300">
              {glyphOf(row.value) && <span aria-hidden="true" style={{ color: colorOf(row.value) }}>{glyphOf(row.value)} </span>}
              {row.value.length > 22 ? `…${row.value.slice(-21)}` : row.value}
            </span>
            <span className="h-2 rounded-sm bg-neutral-900">
              <span className="block h-2 rounded-sm" style={{ width: `${(scale(row.count) / largest) * 100}%`, background: colorOf(row.value) }} />
            </span>
            <span className="font-mono tnum text-neutral-200">{fmtInt(row.count)}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="mt-1 text-[10px] text-neutral-500">{fmtInt(hidden)} more distinct values not shown</p>}
    </PanelFrame>
  );
}

const KIND_OF: Record<ColumnProfile["kind"], Exclude<Kind, "all">> = { categorical: "label", numeric: "number", timestamp: "time" };

export function ColumnPanels({ profiles, bins, onBinsChange }: { profiles: ColumnProfile[]; bins: number; onBinsChange: (bins: number) => void }) {
  const [logCounts, setLogCounts] = useState(false);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const visible = profiles.filter((profile) => profile.column.toLowerCase().includes(filter.toLowerCase()) && (kind === "all" || KIND_OF[profile.kind] === kind));
  return (
    <div className="space-y-2">
      <ControlBar>
        <SliderControl label="Bins" value={bins} min={5} max={100} onChange={onBinsChange} hint="Bins of the numeric panels (re-queries the lake)" />
        <SwitchControl label="Log counts" checked={logCounts} onChange={setLogCounts} hint="log10(count + 1) on every panel" />
        <SegmentControl label="Show" value={kind} options={[{ value: "all", label: "all" }, { value: "label", label: "labels" }, { value: "number", label: "numbers" }, { value: "time", label: "time" }]} onChange={setKind} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Filter</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="column name" className="h-7 w-40 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" />
        </label>
      </ControlBar>
      {visible.length === 0 ? (
        <p className="text-xs text-neutral-500">No column matches.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
          {visible.map((profile) =>
            profile.kind === "numeric" ? (
              <NumericPanel key={profile.column} profile={profile} logCounts={logCounts} />
            ) : profile.kind === "timestamp" ? (
              <TimestampPanel key={profile.column} profile={profile} logCounts={logCounts} />
            ) : (
              <CategoricalPanel key={profile.column} profile={profile} logCounts={logCounts} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
