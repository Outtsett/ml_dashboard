/**
 * The five pictures of the storage-format inventory: bytes by a chosen
 * dimension, parquet against the rest per zone, the file-size histogram, bytes
 * written per month, and each family's size range. Families are told apart by
 * colour and by a glyph; the two-class chart adds a hatch so orange is never
 * the only mark of "not parquet".
 */

import { scaleSymlog } from "d3";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Empty, GRID, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import {
  monthRange,
  type BreakdownDimension,
  type BreakdownRow,
  type FamilySummaryRow,
  type SizeHistogram,
  type TimelineCell,
  type ZoneShareRow,
} from "@shared/studies/storage-format-inventory";
import { NOT_PARQUET_COLOR, PARQUET_COLOR, cividis, familyColor, familyGlyph, familyLabel, formatBytes, orderedFamilies } from "./formats";

const MEBIBYTE = 1024 * 1024;

export function FamilyLegend({ families }: { families: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-300">
      {families.map((family) => (
        <li key={family} className="flex items-center gap-1">
          <span aria-hidden="true" style={{ color: familyColor(family) }}>
            {familyGlyph(family)}
          </span>
          {familyLabel(family)}
        </li>
      ))}
    </ul>
  );
}

function TipBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
      <div className="font-semibold">{title}</div>
      {children}
    </div>
  );
}

// ---- A. bytes by a chosen dimension ---------------------------------------------------------

const LOG_TICKS = [0, 0.1, 1, 10, 100, 1000];

function dimensionTick(dimension: BreakdownDimension) {
  return function Tick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
    const value = payload?.value ?? "";
    const shown = value.length > 28 ? `…${value.slice(-27)}` : value;
    return (
      <text x={x} y={y} dy={3} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">
        {dimension === "format_family" && (
          <tspan fill={familyColor(value)}>{familyGlyph(value)} </tspan>
        )}
        {dimension === "format_family" ? familyLabel(shown) : shown}
      </text>
    );
  };
}

export function BreakdownChart({ rows, dimension, logarithmic, totalBytes }: { rows: BreakdownRow[]; dimension: BreakdownDimension; logarithmic: boolean; totalBytes: number }) {
  if (rows.length === 0) return <Empty>No files match the controls.</Empty>;
  const maximum = Math.max(...rows.map((row) => row.gibibytes));
  const ticks = logarithmic ? LOG_TICKS.filter((tick) => tick <= maximum * 1.5 || tick === 0) : undefined;
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 22 + 36)}>
      <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 56, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis
          type="number"
          scale={logarithmic ? scaleSymlog() : "linear"}
          domain={[0, "auto"]}
          ticks={ticks}
          tickFormatter={(value: number) => fmt(value, value < 1 && value > 0 ? 2 : 0)}
          {...AXIS}
          label={{ value: logarithmic ? "gibibytes (symlog axis)" : "gibibytes", position: "insideBottomRight", offset: -2, fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
        />
        <YAxis type="category" dataKey="value" width={170} interval={0} tick={dimensionTick(dimension)} tickLine={false} />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
          content={({ payload }) => {
            const row = payload?.[0]?.payload as BreakdownRow | undefined;
            if (!row) return null;
            return (
              <TipBox title={row.value}>
                <div>{fmt(row.gibibytes, 3)} GiB ({formatBytes(row.totalBytes)})</div>
                <div>{fmtInt(row.fileCount)} files</div>
                <div>{totalBytes > 0 ? fmt((100 * row.totalBytes) / totalBytes, 2) : "—"}% of the bytes shown</div>
              </TipBox>
            );
          }}
        />
        <Bar dataKey="gibibytes" isAnimationActive={false}>
          {rows.map((row, index) => (
            <Cell key={row.value} fill={dimension === "format_family" ? familyColor(row.value) : cividis(1 - index / Math.max(1, rows.length - 1))} />
          ))}
          <LabelList dataKey="gibibytes" position="right" formatter={(value: number) => (value >= 0.01 ? fmt(value, 2) : value.toExponential(1))} fill="hsl(var(--foreground))" fontSize={10} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---- B. parquet against everything else, per zone -------------------------------------------

export function ZoneShareChart({ rows }: { rows: ZoneShareRow[] }) {
  if (rows.length === 0) return <Empty>No files match the controls.</Empty>;
  return (
    <div className="space-y-1">
      <ul className="flex gap-4 text-[10px] text-neutral-300">
        <li className="flex items-center gap-1"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PARQUET_COLOR }} /> ● parquet</li>
        <li className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `repeating-linear-gradient(45deg, ${NOT_PARQUET_COLOR} 0 2px, #171717 2px 4px)` }} /> ▨ not parquet (hatched)
        </li>
      </ul>
      <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 20 + 40)}>
        <BarChart layout="vertical" data={rows} stackOffset="expand" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap={3}>
          <defs>
            <pattern id="storage-not-parquet-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={NOT_PARQUET_COLOR} />
              <rect width="2" height="6" fill="#171717" />
            </pattern>
          </defs>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" domain={[0, 1]} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} {...AXIS} />
          <YAxis
            type="category"
            dataKey="zone_name"
            width={190}
            interval={0}
            tickFormatter={(value: string) => (value.length > 30 ? `…${value.slice(-29)}` : value)}
            {...AXIS}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as ZoneShareRow | undefined;
              if (!row) return null;
              const total = row.parquetBytes + row.notParquetBytes;
              return (
                <TipBox title={row.zone_name}>
                  <div>● parquet {fmt(row.parquetBytes / 1024 ** 3, 3)} GiB ({total > 0 ? fmt((100 * row.parquetBytes) / total, 1) : "—"}%)</div>
                  <div>▨ not parquet {fmt(row.notParquetBytes / 1024 ** 3, 3)} GiB ({total > 0 ? fmt((100 * row.notParquetBytes) / total, 1) : "—"}%)</div>
                  <div>{fmtInt(row.fileCount)} files</div>
                </TipBox>
              );
            }}
          />
          <Bar dataKey="parquetBytes" stackId="zone" fill={PARQUET_COLOR} isAnimationActive={false} />
          <Bar dataKey="notParquetBytes" stackId="zone" fill="url(#storage-not-parquet-hatch)" stroke={NOT_PARQUET_COLOR} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- C. the file-size distribution ----------------------------------------------------------

