/**
 * Sections 2 to 4: where the read time goes (by lake table and by read rule,
 * cold and warm), what an in-process cache costs against Redis, and the cost
 * of fitting on the page's own thread.
 */

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Finding, GRID, OKABE, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import {
  RULE_LABELS, isPublishedFigure,
  type CacheOptionRow, type ClientFitRow, type LatencyGroup, type ObjectLatency, type RuleLatency,
} from "@shared/studies/regression-tab-performance";

const RULE_COLOR: Record<string, string> = {
  original_rule_reads_one_second_table: OKABE.blue,
  regression_columns_one_minute_copy_only: OKABE.orange,
  regression_columns_all_current_rule: OKABE.green,
};
const RULE_GLYPH: Record<string, string> = {
  original_rule_reads_one_second_table: "■",
  regression_columns_one_minute_copy_only: "▲",
  regression_columns_all_current_rule: "●",
};

function median(object: ObjectLatency[], name: string, state: string): number | null {
  return object.find((row) => row.object === name && row.cache_state === state)?.median_milliseconds ?? null;
}

export function LatencyCharts({ byObject, byRule, cacheState }: { byObject: readonly ObjectLatency[]; byRule: readonly RuleLatency[]; cacheState: string }) {
  const objects = byObject
    .filter((row) => row.cache_state === cacheState && row.median_milliseconds !== null)
    .map((row) => ({ label: row.object, value: row.median_milliseconds as number }))
    .sort((a, b) => b.value - a.value);
  const rules = byRule
    .filter((row) => row.cache_state === cacheState && row.median_milliseconds !== null)
    .map((row) => ({ key: row.measurement_set, label: `${RULE_GLYPH[row.measurement_set] ?? ""} ${RULE_LABELS[row.measurement_set] ?? row.measurement_set}`, value: row.median_milliseconds as number }));
  const listed = [...byObject];
  const fullCold = median(listed, "candle_anatomy", "cold");
  const minuteCold = median(listed, "candle_anatomy_1m", "cold");
  const currentWarm = byRule.find((row) => row.measurement_set === "regression_columns_all_current_rule" && row.cache_state === "warm")?.median_milliseconds ?? null;
  const currentCold = byRule.find((row) => row.measurement_set === "regression_columns_all_current_rule" && row.cache_state === "cold")?.median_milliseconds ?? null;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <h4 className="text-xs font-semibold text-neutral-200">{cacheState} read of each lake table (MNQ, daily)</h4>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={objects} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 14 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} label={{ value: `${cacheState} read, median milliseconds`, position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
            <YAxis type="category" dataKey="label" width={150} {...AXIS} interval={0} />
            <Tooltip {...TOOLTIP} formatter={(value) => `${fmt(Number(value), 1)} ms`} />
            <Bar dataKey="value" name="median milliseconds" fill={OKABE.sky} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <Finding>
          {cacheState === "cold"
            ? `Cold reads are dominated by candle_anatomy, one row per SECOND (96.7M rows): ${fmt(fullCold, 0)} ms against ${fmt(minuteCold, 0)} ms for its one-minute copy.`
            : "Warm, every table answers in a few milliseconds; the heaviest is mnq_indicators_norm_1m."}
        </Finding>
      </div>
      <div className="min-w-0 space-y-1">
        <h4 className="text-xs font-semibold text-neutral-200">{cacheState} read of every MNQ daily lake column, by read rule</h4>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={rules} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 14 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} label={{ value: `${cacheState} read, median milliseconds`, position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
            <YAxis type="category" dataKey="label" width={230} {...AXIS} interval={0} tick={{ fontSize: 9, fill: "#a3a3a3" }} />
            <Tooltip {...TOOLTIP} formatter={(value) => `${fmt(Number(value), 1)} ms`} />
            <Bar dataKey="value" name="median milliseconds" isAnimationActive={false}>
              {rules.map((row) => (
                <Cell key={row.key} fill={RULE_COLOR[row.key] ?? OKABE.grey} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <Finding>
          The one-minute copy reads {minuteCold && fullCold ? fmt(fullCold / minuteCold, 0) : "several"}× faster, but it starts 2024-02-29 and the one-second table goes back to 2019-05-05, so the tab keeps both, pays about {fmt(currentCold === null ? null : currentCold / 1000, 1)} s once per window, and answers every repeat from memory in about {fmt(currentWarm, 0)} ms. A finer table is skipped only when a coarser one covers its whole span.
        </Finding>
      </div>
    </div>
  );
}

export function LatencyTable({ groups }: { groups: readonly LatencyGroup[] }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-neutral-950 text-left text-neutral-500">
          <tr>
            <th className="py-1 pr-2 font-normal">layer</th>
            <th className="py-1 pr-2 font-normal">measurement set</th>
            <th className="py-1 pr-2 font-normal">lake table</th>
            <th className="py-1 pr-2 font-normal">cache</th>
            <th className="py-1 pr-2 font-normal">timeframe</th>
            <th className="py-1 pr-2 text-right font-normal">runs</th>
            <th className="py-1 pr-2 text-right font-normal">median total ms</th>
            <th className="py-1 text-right font-normal">median first byte ms</th>
          </tr>
        </thead>
        <tbody className="font-mono tnum">
          {groups.map((row) => (
            <tr key={`${row.layer}|${row.measurement_set}|${row.object}|${row.cache_state}|${row.timeframe}`} className="border-t border-neutral-900 text-neutral-300">
              <td className="py-0.5 pr-2">{row.layer}</td>
              <td className="py-0.5 pr-2">{row.measurement_set}</td>
              <td className="py-0.5 pr-2">{row.object ?? "all"}</td>
              <td className="py-0.5 pr-2">{row.cache_state === "cold" ? "cold ❄" : "warm ♨"}</td>
              <td className="py-0.5 pr-2">{row.timeframe}</td>
              <td className="py-0.5 pr-2 text-right">{fmtInt(row.measurement_count)}</td>
              <td className="py-0.5 pr-2 text-right">{fmt(row.median_total_milliseconds, 1)}</td>
              <td className="py-0.5 text-right">{fmt(row.median_time_to_first_byte_milliseconds, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CacheOptions({ options }: { options: readonly CacheOptionRow[] }) {
  const bars = options.map((row) => ({ label: row.option, milliseconds: row.milliseconds, published: isPublishedFigure(row.option), megabytes: row.payload_megabytes, source: row.source }));
  const lru = options.find((row) => row.option.includes("LRU"));
  return (
    <div className="space-y-2">
      <Finding>
        The server already answers a repeated request from its own memory (an LRU cache, where the least recently used entries are dropped first): about {fmt(lru?.milliseconds, 0)} ms for the whole {fmt(lru?.payload_megabytes, 1)} MB HTTP response, and the lookup inside that is handing over an object already in memory, not a copy. Redis would keep the same answer in a separate program: every hit becomes a socket round trip plus turning megabytes of text back into objects, work the in-process cache never does. Redis earns its keep when several server processes must share one cache, when a cache must survive a restart, or when machines share it. This dashboard is one process on one machine, and its data is immutable history that one cold read rebuilds.
      </Finding>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 14 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} label={{ value: "milliseconds", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={250} {...AXIS} interval={0} tick={{ fontSize: 9, fill: "#a3a3a3" }} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as (typeof bars)[number] | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{row.label}</div>
                  <div>{fmt(row.milliseconds, 1)} ms for a {fmt(row.megabytes, 2)} MB payload</div>
                  <div>{row.source}</div>
                  <div>{row.published ? "published figure, not measured here" : "measured on this machine"}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="milliseconds" name="milliseconds" isAnimationActive={false}>
            {bars.map((bar) => (
              <Cell key={bar.label} fill={bar.published ? OKABE.purple : OKABE.blue} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.blue }}>■ measured here</span> · <span style={{ color: OKABE.purple }}>■ published benchmark figure, not measured on this machine</span> (the two Redis-side rows)
      </p>
    </div>
  );
}

export function ClientFit({ rows }: { rows: readonly ClientFitRow[] }) {
  const bars = rows.map((row) => ({ label: `${row.where} · ${row.bars.toLocaleString("en-US")} bars · ${row.variables} variables`, milliseconds: row.milliseconds, worker: row.where.startsWith("web_worker"), note: row.note }));
  const heaviest = [...rows].filter((row) => row.where === "main_thread_benchmark").sort((a, b) => b.milliseconds - a.milliseconds)[0];
  const worker = rows.filter((row) => row.where.startsWith("web_worker"));
  return (
    <div className="space-y-2">
      <Finding>
        {heaviest ? `${heaviest.variables} regressions over ${heaviest.bars.toLocaleString("en-US")} bars measured ${fmt(heaviest.milliseconds, 0)} ms of work that froze every control. ` : ""}
        They now run in a background worker{worker.length > 0 ? ` (${worker.map((row) => `${fmt(row.milliseconds, 0)} ms`).join(" and ")} measured live on ${worker[0]?.bars.toLocaleString("en-US")} bars)` : ""}; the page's thread had no task over 50 ms during a refit.
      </Finding>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 14, left: 4, bottom: 14 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} label={{ value: "milliseconds to fit every panel", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={250} {...AXIS} interval={0} tick={{ fontSize: 9, fill: "#a3a3a3" }} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as (typeof bars)[number] | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{row.label}</div>
                  <div>{fmt(row.milliseconds, 1)} ms</div>
                  <div>{row.note}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="milliseconds" name="milliseconds" isAnimationActive={false}>
            {bars.map((bar) => (
              <Cell key={bar.label + bar.note} fill={bar.worker ? OKABE.blue : OKABE.vermillion} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.vermillion }}>■ main thread (freezes the page)</span> · <span style={{ color: OKABE.blue }}>■ background worker</span>
      </p>
    </div>
  );
}
