/**
 * Candle shapes that stand out. The server filters the landed standouts by reason (and weekday /
 * month when a heatmap cell is picked); the page draws the calendar, the shape map, the candles
 * themselves and every column.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, FormulaCard, GRID, Heatmap, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat,
  StudyNotes, StudyState, TOOLTIP, Finding, fmt, fmtInt, fmtTime, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  MONTHS, REASON_LABELS, SORT_COLUMNS, STANDOUT_REASONS, WEEKDAYS,
  type CalendarCell, type ShapeCatalogRow, type SortColumn, type StandoutRow, type StandoutsBody,
} from "@shared/studies/candle-shape-standouts";

const SORT_LABELS: Record<SortColumn, string> = {
  range_to_trailing_mean_range_ratio: "Range ÷ trailing average range",
  body_to_trailing_mean_range_ratio: "Body ÷ trailing average range",
  upper_wick_to_trailing_mean_range_ratio: "Upper wick ÷ trailing average range",
  lower_wick_to_trailing_mean_range_ratio: "Lower wick ÷ trailing average range",
  range_ticks: "Range in ticks",
  trailing_shape_share_percent: "Rarest shape first",
  upper_to_lower_wick_ratio: "Upper wick ÷ lower wick",
  body_to_total_wick_ratio: "Body ÷ both wicks",
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const CIVIDIS: [string, string, string] = ["#00204d", "#7c7b78", "#ffea46"];

function title(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** One candle drawn to scale beside a bar as long as the trailing average range. */
function CandleGlyph({ row, height = 64 }: { row: StandoutRow; height?: number }) {
  const average = (row.trailing_mean_range_ticks ?? 0) * 0.25;
  const high = row.absolute_high_price, low = row.absolute_low_price;
  const span = Math.max(high - low, average, 1e-9);
  const top = Math.max(high, low + average);
  const y = (price: number) => 4 + ((top - price) / span) * (height - 8);
  const rising = row.absolute_close_price >= row.absolute_open_price;
  const bodyTop = y(Math.max(row.absolute_open_price, row.absolute_close_price));
  const bodyBottom = y(Math.min(row.absolute_open_price, row.absolute_close_price));
  return (
    <svg width={40} height={height} role="img" aria-label={`${row.direction} candle, range ${fmt(row.range_ticks, 0)} ticks`}>
      {average > 0 && <rect x={2} y={y(low + average)} width={4} height={y(low) - y(low + average)} fill={OKABE.grey} opacity={0.6}><title>trailing average range</title></rect>}
      <line x1={24} x2={24} y1={y(high)} y2={y(low)} stroke="#e5e5e5" strokeWidth={1.5} />
      <rect x={16} y={bodyTop} width={16} height={Math.max(1.5, bodyBottom - bodyTop)}
        fill={rising ? "none" : OKABE.blue} stroke={rising ? OKABE.orange : OKABE.blue} strokeWidth={1.5} />
    </svg>
  );
}

function matrix(cells: CalendarCell[], rows: readonly string[], columns: readonly (string | number)[]): number[][] {
  const lookup = new Map(cells.map((cell) => [`${cell.row_key}|${cell.column_key}`, cell.standout_count]));
  return rows.map((row) => columns.map((column) => lookup.get(`${row}|${column}`) ?? 0));
}

/** Standouts per 1,000 bars, for one calendar key, using the catalog's all-bar counts as the base. */
function ratePerThousand(cells: CalendarCell[], catalog: ShapeCatalogRow[], keys: readonly string[], keyOf: "row_key" | "column_key") {
  return keys.map((key) => {
    const standouts = cells.filter((cell) => cell[keyOf] === key).reduce((sum, cell) => sum + cell.standout_count, 0);
    const bars = catalog.reduce((sum, row) => sum + (Number(row[`${key}_count`]) || 0), 0);
    return { key: title(key), standouts, bars, rate: bars > 0 ? (standouts / bars) * 1000 : 0 };
  });
}

