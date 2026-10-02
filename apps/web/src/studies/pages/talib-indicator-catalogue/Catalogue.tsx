/**
 * The catalogue tab: every output column ranked on one chosen catalogue number
 * (fill rate by default), every column as its own panel (distribution, trend
 * across the bar set and the eight numbers), and the statistics table itself.
 * The three share one set of filters: TA-Lib group, name search and the share
 * of bars that carry a value.
 */

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Empty, Finding, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, SwitchControl,
  TOOLTIP, fmt, fmtInt, toneOf,
} from "@/studies/kit";
import {
  BIN_CHOICES, HISTOGRAM_BIN_COUNT, TREND_BUCKET_COUNT, coarsenCounts,
  type CatalogueBody, type CatalogueColumn, type ColumnHistogram,
} from "@shared/studies/talib-indicator-catalogue";
import { STATISTICS, describeColumn, describeParameters, fmtValue, passesFilters, signedLog, type Controls, type SetControl } from "./shared";

type NumericKey = {
  [K in keyof CatalogueColumn]: CatalogueColumn[K] extends number | null ? K : never;
}[keyof CatalogueColumn];

interface RankMetric {
  key: NumericKey;
  label: string;
  /** A count or a share is drawn blue; a signed statistic is orange above zero and blue below. */
  signed: boolean;
}

const RANK_METRICS: RankMetric[] = [
  { key: "finite_percent", label: "share of bars with a value (percent)", signed: false },
  { key: "finite_count", label: "bars with a value (count)", signed: false },
  { key: "nonzero_bar_count", label: "bars with a nonzero value (count)", signed: false },
  { key: "lookback_bars", label: "lookback before the first value (bars)", signed: false },
  { key: "mean", label: "mean", signed: true },
  { key: "median", label: "median", signed: true },
  { key: "standard_deviation", label: "standard deviation", signed: false },
  { key: "skewness", label: "skewness", signed: true },
  { key: "kurtosis", label: "kurtosis", signed: true },
  { key: "percentile_25", label: "25th percentile", signed: true },
  { key: "percentile_75", label: "75th percentile", signed: true },
  { key: "minimum", label: "minimum", signed: true },
  { key: "maximum", label: "maximum", signed: true },
];

const PANEL_ORDERS = [
  { value: "catalogue", label: "group, then name" },
  { value: "name", label: "name" },
  { value: "standard_deviation", label: "widest spread first" },
  { value: "skewness", label: "most skewed first" },
  { value: "kurtosis", label: "fattest tails first" },
  { value: "finite_percent", label: "emptiest first" },
];