export function SizeHistogramChart({ histogram, families }: { histogram: SizeHistogram; families: string[] }) {
  if (histogram.cells.length === 0) return <Empty>No files above zero bytes match the controls.</Empty>;
  const { lowerLog10, binWidthLog10, binCount } = histogram;
  const data = Array.from({ length: binCount }, (_, index) => {
    const row: Record<string, number> = { middle: lowerLog10 + (index + 0.5) * binWidthLog10, lower: lowerLog10 + index * binWidthLog10, upper: lowerLog10 + (index + 1) * binWidthLog10 };
    for (const family of families) row[family] = 0;
    return row;
  });
  for (const cell of histogram.cells) {
    const row = data[cell.binIndex];
    if (row) row[cell.format_family] = (row[cell.format_family] ?? 0) + cell.fileCount;
  }
  const upperLog10 = lowerLog10 + binCount * binWidthLog10;
  const ticks: number[] = [];
  for (let power = Math.ceil(lowerLog10); power <= Math.floor(upperLog10); power += 1) ticks.push(power);
  return (
    <div className="space-y-1">
      <FamilyLegend families={families} />
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 14 }} barCategoryGap={1}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis
            dataKey="middle"
            type="number"
            domain={[lowerLog10, upperLog10]}
            ticks={ticks}
            tickFormatter={(value: number) => formatBytes(10 ** value)}
            {...AXIS}
            label={{ value: "file size (log10 axis)", position: "insideBottom", offset: -8, fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
          />
          <YAxis {...AXIS} width={44} label={{ value: "files", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as Record<string, number> | undefined;
              if (!row) return null;
              const present = families.filter((family) => (row[family] ?? 0) > 0).sort((a, b) => (row[b] ?? 0) - (row[a] ?? 0));
              return (
                <TipBox title={`${formatBytes(10 ** (row.lower ?? 0))} to ${formatBytes(10 ** (row.upper ?? 0))}`}>
                  {present.map((family) => (
                    <div key={family}>
                      <span style={{ color: familyColor(family) }}>{familyGlyph(family)}</span> {familyLabel(family)}: {fmtInt(row[family])} files
                    </div>
                  ))}
                </TipBox>
              );
            }}
          />
          {families.map((family) => (
            <Bar key={family} dataKey={family} stackId="size" fill={familyColor(family)} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      {histogram.zeroByteFileCount > 0 && (
        <p className="text-[10px] text-neutral-500">{fmtInt(histogram.zeroByteFileCount)} zero-byte files have no place on a log axis and are left out of the bins.</p>
      )}
    </div>
  );
}

// ---- D. bytes written per month -------------------------------------------------------------

export function TimelineChart({ cells, families }: { cells: TimelineCell[]; families: string[] }) {
  if (cells.length === 0) return <Empty>No dated files match the controls.</Empty>;
  const months = monthRange(cells[0]?.month ?? "", cells[cells.length - 1]?.month ?? "");
  const data = months.map((month) => {
    const row: Record<string, number | string> = { month };
    for (const family of families) row[family] = 0;
    return row;
  });
  const byMonth = new Map(data.map((row) => [row.month as string, row]));
  for (const cell of cells) {
    const row = byMonth.get(cell.month);
    if (row) row[cell.format_family] = cell.gibibytes;
  }
  return (
    <div className="space-y-1">
      <FamilyLegend families={families} />
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="month" {...AXIS} />
          <YAxis {...AXIS} width={44} tickFormatter={(value: number) => fmt(value, value < 10 ? 1 : 0)} label={{ value: "gibibytes", angle: -90, position: "insideLeft", fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
          <Tooltip
            content={({ payload, label }) => {
              const row = payload?.[0]?.payload as Record<string, number | string> | undefined;
              if (!row) return null;
              const present = families.filter((family) => Number(row[family]) > 0).sort((a, b) => Number(row[b]) - Number(row[a]));
              const total = present.reduce((sum, family) => sum + Number(row[family]), 0);
              return (
                <TipBox title={`${String(label)} · ${fmt(total, 3)} GiB written`}>
                  {present.map((family) => (
                    <div key={family}>
                      <span style={{ color: familyColor(family) }}>{familyGlyph(family)}</span> {familyLabel(family)}: {fmt(Number(row[family]), 3)} GiB
                    </div>
                  ))}
                </TipBox>
              );
            }}
          />
          {families.map((family) => (
            <Area key={family} type="linear" dataKey={family} stackId="written" stroke={familyColor(family)} fill={familyColor(family)} fillOpacity={0.85} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- E. each family's size range ------------------------------------------------------------

/** Where a size (MiB) sits on the strip, 0-100 %, on a log10 axis of bytes. */
function position(mebibytes: number, lowerPower: number, upperPower: number): number {
  const bytes = mebibytes * MEBIBYTE;
  if (!(bytes > 0)) return 0;
  return Math.min(100, Math.max(0, ((Math.log10(bytes) - lowerPower) / (upperPower - lowerPower)) * 100));
}

export function FamilyRanges({ summaries }: { summaries: FamilySummaryRow[] }) {
  const rows = summaries.filter((row) => row.mebibytes.minimum !== null && row.mebibytes.maximum !== null);
  if (rows.length === 0) return <Empty>No files match the controls.</Empty>;
  const positiveMinimums = rows.map((row) => (row.mebibytes.minimum as number) * MEBIBYTE).filter((bytes) => bytes > 0);
  const lowerPower = Math.floor(Math.log10(Math.min(...(positiveMinimums.length ? positiveMinimums : [1]))));
  const upperPower = Math.max(lowerPower + 1, Math.ceil(Math.log10(Math.max(...rows.map((row) => (row.mebibytes.maximum as number) * MEBIBYTE)))));
  const step = Math.max(1, Math.ceil((upperPower - lowerPower) / 6));
  const ticks: number[] = [];
  for (let power = lowerPower; power <= upperPower; power += step) ticks.push(power);
  const order = orderedFamilies(rows.map((row) => row.format_family));
  const sorted = [...rows].sort((a, b) => order.indexOf(a.format_family) - order.indexOf(b.format_family));
  const at = (mebibytes: number | null) => position(mebibytes ?? 0, lowerPower, upperPower);
  return (
    <div className="space-y-1">
      <ul className="flex flex-wrap gap-x-4 text-[10px] text-neutral-400">
        <li>thin line: minimum to maximum</li>
        <li>filled box: 25th to 75th percentile</li>
        <li>| median</li>
        <li>◆ mean</li>
      </ul>
      <div className="grid grid-cols-[9.5rem_1fr] items-center gap-x-2 gap-y-1.5 text-[11px]">
        <div />
        <div className="relative h-4 text-[10px] text-neutral-500">
          {ticks.map((power) => (
            <span key={power} className="absolute -translate-x-1/2 font-mono" style={{ left: `${((power - lowerPower) / (upperPower - lowerPower)) * 100}%` }}>
              {formatBytes(10 ** power)}
            </span>
          ))}
        </div>
        {sorted.map((row) => {
          const summary = row.mebibytes;
          const color = familyColor(row.format_family);
          const title =
            `${familyLabel(row.format_family)} (${fmtInt(row.fileCount)} files)\n` +
            `minimum ${formatBytes((summary.minimum ?? 0) * MEBIBYTE)} · 25th percentile ${formatBytes((summary.percentile25 ?? 0) * MEBIBYTE)} · median ${formatBytes((summary.median ?? 0) * MEBIBYTE)} · ` +
            `mean ${formatBytes((summary.mean ?? 0) * MEBIBYTE)} · 75th percentile ${formatBytes((summary.percentile75 ?? 0) * MEBIBYTE)} · maximum ${formatBytes((summary.maximum ?? 0) * MEBIBYTE)}`;
          return (
            <div key={row.format_family} className="contents" title={title}>
              <div className="truncate text-neutral-300">
                <span aria-hidden="true" style={{ color }}>{familyGlyph(row.format_family)}</span> {familyLabel(row.format_family)}
              </div>
              <div className="relative h-4 rounded-sm bg-neutral-900">
                <div className="absolute top-1/2 h-px -translate-y-1/2 bg-neutral-500" style={{ left: `${at(summary.minimum)}%`, width: `${Math.max(0.3, at(summary.maximum) - at(summary.minimum))}%` }} />
                <div
                  className="absolute top-0.5 bottom-0.5 rounded-[2px] border"
                  style={{ left: `${at(summary.percentile25)}%`, width: `${Math.max(0.5, at(summary.percentile75) - at(summary.percentile25))}%`, background: `${color}99`, borderColor: color }}
                />
                <div className="absolute inset-y-0 w-0.5 bg-neutral-50" style={{ left: `${at(summary.median)}%` }} />
                <div className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-neutral-950 bg-neutral-50" style={{ left: `${at(summary.mean)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