function ShapeMap({ catalog, direction }: { catalog: ShapeCatalogRow[]; direction: string }) {
  const cells = catalog.filter((row) => row.direction === direction);
  const lookup = new Map(cells.map((row) => [`${row.body_tenth_of_range}|${row.upper_wick_tenth_of_range}`, row]));
  const size = 30;
  const maxLog = Math.max(1, ...cells.map((row) => Math.log10(row.bar_count + 1)));
  return (
    <svg width={size * 10 + 70} height={size * 10 + 40} role="img" aria-label={`shape map of ${direction} candles`}>
      {Array.from({ length: 10 }, (_, upper) =>
        Array.from({ length: 10 }, (_, body) => {
          const row = lookup.get(`${body}|${upper}`);
          const t = row ? Math.log10(row.bar_count + 1) / maxLog : 0;
          const x = 50 + body * size, yy = 10 + (9 - upper) * size;
          const fill = row ? `hsl(${220 - 170 * t}, ${40 + 50 * t}%, ${18 + 50 * t}%)` : "transparent";
          return (
            <g key={`${body}-${upper}`}>
              <rect x={x} y={yy} width={size - 1} height={size - 1} fill={fill} stroke={row ? "none" : "#262626"}>
                <title>{row ? `${row.shape_cell}: ${fmtInt(row.bar_count)} bars (${fmt(row.share_percent, 3)}%), lower wick ${row.lower_wick_tenth_of_range}/10, ${fmtInt(row.standout_count)} standouts` : "never seen"}</title>
              </rect>
              {row && row.bar_count < 50 && <text x={x + size / 2} y={yy + size / 2 + 3} fontSize={9} textAnchor="middle" fill="#fff">{row.bar_count}</text>}
            </g>
          );
        }),
      )}
      {Array.from({ length: 10 }, (_, k) => (
        <g key={k}>
          <text x={50 + k * size + size / 2} y={size * 10 + 24} fontSize={9} textAnchor="middle" fill="#a3a3a3">{k}</text>
          <text x={42} y={10 + (9 - k) * size + size / 2 + 3} fontSize={9} textAnchor="end" fill="#a3a3a3">{k}</text>
        </g>
      ))}
      <text x={50 + 5 * size} y={size * 10 + 38} fontSize={10} textAnchor="middle" fill="#d4d4d4">body, tenths of the range →</text>
      <text x={10} y={10 + 5 * size} fontSize={10} textAnchor="middle" fill="#d4d4d4" transform={`rotate(-90 10 ${10 + 5 * size})`}>upper wick, tenths →</text>
    </svg>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    reason: "any",
    sort: "range_to_trailing_mean_range_ratio",
    weekday: "all",
    month: "all",
    limit: 60,
    direction: "rising",
  });
  const query = useStudyQuery<StandoutsBody>("candle-shape-standouts", {
    reason: controls.reason, sort: controls.sort, weekday: controls.weekday, month: controls.month, limit: controls.limit,
  });
  const body = query.data?.data;
  const rules = body?.rules ?? [];
  const catalog = body?.catalog ?? [];
  const examined = rules[0]?.bars_examined ?? 0;
  const tradingWeekdays = WEEKDAYS.filter((day) => day !== "sunday");
  const byWeekday = ratePerThousand(body?.weekdayByMonth ?? [], catalog, tradingWeekdays, "row_key");
  const byMonth = ratePerThousand(body?.weekdayByMonth ?? [], catalog, MONTHS, "column_key");
  const monthMatrix = matrix(body?.weekdayByMonth ?? [], tradingWeekdays, MONTHS);
  const hourMatrix = matrix(body?.weekdayByHour ?? [], tradingWeekdays, HOURS);
  const rarest = catalog.slice(0, 16);
  const example = body?.rows[0];

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label="Bars examined" value={fmtInt(examined)} hint={rules[0] ? `${fmtTime(rules[0].first_bar)} → ${fmtTime(rules[0].last_bar)} UTC; the 2025 second half is the locked holdout` : undefined} />
          <Stat label="Standouts matching" value={fmtInt(body?.matching)} hint="for the reason and calendar cell selected" />
          <Stat label="Distinct shape cells" value={fmtInt(catalog.length)} hint="direction × body / upper / lower wick tenths" />
          <Stat label="Cells seen under 50 times" value={fmtInt(catalog.filter((row) => row.bar_count < 50).length)} tone={OKABE.orange} />
        </div>

        <Section title="A. What stands out" question="Each candle is compared with the bars before it only — never with the future.">
          <div className="grid gap-3 xl:grid-cols-2">
            <FormulaCard
              tex={String.raw`\text{body}=\frac{|C-O|}{H-L},\quad \text{upper}=\frac{H-\max(O,C)}{H-L},\quad \text{lower}=\frac{\min(O,C)-L}{H-L},\quad \text{range ratio}=\frac{H-L}{\tfrac{1}{60}\sum_{k=1}^{60}(H_{t-k}-L_{t-k})}`}
              symbols={[
                { tex: "O,H,L,C", name: "the candle's open, high, low and close", value: example ? `${fmt(example.absolute_open_price)} ${fmt(example.absolute_high_price)} ${fmt(example.absolute_low_price)} ${fmt(example.absolute_close_price)}` : "—" },
                { tex: String.raw`\text{body}`, name: "body length as a fraction of the candle's range", value: fmt(example?.body_fraction_of_range, 3) },
                { tex: String.raw`\text{upper},\ \text{lower}`, name: "each wick as a fraction of the range", value: `${fmt(example?.upper_wick_fraction_of_range, 3)}, ${fmt(example?.lower_wick_fraction_of_range, 3)}` },
                { tex: String.raw`H_{t-k}-L_{t-k}`, name: "range of the bar k minutes earlier; 60 of them are averaged", value: `${fmt(example?.trailing_mean_range_ticks, 1)} ticks average` },
                { tex: String.raw`\text{range ratio}`, name: "this candle's range over that trailing average", value: fmt(example?.range_to_trailing_mean_range_ratio, 2) },
              ]}
              caption="Values shown are the first candle in the list below. The shape cell rounds body, upper and lower down to tenths (0 = under 10 %, 9 = 90 % or more) plus rising / falling."
            />
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-neutral-400"><tr><th className="text-left">Reason</th><th className="text-left">Rule</th><th className="text-right">Bars</th><th className="text-right">Share</th></tr></thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.reason} className={`border-t border-neutral-800 ${controls.reason === rule.reason ? "text-[#E69F00]" : "text-neutral-200"}`}>
                      <td>{REASON_LABELS[rule.reason]}</td>
                      <td className="font-mono">{rule.column} {rule.comparison} {rule.threshold}</td>
                      <td className="text-right font-mono">{fmtInt(rule.bar_count)}</td>
                      <td className="text-right font-mono">{fmt(rule.share_of_bars_percent, 3)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Finding>A rare shape is a cell that took fewer than 4 of the previous 20,000 bars (about 14 sessions) — or had never appeared before.</Finding>
            </div>
          </div>
        </Section>

        <ControlBar onReset={reset}>
          <SelectControl label="Reason" value={controls.reason} onChange={(v) => set("reason", v)}
            options={[{ value: "any", label: "Any reason" }, ...STANDOUT_REASONS.map((r) => ({ value: r, label: REASON_LABELS[r] }))]} />
          <SelectControl label="Trading day" value={controls.weekday} onChange={(v) => set("weekday", v)}
            options={[{ value: "all", label: "Every day" }, ...tradingWeekdays.map((d) => ({ value: d, label: title(d) }))]} />
          <SelectControl label="Month" value={controls.month} onChange={(v) => set("month", v)}
            options={[{ value: "all", label: "Every month" }, ...MONTHS.map((m) => ({ value: m, label: title(m) }))]} />
          <SelectControl label="Sort candles by" value={controls.sort} onChange={(v) => set("sort", v)}
            options={SORT_COLUMNS.map((c) => ({ value: c, label: SORT_LABELS[c] }))} />
          <SliderControl label="Candles listed" value={controls.limit} min={10} max={400} step={10} onChange={(v) => set("limit", v)} />
        </ControlBar>

        <Section title="B. When they happen" question="Counts for the selected reason by trading day, month and New York hour; the bars below divide by how many bars each day or month has.">
          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] text-neutral-400">Trading day × month (count of standouts)</p>
              <Heatmap data={monthMatrix} rowLabels={tradingWeekdays.map(title)} colLabels={MONTHS.map((m) => title(m).slice(0, 3))} colorRange={CIVIDIS} width={560} height={200} />
            </div>
            <div>
              <p className="mb-1 text-[11px] text-neutral-400">Trading day × New York hour (count of standouts)</p>
              <Heatmap data={hourMatrix} rowLabels={tradingWeekdays.map(title)} colLabels={HOURS.map(String)} colorRange={CIVIDIS} width={560} height={200} />
            </div>
            {[{ label: "Standouts per 1,000 bars by trading day", data: byWeekday }, { label: "Standouts per 1,000 bars by month", data: byMonth }].map((chart) => (
              <div key={chart.label}>
                <p className="mb-1 text-[11px] text-neutral-400">{chart.label}</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chart.data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="key" {...AXIS} interval={0} tickFormatter={(v: string) => v.slice(0, 3)} />
                    <YAxis {...AXIS} />
                    <Tooltip {...TOOLTIP} formatter={(value, _name, item) => [`${fmt(Number(value), 2)} per 1,000 (${fmtInt((item.payload as { standouts: number }).standouts)} of ${fmtInt((item.payload as { bars: number }).bars)} bars)`, "rate"]} />
                    <Bar dataKey="rate" fill={OKABE.sky} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </Section>

        <Section title="C. The candles" question={`${fmtInt(body?.rows.length)} of ${fmtInt(body?.matching)} matching standouts, sorted by ${SORT_LABELS[controls.sort as SortColumn]}. Grey bar = trailing average range, to scale; hollow orange = rising, filled blue = falling.`}>
          <div className="grid gap-2 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
            {(body?.rows ?? []).map((row) => (
              <div key={row.timestamp} className="flex gap-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-2 text-[11px]">
                <CandleGlyph row={row} />
                <div className="min-w-0 space-y-0.5">
                  <div className="font-mono text-neutral-100">{fmtTime(row.new_york_time)} New York · {title(row.trading_day_of_week)} · {title(row.month)} {row.year}</div>
                  <div className="text-[#E69F00]">{row.reasons.split(", ").map((r) => REASON_LABELS[r as keyof typeof REASON_LABELS] ?? r).join(" · ")}</div>
                  <div className="text-neutral-300">
                    {row.direction === "rising" ? "▲ rising" : row.direction === "falling" ? "▼ falling" : "◆ flat"} · range {fmt(row.range_ticks, 0)} ticks ({fmt(row.range_to_trailing_mean_range_ratio, 1)}× average) · body {fmt(row.body_ticks, 0)} · upper {fmt(row.upper_wick_ticks, 0)} · lower {fmt(row.lower_wick_ticks, 0)}
                  </div>
                  <div className="text-neutral-400">
                    shape {row.shape_cell} · seen in {fmt(row.trailing_shape_share_percent, 3)}% of the previous 20,000 bars{row.first_occurrence_of_shape ? " · first ever" : ""} · {row.bars_since_session_break} bars after the session opened · {row.contract_symbol}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="D. Every shape the candles took" question="Body (across) against upper wick (up); the lower wick is what is left. Colour = how many bars took the cell (log scale); the number printed is the count when under 50.">
          <ControlBar>
            <SegmentControl label="Direction" value={controls.direction} onChange={(v) => set("direction", v)}
              options={[{ value: "rising", label: "▲ Rising" }, { value: "falling", label: "▼ Falling" }, { value: "flat", label: "◆ Flat" }]} />
          </ControlBar>
          <div className="flex flex-wrap gap-6">
            <ShapeMap catalog={catalog} direction={controls.direction} />
            <div className="text-[11px]">
              <p className="mb-1 text-neutral-400">The 16 rarest cells over the whole span</p>
              <table>
                <tbody>
                  {rarest.map((row) => (
                    <tr key={row.shape_cell} className="border-t border-neutral-800 text-neutral-200">
                      <td className="pr-3 font-mono">{row.shape_cell}</td>
                      <td className="pr-3 text-right font-mono">{fmtInt(row.bar_count)} bars</td>
                      <td className="text-neutral-400">first {fmtTime(row.first_seen).slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        <ColumnGrid rows={body?.sample ?? []} exclude={["timestamp", "new_york_time", "reason_count", "month_number", "year"]} title="E. Every column of the matching standouts" />
      </StudyState>
    </div>
  );
}
