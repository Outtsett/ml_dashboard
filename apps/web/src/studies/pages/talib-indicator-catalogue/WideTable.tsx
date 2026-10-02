/**
 * The bars themselves: one window of the wide table (bar, timestamp, contract,
 * open, high, low, close, volume and the preset's indicator columns), thirty
 * rows a page with the timestamp frozen on the left. Clicking a column heading
 * draws that column across the whole window above the table.
 */

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Empty, Finding, GRID, OKABE, Section, SelectControl, SliderControl, StudyNotes, StudyState, TOOLTIP,
  fmtInt, fmtTime,
} from "@/studies/kit";
import { BAR_COLUMNS, MAXIMUM_WINDOW_BARS, PRESETS, presetColumns, type CatalogueBody, type Timeframe } from "@shared/studies/talib-indicator-catalogue";
import { asPreset, fmtValue, useWideWindow, type Controls, type SetControl } from "./shared";

const ROWS_PER_PAGE = 30;
const TEXT_COLUMNS = new Set(["timestamp", "contract_symbol"]);

export function WideTable({ catalogue, timeframe, controls, set }: { catalogue: CatalogueBody; timeframe: Timeframe; controls: Controls; set: SetControl }) {
  const barCount = catalogue.summary?.barCount ?? 0;
  const preset = asPreset(controls.preset);
  const windowLength = Math.min(Math.max(10, Math.round(controls.windowLength)), MAXIMUM_WINDOW_BARS);
  const lastStart = Math.max(0, barCount - windowLength);
  const windowStart = Math.min(Math.max(0, Math.round(controls.windowStart)), lastStart);
  const step = barCount > 5000 ? 100 : 10;
  const query = useWideWindow(timeframe, preset, windowStart, windowLength, barCount > 0);
  const body = query.data?.data;
  const rows = body?.rows ?? [];
  const indicatorColumns = body?.indicatorColumns ?? [];
  const numericColumns = [...BAR_COLUMNS, ...indicatorColumns];
  const tableColumns = ["timestamp", "bar", "contract_symbol", ...numericColumns];

  const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const page = Math.min(Math.max(1, Math.round(controls.tablePage)), pages);
  const visible = rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);
  const focus = numericColumns.includes(controls.focus) ? controls.focus : "close";
  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];
  const filled = rows.filter((row) => typeof row[focus] === "number").length;

  return (
    <div className="space-y-3">
      <ControlBar>
        <SelectControl
          label="Which indicator columns"
          value={preset}
          options={PRESETS.map((entry) => ({ value: entry.key, label: `${entry.label} (${presetColumns(catalogue.columns, entry.key).length})` }))}
          onChange={(value) => set("preset", value)}
        />
        <SliderControl
          label="First bar of the window"
          value={windowStart}
          min={0}
          max={Math.max(step, lastStart)}
          step={step}
          onChange={(value) => { set("windowStart", value); set("tablePage", 1); }}
          format={(value) => fmtInt(value)}
          hint={`Bars are numbered from 0 in time order; this bar set has ${fmtInt(barCount)}`}
        />
        <SliderControl
          label="Bars in the window"
          value={windowLength}
          min={10}
          max={MAXIMUM_WINDOW_BARS}
          step={10}
          onChange={(value) => { set("windowLength", value); set("tablePage", 1); }}
          format={(value) => fmtInt(value)}
        />
        <SliderControl label="Table page" value={page} min={1} max={pages} onChange={(value) => set("tablePage", value)} format={(value) => `${value} of ${pages}`} />
      </ControlBar>

      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {rows.length === 0 ? (
          <Empty>The bar set returned no rows for this window.</Empty>
        ) : (
          <>
            <Section
              title={`${focus} across the window`}
              question={`Bars ${fmtInt(windowStart)} to ${fmtInt(windowStart + rows.length - 1)} of ${fmtInt(barCount)} (${fmtTime(Number(firstRow?.timestamp))} to ${fmtTime(Number(lastRow?.timestamp))}, stamped clock). Orange line: the column chosen by clicking a heading in the table below; a gap is a bar with no value (warmup).`}
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="bar" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => fmtInt(value)} label={{ value: "bar index (traded bars, in time order)", position: "insideBottom", offset: -8, fontSize: 10, fill: "#a3a3a3" }} {...AXIS} />
                  <YAxis domain={["auto", "auto"]} width={68} tickFormatter={(value: number) => fmtValue(value)} {...AXIS} />
                  <Tooltip
                    {...TOOLTIP}
                    formatter={(value: number) => [fmtValue(value), focus]}
                    labelFormatter={(_label, payload) => {
                      const row = payload?.[0]?.payload as Record<string, number | string | null> | undefined;
                      return row ? `bar ${fmtInt(Number(row.bar))} · ${fmtTime(Number(row.timestamp))} · ${String(row.contract_symbol)}` : "";
                    }}
                  />
                  <Line dataKey={focus} stroke={OKABE.orange} strokeWidth={1.3} dot={false} isAnimationActive={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
              <Finding>
                {focus} has a value on {fmtInt(filled)} of the {fmtInt(rows.length)} bars in this window. Start the window at bar 0 to see each indicator's warmup as a gap at the left edge; that gap, not
                a zero, is how an unknown value is stored.
              </Finding>
            </Section>

            <Section title="The wide table" question={`${fmtInt(tableColumns.length)} columns: the timestamp (frozen), the bar index, the contract, the five price and volume columns, then ${fmtInt(indicatorColumns.length)} indicator columns. Click a numeric heading to draw it above.`}>
              <div className="max-h-[560px] overflow-auto rounded-md border border-neutral-800">
                <table className="whitespace-nowrap font-mono text-[11px] tnum">
                  <thead className="sticky top-0 z-20 bg-neutral-900 text-neutral-400">
                    <tr>
                      {tableColumns.map((name) => (
                        <th key={name} className={`px-2 py-1 font-normal ${TEXT_COLUMNS.has(name) ? "text-left" : "text-right"} ${name === "timestamp" ? "sticky left-0 z-30 bg-neutral-900" : ""}`}>
                          {numericColumns.includes(name) ? (
                            <button type="button" onClick={() => set("focus", name)} aria-pressed={name === focus} className={name === focus ? "text-[#E69F00] underline" : "hover:text-neutral-100"} title={`Draw ${name} across the window`}>
                              {name}{name === focus ? " ●" : ""}
                            </button>
                          ) : name === "bar" ? "bar index" : name === "contract_symbol" ? "contract symbol" : "timestamp (stamped clock)"}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={String(row.bar)} className="border-t border-neutral-900">
                        {tableColumns.map((name) => {
                          const value = row[name];
                          const shown = name === "timestamp" ? fmtTime(Number(value))
                            : name === "bar" ? fmtInt(Number(value))
                            : typeof value === "number" ? fmtValue(value)
                            : value === null || value === undefined ? "—" : String(value);
                          return (
                            <td key={name} className={`px-2 py-0.5 ${TEXT_COLUMNS.has(name) ? "text-left" : "text-right"} ${name === "timestamp" ? "sticky left-0 z-10 bg-neutral-950 text-neutral-300" : name === focus ? "text-[#E69F00]" : "text-neutral-200"}`}>
                              {shown}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[10px] text-neutral-500">
                Rows {fmtInt((page - 1) * ROWS_PER_PAGE + 1)} to {fmtInt((page - 1) * ROWS_PER_PAGE + visible.length)} of the {fmtInt(rows.length)} in the window. A dash is a bar with no value.
              </p>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