function numberOf(column: CatalogueColumn, key: NumericKey): number | null {
  const value = column[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function Filters({ controls, set, groups, shown, total }: { controls: Controls; set: SetControl; groups: string[]; shown: number; total: number }) {
  return (
    <ControlBar>
      <SelectControl
        label="TA-Lib group"
        value={controls.group}
        options={[{ value: "all", label: `every group (${groups.length})` }, ...groups.map((group) => ({ value: group, label: group }))]}
        onChange={(value) => { set("group", value); set("panelPage", 1); }}
      />
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">Column or function name</span>
        <input
          value={controls.search}
          onChange={(event) => { set("search", event.target.value); set("panelPage", 1); }}
          placeholder="rsi, macd, engulfing…"
          className="h-7 w-44 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
        />
      </label>
      <SliderControl
        label="Bars with a value, at least"
        value={controls.fillMinimum}
        min={0}
        max={100}
        onChange={(value) => { set("fillMinimum", Math.min(value, controls.fillMaximum)); set("panelPage", 1); }}
        format={(value) => `${value}%`}
        hint="Hide columns filled on a smaller share of bars than this"
      />
      <SliderControl
        label="Bars with a value, at most"
        value={controls.fillMaximum}
        min={0}
        max={100}
        onChange={(value) => { set("fillMaximum", Math.max(value, controls.fillMinimum)); set("panelPage", 1); }}
        format={(value) => `${value}%`}
        hint="Hide columns filled on a larger share of bars than this"
      />
      <span className="self-center font-mono text-[11px] text-neutral-400">{fmtInt(shown)} of {fmtInt(total)} columns</span>
    </ControlBar>
  );
}

function RankChart({ columns, controls, set }: { columns: CatalogueColumn[]; controls: Controls; set: SetControl }) {
  const metric = RANK_METRICS.find((candidate) => candidate.key === controls.metric) ?? RANK_METRICS[0]!;
  const rows = columns.map((column) => {
    const value = numberOf(column, metric.key);
    return { column, name: column.column_name, value, shown: value === null ? 0 : controls.logValues ? signedLog(value) : value };
  });
  if (controls.order === "name") rows.sort((a, b) => a.name.localeCompare(b.name));
  else rows.sort((a, b) => ((controls.order === "ascending" ? 1 : -1) * ((a.value ?? -Infinity) - (b.value ?? -Infinity))) || a.name.localeCompare(b.name));
  const height = Math.min(Math.max(260, 14 * rows.length), 2600);

  return (
    <div className="space-y-2">
      <ControlBar>
        <SelectControl label="Rank the columns by" value={metric.key} options={RANK_METRICS.map((entry) => ({ value: entry.key, label: entry.label }))} onChange={(value) => set("metric", value)} />
        <SegmentControl
          label="Order"
          value={controls.order}
          options={[{ value: "descending", label: "largest first" }, { value: "ascending", label: "smallest first" }, { value: "name", label: "name" }]}
          onChange={(value) => set("order", value)}
        />
        <SwitchControl label="Log scale on the value axis" checked={controls.logValues} onChange={(value) => set("logValues", value)} hint="Signed log10 of 1 + the absolute value, so obv in millions and a rate of change near zero fit one axis" />
      </ControlBar>
      {rows.length === 0 ? (
        <Empty>No column passes the filters.</Empty>
      ) : (
        <div className="max-h-[520px] overflow-y-auto rounded-md border border-neutral-800">
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 16 }} barCategoryGap={2}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis
                type="number"
                domain={metric.key === "finite_percent" && !controls.logValues ? [0, 100] : ["auto", "auto"]}
                tickFormatter={(value: number) => fmtValue(value)}
                label={{ value: controls.logValues ? `${metric.label}, signed log10 of 1 + absolute value` : metric.label, position: "insideBottom", offset: -8, fontSize: 10, fill: "#a3a3a3" }}
                {...AXIS}
              />
              <YAxis type="category" dataKey="name" width={200} interval={0} {...AXIS} tick={{ fontSize: 9, fill: "#d4d4d4" }} />
              <Tooltip
                {...TOOLTIP}
                formatter={(_value, _name, item) => {
                  const row = item.payload as (typeof rows)[number];
                  const glyph = metric.signed && row.value !== null && row.value !== 0 ? (row.value > 0 ? " ▲" : " ▼") : "";
                  return [`${fmtValue(row.value)}${glyph}`, metric.label];
                }}
                labelFormatter={(_label, payload) => {
                  const row = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                  if (!row) return "";
                  const column = row.column;
                  return `${column.column_name} · ${column.talib_function} · ${column.talib_group} · lookback ${fmtInt(column.lookback_bars)} bars · ${fmtInt(column.finite_count)} of ${fmtInt(column.bar_count)} bars filled (${fmt(column.finite_percent, 2)}%)`;
                }}
              />
              <Bar dataKey="shown" isAnimationActive={false}>
                {rows.map((row) => (
                  <Cell key={row.name} fill={metric.signed ? toneOf(row.value) : OKABE.blue} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[10px] text-neutral-500">
        {metric.signed
          ? "Orange ▲ = above zero, blue ▼ = below zero, grey = zero or no value; hover a bar for the exact number."
          : "One blue bar per output column; hover a bar for its function, group, lookback and filled-bar count."}
      </p>
    </div>
  );
}

function ColumnPanel({
  column, histogram, trend, groupSize, logCounts, barsPerRun,
}: {
  column: CatalogueColumn; histogram: ColumnHistogram | undefined; trend: Array<number | null> | undefined;
  groupSize: number; logCounts: boolean; barsPerRun: number;
}) {
  const counts = histogram ? coarsenCounts(histogram.counts, groupSize) : [];
  const width = histogram && counts.length > 0 ? (histogram.maximum - histogram.minimum) / counts.length : 0;
  const bins = counts.map((count, index) => {
    const lower = (histogram?.minimum ?? 0) + index * width;
    return { middle: lower + width / 2, lower, upper: lower + width, count, shown: logCounts ? Math.log10(count + 1) : count };
  });
  const runs = (trend ?? []).map((mean, index) => ({ run: index + 1, mean }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="truncate font-mono text-[11px] font-medium text-neutral-100" title={describeColumn(column)}>{column.column_name}</div>
      <div className="truncate text-[10px] text-neutral-500" title={describeParameters(column.parameters_json)}>
        {column.talib_function} · {column.talib_group} · {fmt(column.finite_percent, 1)}% filled
      </div>
      {bins.length === 0 ? (
        <p className="py-6 text-center text-[10px] text-neutral-500">No finite value on any bar, so there is nothing to draw.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={84}>
            <BarChart data={bins} margin={{ top: 4, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
              <XAxis dataKey="middle" hide />
              <YAxis hide />
              <Tooltip
                {...TOOLTIP}
                formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "bars"]}
                labelFormatter={(_label, payload) => {
                  const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                  return bin ? `value ${fmtValue(bin.lower)} to ${fmtValue(bin.upper)}` : "";
                }}
              />
              <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex justify-between font-mono text-[9px] text-neutral-500">
            <span>{fmtValue(histogram?.minimum)}</span>
            <span>distribution{logCounts ? " (log counts)" : ""}</span>
            <span>{fmtValue(histogram?.maximum)}</span>
          </div>
          <ResponsiveContainer width="100%" height={46}>
            <LineChart data={runs} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
              <XAxis dataKey="run" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                {...TOOLTIP}
                formatter={(value: number) => [fmtValue(value), "mean over the run"]}
                labelFormatter={(run: number) => `run ${run} of ${TREND_BUCKET_COUNT} (bars ${fmtInt((run - 1) * barsPerRun)} to ${fmtInt(run * barsPerRun)})`}
              />
              <Line dataKey="mean" stroke={OKABE.orange} strokeWidth={1.2} dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="text-center font-mono text-[9px] text-neutral-500">mean over {TREND_BUCKET_COUNT} equal runs of bars, first to last</div>
        </>
      )}
      <dl className="mt-1 space-y-px font-mono text-[10px] tnum">
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">bars with a value</dt>
          <dd className="text-neutral-200">{fmtInt(column.finite_count)}</dd>
        </div>
        {STATISTICS.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-2">
            <dt className="text-neutral-500">{label}</dt>
            <dd className="text-neutral-200">{fmtValue(column[key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ColumnPanels({ columns, body, controls, set }: { columns: CatalogueColumn[]; body: CatalogueBody; controls: Controls; set: SetControl }) {
  const bins = (BIN_CHOICES as readonly number[]).includes(controls.bins) ? controls.bins : 30;
  const ordered = [...columns];
  if (controls.panelOrder === "name") ordered.sort((a, b) => a.column_name.localeCompare(b.column_name));
  else if (controls.panelOrder === "finite_percent") ordered.sort((a, b) => a.finite_percent - b.finite_percent);
  else if (controls.panelOrder === "standard_deviation" || controls.panelOrder === "skewness" || controls.panelOrder === "kurtosis") {
    const key = controls.panelOrder;
    ordered.sort((a, b) => Math.abs(b[key] ?? -1) - Math.abs(a[key] ?? -1));
  }
  const perPage = Math.max(6, Math.min(60, Math.round(controls.panelsPerPage)));
  const pages = Math.max(1, Math.ceil(ordered.length / perPage));
  const page = Math.min(Math.max(1, Math.round(controls.panelPage)), pages);
  const visible = ordered.slice((page - 1) * perPage, page * perPage);
  const barsPerRun = Math.ceil((body.summary?.barCount ?? 0) / TREND_BUCKET_COUNT);

  return (
    <div className="space-y-2">
      <ControlBar>
        <SegmentControl label="Histogram bins" value={bins} options={[...BIN_CHOICES].reverse().map((choice) => ({ value: choice, label: String(choice) }))} onChange={(value) => set("bins", value)} hint={`Each choice divides the ${HISTOGRAM_BIN_COUNT} landed bins exactly, so no bar is counted twice`} />
        <SwitchControl label="Log counts" checked={controls.logCounts} onChange={(value) => set("logCounts", value)} hint="Bar height is log10 of the count plus one, so thin tails stay visible" />
        <SelectControl label="Panel order" value={controls.panelOrder} options={PANEL_ORDERS} onChange={(value) => { set("panelOrder", value); set("panelPage", 1); }} />
        <SliderControl label="Panels per page" value={perPage} min={6} max={60} step={6} onChange={(value) => { set("panelsPerPage", value); set("panelPage", 1); }} />
        <SliderControl label="Page" value={page} min={1} max={pages} onChange={(value) => set("panelPage", value)} format={(value) => `${value} of ${pages}`} />
      </ControlBar>
      {visible.length === 0 ? (
        <Empty>No column passes the filters.</Empty>
      ) : (
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
          {visible.map((column) => (
            <ColumnPanel
              key={column.column_name}
              column={column}
              histogram={body.histograms[column.column_name]}
              trend={body.trends[column.column_name]}
              groupSize={HISTOGRAM_BIN_COUNT / bins}
              logCounts={controls.logCounts}
              barsPerRun={barsPerRun}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type TableKey = keyof CatalogueColumn;

const TABLE_COLUMNS: Array<{ key: TableKey; label: string; text?: boolean }> = [
  { key: "column_name", label: "column name", text: true },
  { key: "talib_function", label: "TA-Lib function", text: true },
  { key: "talib_output", label: "output", text: true },
  { key: "talib_group", label: "TA-Lib group", text: true },
  { key: "lookback_bars", label: "lookback (bars)" },
  { key: "finite_count", label: "bars with a value" },
  { key: "finite_percent", label: "bars with a value (percent)" },
  { key: "nonzero_bar_count", label: "bars with a nonzero value" },
  { key: "mean", label: "mean" },
  { key: "median", label: "median" },
  { key: "standard_deviation", label: "standard deviation" },
  { key: "skewness", label: "skewness" },
  { key: "kurtosis", label: "kurtosis" },
  { key: "percentile_25", label: "25th percentile" },
  { key: "percentile_75", label: "75th percentile" },
  { key: "minimum", label: "minimum" },
  { key: "maximum", label: "maximum" },
  { key: "parameters_json", label: "parameters", text: true },
];

const ROWS_PER_PAGE = 30;

function StatisticsTable({ columns }: { columns: CatalogueColumn[] }) {
  const [sortKey, setSortKey] = useState<TableKey>("talib_group");
  const [descending, setDescending] = useState(false);
  const [requestedPage, setRequestedPage] = useState(1);

  const sorted = [...columns].sort((a, b) => {
    const left = a[sortKey];
    const right = b[sortKey];
    const order = typeof left === "string" && typeof right === "string"
      ? left.localeCompare(right)
      : (typeof left === "number" ? left : -Infinity) - (typeof right === "number" ? right : -Infinity);
    return (descending ? -order : order) || a.column_name.localeCompare(b.column_name);
  });
  const pages = Math.max(1, Math.ceil(sorted.length / ROWS_PER_PAGE));
  const page = Math.min(requestedPage, pages);
  const visible = sorted.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  const pick = (key: TableKey) => {
    if (key === sortKey) setDescending(!descending);
    else { setSortKey(key); setDescending(false); }
    setRequestedPage(1);
  };

  return (
    <div className="space-y-2">
      <ControlBar>
        <SliderControl label="Table page" value={page} min={1} max={pages} onChange={setRequestedPage} format={(value) => `${value} of ${pages}`} />
        <span className="self-center text-[11px] text-neutral-400">
          {fmtInt(sorted.length)} columns, {ROWS_PER_PAGE} a page, sorted by {TABLE_COLUMNS.find((entry) => entry.key === sortKey)?.label} {descending ? "▼ largest first" : "▲ smallest first"}. Click a heading to sort.
        </span>
      </ControlBar>
      <div className="overflow-x-auto rounded-md border border-neutral-800">
        <table className="w-full whitespace-nowrap font-mono text-[11px] tnum">
          <thead>
            <tr className="bg-neutral-900 text-neutral-400">
              {TABLE_COLUMNS.map((entry) => (
                <th key={entry.key} className={`px-2 py-1 font-normal ${entry.text ? "text-left" : "text-right"}`}>
                  <button type="button" onClick={() => pick(entry.key)} className="hover:text-neutral-100" aria-pressed={entry.key === sortKey}>
                    {entry.label}{entry.key === sortKey ? (descending ? " ▼" : " ▲") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((column) => (
              <tr key={column.column_name} className="border-t border-neutral-900 odd:bg-neutral-950/40">
                {TABLE_COLUMNS.map((entry) => {
                  const value = column[entry.key];
                  const shown = entry.key === "parameters_json"
                    ? describeParameters(column.parameters_json)
                    : typeof value === "string" ? value
                    : entry.key === "lookback_bars" || entry.key === "finite_count" || entry.key === "nonzero_bar_count" ? fmtInt(value as number)
                    : fmtValue(value as number | null);
                  return (
                    <td key={entry.key} className={`px-2 py-0.5 ${entry.text ? "text-left text-neutral-300" : "text-right text-neutral-200"}`}>{shown}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Catalogue({ body, controls, set, groups }: { body: CatalogueBody; controls: Controls; set: SetControl; groups: string[] }) {
  const columns = body.columns.filter((column) => passesFilters(column, controls));
  const barCount = body.summary?.barCount ?? 0;
  const empty = body.columns.filter((column) => column.finite_count === 0);
  const full = body.columns.filter((column) => column.finite_percent >= 99);
  const longest = body.columns.reduce<CatalogueColumn | null>((best, column) => (best === null || column.lookback_bars > best.lookback_bars ? column : best), null);
  const fattest = body.columns.reduce<CatalogueColumn | null>((best, column) => ((column.kurtosis ?? -Infinity) > (best?.kurtosis ?? -Infinity) ? column : best), null);

  return (
    <div className="space-y-3">
      <Filters controls={controls} set={set} groups={groups} shown={columns.length} total={body.columns.length} />

      <Section
        title="Which columns can be used: every column ranked on one number"
        question="One bar per output column; the bar's length is the number chosen in the selector (the share of bars that carry a value, by default). Read from the landed statistics table over the whole bar set, no sampling."
      >
        <RankChart columns={columns} controls={controls} set={set} />
        <Finding>
          {fmtInt(full.length)} of {fmtInt(body.columns.length)} columns carry a value on at least 99% of the {fmtInt(barCount)} bars, and {fmtInt(empty.length)} carry none at all
          {empty.length > 0 ? ` (${empty.map((column) => column.column_name).join(", ")}: the function is undefined or overflows at a price near 25,000)` : ""}.
          The gap between a column and 100% is its warmup{longest ? `; the longest is ${longest.column_name} at ${fmtInt(longest.lookback_bars)} bars` : ""}. A column that is empty or mostly empty cannot be a model
          feature, so this is the first filter before any of them is read as a signal.
        </Finding>
      </Section>

      <Section
        title="Every column, seen: distribution, trend and the eight numbers"
        question="One panel per output column. Sky bars: how many bars fall in each value range, from the column's minimum (left) to its maximum (right). Orange line: the column's mean over 60 equal runs of bars, first bar to last. Beneath: mean, median, standard deviation, skewness, kurtosis, quartiles, minimum and maximum over every bar with a value."
      >
        <ColumnPanels columns={columns} body={body} controls={controls} set={set} />
        <Finding>
          Few of these columns are bell-shaped, which is why the mean alone is not reported.{fattest ? ` The fattest tails belong to ${fattest.column_name} (kurtosis ${fmtValue(fattest.kurtosis)}).` : ""} A
          price-level column (a moving average, a band) has a trend line that simply follows price and a distribution that is price's own; an oscillator has a flat trend and a bounded distribution. That
          difference decides how a column must be normalised before it is compared with another.
        </Finding>
      </Section>

      <Section title="The statistics table" question="The landed table itself, one row per output column, under the same filters. Every number here is drawn in the two sections above.">
        <StatisticsTable columns={columns} />
      </Section>
    </div>
  );
}
