/**
 * The census page's charts: patterns by length, every pattern by firings,
 * the side split, and the registry comparison. Count axes are symmetric-log
 * (zero is a real value here), drawn by transforming the data and labelling the
 * ticks back in raw counts, so the tooltip always shows the exact number.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, GRID, OKABE, TOOLTIP, fmtInt, fmtPercent } from "@/studies/kit";
import {
  presenceOf, symlog, type LengthRow, type RegistryRow, type SelectedPattern,
} from "@shared/studies/candlestick-pattern-census";
import { GlyphTick, PRESENCE_COLOR, PRESENCE_GLYPH, compactCount, symlogTickLabel, symlogTicks } from "./parts";

export function LengthCharts({ rows }: { rows: readonly LengthRow[] }) {
  const defined = rows.map((row) => ({
    label: `${row.candleCount}-candle`,
    fires: row.patternsThatFire,
    never: row.patternsThatNeverFire,
    defined: row.patternsDefined,
  }));
  const firings = rows.map((row) => ({
    label: `${row.candleCount}-candle`,
    shown: symlog(row.totalFirings),
    totalFirings: row.totalFirings,
    patternsDefined: row.patternsDefined,
  }));
  const maxFirings = Math.max(1, ...rows.map((row) => row.totalFirings));
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="min-w-0">
        <h4 className="mb-1 text-[11px] font-semibold text-neutral-300">How the TA-Lib patterns split by pattern length</h4>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={defined} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="label" {...AXIS} />
            <YAxis {...AXIS} width={34} allowDecimals={false} label={{ value: "patterns", angle: -90, position: "insideLeft", fill: "#737373", fontSize: 10 }} />
            <Tooltip
              {...TOOLTIP}
              content={({ payload }) => {
                const row = payload?.[0]?.payload as (typeof defined)[number] | undefined;
                if (!row) return null;
                return (
                  <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                    <div className="font-semibold">{row.label} patterns</div>
                    <div>{row.defined} defined</div>
                    <div>● {row.fires} fire in MNQ</div>
                    <div>○ {row.never} never fire</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="fires" name="fires in MNQ" stackId="presence" fill={OKABE.orange} isAnimationActive={false}>
              <LabelList dataKey="fires" position="inside" fill="#000" fontSize={11} />
            </Bar>
            <Bar dataKey="never" name="never fires" stackId="presence" fill={OKABE.grey} isAnimationActive={false}>
              <LabelList dataKey="never" position="inside" fill="#000" fontSize={11} formatter={(value: unknown) => (Number(value) > 0 ? String(value) : "")} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-neutral-400">
          <span style={{ color: OKABE.orange }}>● fires in MNQ</span> · <span style={{ color: OKABE.grey }}>○ never fires</span>
        </p>
      </div>
      <div className="min-w-0">
        <h4 className="mb-1 text-[11px] font-semibold text-neutral-300">…and how much of the data each length accounts for</h4>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={firings} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="label" {...AXIS} />
            <YAxis
              {...AXIS}
              width={44}
              domain={[0, (dataMax: number) => dataMax * 1.1]}
              ticks={symlogTicks(maxFirings)}
              tickFormatter={symlogTickLabel}
              label={{ value: "firings, all five timeframes (symmetric-log)", angle: -90, position: "insideLeft", fill: "#737373", fontSize: 10, dx: 8 }}
            />
            <Tooltip
              {...TOOLTIP}
              content={({ payload }) => {
                const row = payload?.[0]?.payload as (typeof firings)[number] | undefined;
                if (!row) return null;
                return (
                  <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                    <div className="font-semibold">{row.label} patterns</div>
                    <div>{fmtInt(row.totalFirings)} firings</div>
                    <div>{row.patternsDefined} patterns defined</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="shown" name="total firings" fill={OKABE.blue} isAnimationActive={false}>
              <LabelList dataKey="totalFirings" position="top" fill="#d4d4d4" fontSize={10} formatter={(value: unknown) => compactCount(Number(value))} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function FiringChart({ patterns, threshold }: { patterns: readonly SelectedPattern[]; threshold: number }) {
  const data = patterns.map((entry) => ({
    name: entry.pattern_name,
    shown: symlog(entry.firingCountSelected),
    count: entry.firingCountSelected,
    presence: presenceOf(entry.firingCountSelected, threshold),
    entry,
  }));
  const presenceByName = new Map(data.map((row) => [row.name, row.presence]));
  const maxCount = Math.max(1, ...patterns.map((entry) => entry.firingCountSelected));
  return (
    <div className="max-h-[620px] overflow-y-auto rounded border border-neutral-900">
      <ResponsiveContainer width="100%" height={Math.max(260, 15 * data.length + 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 18 }} barCategoryGap={2}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis
            type="number"
            {...AXIS}
            domain={[0, (dataMax: number) => dataMax * 1.05]}
            ticks={symlogTicks(maxCount)}
            tickFormatter={symlogTickLabel}
            label={{ value: "firing count (symmetric-log: zero is a real value here)", position: "insideBottom", offset: -10, fill: "#737373", fontSize: 10 }}
          />
          <YAxis type="category" dataKey="name" width={150} interval={0} tick={<GlyphTick presenceByName={presenceByName} />} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{PRESENCE_GLYPH[row.presence]} {row.entry.pattern_name} · {row.entry.talib_function}</div>
                  <div>{fmtInt(row.count)} firings · {row.presence}</div>
                  <div>{row.entry.candle_count}-candle {row.entry.pattern_type}</div>
                  <div>▲ bullish {fmtInt(row.entry.firingCountBullish)} · ▼ bearish {fmtInt(row.entry.firingCountBearish)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="shown" isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.name} fill={PRESENCE_COLOR[row.presence]} />
            ))}
            <LabelList dataKey="count" position="right" fill="#a3a3a3" fontSize={9} formatter={(value: unknown) => compactCount(Number(value))} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SideChart({ patterns }: { patterns: readonly SelectedPattern[] }) {
  const data = patterns
    .filter((entry) => entry.firingCountBullish + entry.firingCountBearish > 0)
    .map((entry) => ({
      name: entry.pattern_name,
      bullish: entry.firingCountBullish,
      bearish: entry.firingCountBearish,
      bullishShare: entry.firingCountBullish / (entry.firingCountBullish + entry.firingCountBearish),
    }))
    .sort((a, b) => b.bullishShare - a.bullishShare || a.name.localeCompare(b.name));
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.orange }}>▲ bullish (positive value)</span> · <span style={{ color: OKABE.blue }}>▼ bearish (negative value), hatched</span>
      </p>
      <div className="max-h-[560px] overflow-y-auto rounded border border-neutral-900">
        <ResponsiveContainer width="100%" height={Math.max(240, 14 * data.length + 40)}>
          <BarChart data={data} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 16, left: 4, bottom: 18 }} barCategoryGap={2}>
            <defs>
              <pattern id="census-bearish-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={OKABE.blue} />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#0b0b0b" strokeWidth="2" />
              </pattern>
            </defs>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis
              type="number"
              {...AXIS}
              tickFormatter={(value: number) => fmtPercent(value, 0)}
              label={{ value: "share of this pattern's firings", position: "insideBottom", offset: -10, fill: "#737373", fontSize: 10 }}
            />
            <YAxis type="category" dataKey="name" width={130} interval={0} {...AXIS} />
            <Tooltip
              {...TOOLTIP}
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
              content={({ payload }) => {
                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!row) return null;
                return (
                  <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                    <div className="font-semibold">{row.name}</div>
                    <div>▲ bullish {fmtInt(row.bullish)} ({fmtPercent(row.bullishShare)})</div>
                    <div>▼ bearish {fmtInt(row.bearish)} ({fmtPercent(1 - row.bullishShare)})</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="bullish" stackId="side" fill={OKABE.orange} isAnimationActive={false} />
            <Bar dataKey="bearish" stackId="side" fill="url(#census-bearish-hatch)" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const KIND_COLOR: Record<string, string> = {
  library: OKABE.orange,
  "hand-written": OKABE.blue,
  "re-implementation of TA-Lib": OKABE.sky,
  "subset of TA-Lib": OKABE.purple,
  "continuous primitive": OKABE.vermillion,
};

export function RegistryChart({ registries }: { registries: readonly RegistryRow[] }) {
  const data = [...registries]
    .sort((a, b) => b.definition_count - a.definition_count)
    .map((row) => ({ ...row, label: `${row.registry_name} · ${row.definition_kind}` }));
  const kinds = [...new Set(data.map((row) => row.definition_kind))];
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-neutral-400">
        {kinds.map((kind) => (
          <span key={kind} className="mr-3 whitespace-nowrap" style={{ color: KIND_COLOR[kind] ?? OKABE.grey }}>
            ■ {kind}
          </span>
        ))}
      </p>
      <ResponsiveContainer width="100%" height={Math.max(200, 38 * data.length + 30)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, left: 4, bottom: 18 }} barCategoryGap={6}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} allowDecimals={false} label={{ value: "pattern definitions in that registry", position: "insideBottom", offset: -10, fill: "#737373", fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={250} interval={0} {...AXIS} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="max-w-xs space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{row.registry_name}</div>
                  <div>{row.definition_count} definitions ({row.definition_kind})</div>
                  <div className="text-neutral-400">{row.where_it_lives}</div>
                  <div className="text-neutral-400">counted as: {row.how_counted}</div>
                  <div>{row.count_matches_notebook ? "equals" : "differs from"} the {row.definition_count_typed_in_notebook} the notebook had typed</div>
                </div>
              );
            }}
          />
          <Bar dataKey="definition_count" isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.registry_name} fill={KIND_COLOR[row.definition_kind] ?? OKABE.grey} />
            ))}
            <LabelList dataKey="definition_count" position="right" fill="#d4d4d4" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
