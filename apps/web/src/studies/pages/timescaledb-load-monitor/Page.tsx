/**
 * market_bars into TimescaleDB: the monthly load. Every control filters the
 * 179 logged batches in the browser; the server only reads the landed log.
 * Orange is the "more / faster" direction and blue the "less / slower" one,
 * never red against green; lines are told apart by dash and label as well.
 */

import {
  CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, Stat, StudyNotes,
  StudyState, SummaryTable, SwitchControl, TOOLTIP, eightNumberSummary, fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  PANEL_COLUMNS, SUMMARY_COLUMNS, loadProgress, marginalWithinWindow, meanAndDeviation, projectedGigabytes, throughputFit,
  windowBatches, type BatchRow, type LoadMonitorBody, type PanelColumn,
} from "@shared/studies/timescaledb-load-monitor";
import { BatchTable } from "./BatchTable";
import { ColumnPicker } from "./ColumnPicker";
import { monthLabel, yearLabel } from "./format";

const X_KEY = "month_start_epoch_milliseconds";
const REFRESH_OPTIONS = [
  { value: "off", label: "off" },
  { value: "5s", label: "5 s" },
  { value: "15s", label: "15 s" },
  { value: "60s", label: "60 s" },
];
const REFRESH_MILLISECONDS: Record<string, number | undefined> = { off: undefined, "5s": 5_000, "15s": 15_000, "60s": 60_000 };
const DEFAULT_COLUMNS = "lake_row_count,elapsed_seconds,rows_per_second,bytes_per_row";

function parseColumns(raw: string): PanelColumn[] {
  const wanted = new Set(raw.split(","));
  return PANEL_COLUMNS.map((column) => column.key).filter((key) => wanted.has(key));
}

function MonthTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: BatchRow }> }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
      <div className="font-semibold">
        {monthLabel(row.month_start_epoch_milliseconds)} · batch {row.batch_number}
      </div>
      <div>rows {fmtInt(row.lake_row_count)}</div>
      <div>seconds {fmt(row.elapsed_seconds, 1)}</div>
      <div>rows per second {fmtInt(row.rows_per_second)}</div>
      <div>bytes per row {fmt(row.bytes_per_row, 1)}</div>
    </div>
  );
}

function axisNumber(value: number): string {
  return Math.abs(value) >= 1e6 ? value.toExponential(1) : fmt(value, Math.abs(value) < 10 ? 2 : 0);
}

function Panel({ column, rows, logScale }: { column: PanelColumn; rows: BatchRow[]; logScale: boolean }) {
  const label = PANEL_COLUMNS.find((entry) => entry.key === column)?.label ?? column;
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">{label}</div>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={rows} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey={X_KEY} domain={["dataMin", "dataMax"]} tickFormatter={yearLabel} {...AXIS} />
          <YAxis scale={logScale ? "log" : "auto"} domain={["auto", "auto"]} allowDataOverflow={logScale} width={62} {...AXIS} tickFormatter={axisNumber} />
          <Tooltip {...TOOLTIP} content={<MonthTooltip />} />
          <Line type="linear" dataKey={column} stroke={OKABE.orange} strokeWidth={1.5} dot={{ r: 2, fill: OKABE.orange }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    refresh: "off",
    batchFrom: 1,
    batchTo: 0,
    logScale: false,
    columns: DEFAULT_COLUMNS,
    stepBatch: 0,
  });
  const query = useStudyQuery<LoadMonitorBody>("timescaledb-load-monitor", {}, { refetchIntervalMs: REFRESH_MILLISECONDS[controls.refresh] });
  const batches = query.data?.data.batches ?? [];
  const facts = query.data?.data.facts ?? {};
  const count = batches.length;

  const lower = Math.min(Math.max(1, controls.batchFrom), Math.max(1, count));
  const upper = controls.batchTo === 0 ? count : Math.min(Math.max(lower, controls.batchTo), count);
  const windowed = windowBatches(batches, lower, upper);
  const firstWindowed = windowed[0];
  const lastWindowed = windowed[windowed.length - 1];
  const columns = parseColumns(controls.columns);

  const lakeTotalRows = facts.lake_total_row_count ?? 0;
  const sliceMonths = facts.futures_one_second_slice_month_count ?? 0;
  const progress = loadProgress(batches, lakeTotalRows);
  const forexBytesPerRow = facts.forex_proven_bytes_per_row ?? null;
  const failedBytesPerRow = facts.failed_attempt_bytes_per_row ?? null;

  const marginal = marginalWithinWindow(windowed);
  const firstNinetyNine = meanAndDeviation(
    batches.filter((row) => row.batch_number >= 2 && row.batch_number <= 100 && row.marginal_bytes_per_row !== null).map((row) => row.marginal_bytes_per_row as number),
  );
  const throughput = throughputFit(windowed);

  const summaryColumns = SUMMARY_COLUMNS.map((key) => ({
    name: key,
    summary: eightNumberSummary(windowed.map((row) => row[key])),
    decimals: key === "rows_per_second" || key === "lake_row_count" ? 0 : 2,
  }));

  // The formula stepper reads one batch of the window.
  const stepBatch = Math.min(Math.max(controls.stepBatch === 0 ? upper : controls.stepBatch, lower), Math.max(lower, upper));
  const stepIndex = windowed.findIndex((row) => row.batch_number === stepBatch);
  const stepRow = stepIndex >= 0 ? windowed[stepIndex] : undefined;
  const stepPrevious = stepIndex > 0 ? windowed[stepIndex - 1] : undefined;
  const stepMarginal =
    stepRow && stepPrevious ? (stepRow.hypertable_bytes - stepPrevious.hypertable_bytes) / (stepRow.hypertable_row_count - stepPrevious.hypertable_row_count) : null;

  const fit = throughput?.fit;
  const rowCounts = windowed.map((row) => row.lake_row_count);
  const fitEnds =
    fit && rowCounts.length > 0 ? [Math.min(...rowCounts), Math.max(...rowCounts)].map((x) => ({ x, y: fit.intercept + fit.slope * x })) : null;

  const numericRows = windowed.map((row) => ({
    lake_row_count: row.lake_row_count,
    elapsed_seconds: row.elapsed_seconds,
    rows_per_second: row.rows_per_second,
    hypertable_bytes: row.hypertable_bytes,
    hypertable_row_count: row.hypertable_row_count,
    bytes_per_row: row.bytes_per_row,
    marginal_bytes_per_row: row.marginal_bytes_per_row,
  }));

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        {count === 0 ? (
          <Empty>No load log in the lake yet. Run packages/ml-engine/src/studies/timescaledb_load_monitor/build.py to land it.</Empty>
        ) : (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-6">
              <Stat label="Rows in the serving copy" value={fmtInt(progress.servingRows)} hint={`Last logged batch's cumulative hypertable row count; ${fmtInt(lakeTotalRows)} in the lake`} />
              <Stat
                label="Table complete"
                value={`${fmt(progress.completePercent, 1)}%`}
                tone={progress.remainingRows === 0 ? OKABE.orange : OKABE.blue}
                hint={progress.remainingRows === 0 ? "Matches the lake's row count exactly" : `${fmtInt(progress.remainingRows)} rows left`}
              />
              <Stat
                label="Months measured"
                value={`${count}/${sliceMonths || "?"}`}
                hint={sliceMonths > count ? `${sliceMonths - count} measurement(s) lost to a locked workspace file; the rows themselves landed` : "Every month of the slice"}
              />
              <Stat label="Rows per second" value={fmtInt(progress.meanRowsPerSecond)} hint={`${fmt(progress.elapsedMinutes, 1)} minutes of insert time, mean of the logged rates`} />
              <Stat label="Estimated remaining" value={progress.remainingRows === 0 ? "done" : `${fmt(progress.etaMinutes, 0)} min`} hint="Rows left over the mean rate" />
              <Stat label="Bytes per row" value={`${fmt(progress.bytesPerRow, 1)} B`} hint="Last logged batch's bytes over its rows; predates the index build" />
            </div>
            <p className="text-[11px] text-neutral-500">
              {fmtInt(count)} commits logged, one per month of the futures 1-second slice ({fmtInt(facts.futures_one_second_slice_row_count)} of {fmtInt(lakeTotalRows)} rows).{" "}
              {fmt(progress.servingBytes / 2 ** 30, 0)} GB on disk at the last logged batch (2^30 bytes, as pg_size_pretty labels it).
            </p>

            <Section title="Why one row per month" question="The load's unit of work, and what it cost to learn that.">
              <Finding>
                The slice was the unit of work until 2026-09-12. Futures 1-second is {fmtInt(facts.futures_one_second_slice_row_count)} rows, 90.6% of the table, so one slice meant one INSERT and one transaction. AIStor
                stopped partway through, the transaction rolled back exactly as designed, and the load sat at {fmt(facts.failed_attempt_rolled_back_share, 1)}% with nothing to resume from. Per month the same slice
                is {fmtInt(sliceMonths)} statements, each its own commit, so a failure costs one month.
              </Finding>
            </Section>

            <Section title="Controls" question="Every panel, table and fit below follows this window.">
              <ControlBar onReset={reset}>
                <SegmentControl
                  label="Re-read the log"
                  value={controls.refresh}
                  options={REFRESH_OPTIONS}
                  onChange={(value) => set("refresh", value)}
                  hint="Re-reads the landed log from the lake; the load finished, so nothing new arrives"
                />
                <SliderControl
                  label="From batch"
                  value={lower}
                  min={1}
                  max={Math.max(2, count)}
                  onChange={(value) => {
                    set("batchFrom", value);
                    if (value > upper) set("batchTo", value);
                  }}
                />
                <SliderControl
                  label="To batch"
                  value={upper}
                  min={1}
                  max={Math.max(2, count)}
                  onChange={(value) => {
                    set("batchTo", value >= count ? 0 : value);
                    if (value < lower) set("batchFrom", value);
                  }}
                />
                <SwitchControl label="Log scale the y axes" checked={controls.logScale} onChange={(value) => set("logScale", value)} />
                <ColumnPicker selected={columns} onChange={(next) => set("columns", next.join(","))} />
              </ControlBar>
              <p className="mt-1 text-[11px] text-neutral-400">
                Window: batches {lower} to {upper} ({fmtInt(windowed.length)} months), {firstWindowed ? monthLabel(firstWindowed.month_start_epoch_milliseconds) : "none"} to{" "}
                {lastWindowed ? monthLabel(lastWindowed.month_start_epoch_milliseconds) : "none"}.
              </p>
            </Section>

            <Section title="Every measured column" question="One panel per column of the log: a mean hides the bytes-per-row drift and whichever month ran slow.">
              {columns.length === 0 ? (
                <p className="text-xs text-neutral-500">Pick at least one column to draw.</p>
              ) : (
                <div className="grid gap-2 xl:grid-cols-2">
                  {columns.map((column) => (
                    <Panel key={column} column={column} rows={windowed} logScale={controls.logScale} />
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="The eight numbers, per column"
              question="Mean and standard deviation describe a Gaussian and a load is not one: a stalled month shows in the skewness and the maximum long before it moves the mean."
            >
              <SummaryTable columns={summaryColumns} />
              <Finding>Skewness and excess kurtosis are the bias-corrected sample forms (DuckDB's and the dashboard's), and read as missing below 3 and 4 batches.</Finding>
            </Section>

            <Section title="Where the size goes" question="The page-packing lesson, measured rather than asserted.">
              <Finding>
                The first attempt used TimescaleDB's default 7-day chunks and loaded slice by slice, which sprayed thin layers of rows across all {fmtInt(facts.failed_attempt_chunk_count)} chunks: pages ended about 15% full,
                the heap carried {fmtInt(failedBytesPerRow)} bytes for a 125-byte tuple, and {fmtInt(lakeTotalRows)} rows projected to {fmtInt(facts.failed_attempt_projected_gigabytes)} GB against{" "}
                {fmtInt(facts.failed_attempt_free_gigabytes)} GB free. Every per-row check passed the whole time. One-month chunks plus inserting in timestamp order fixed it; the line below is what the load achieved.
              </Finding>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={windowed} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis type="number" dataKey={X_KEY} domain={["dataMin", "dataMax"]} tickFormatter={yearLabel} {...AXIS} />
                  <YAxis domain={["auto", "auto"]} scale={controls.logScale ? "log" : "auto"} allowDataOverflow={controls.logScale} {...AXIS} width={52} tickFormatter={(value: number) => fmt(value, 0)} />
                  <Tooltip {...TOOLTIP} content={<MonthTooltip />} />
                  {forexBytesPerRow !== null && (
                    <ReferenceLine
                      y={forexBytesPerRow}
                      stroke={OKABE.green}
                      strokeDasharray="6 4"
                      strokeWidth={2}
                      ifOverflow="extendDomain"
                      label={{ value: `${forexBytesPerRow} proven on forex (dashed)`, fill: OKABE.green, fontSize: 10, position: "insideTopRight" }}
                    />
                  )}
                  <Line type="linear" dataKey="bytes_per_row" name="bytes per row" stroke={OKABE.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-neutral-400">
                <span style={{ color: OKABE.blue }}>━ measured bytes per row</span> · <span style={{ color: OKABE.green }}>╍ {forexBytesPerRow} proven on forex</span>
              </p>
              <Finding>
                At the current <strong>{fmt(progress.bytesPerRow, 1)} bytes/row</strong> the full {fmtInt(lakeTotalRows)} rows land in{" "}
                <strong>{fmt(projectedGigabytes(lakeTotalRows, progress.bytesPerRow), 0)} GB</strong>; at {fmtInt(failedBytesPerRow)} it would have been{" "}
                <strong>{fmt(projectedGigabytes(lakeTotalRows, failedBytesPerRow ?? 0), 0)} GB</strong>, against {fmt(facts.free_gigabytes_on_e_drive, 1)} GB free on E:. The {fmtInt(failedBytesPerRow)} is off this chart's
                scale by design.
              </Finding>
            </Section>

            <Section title="Cumulative against marginal" question="The cumulative line climbs and, read alone, looks like a leak; the marginal line says how big a row really is.">
              <ControlBar>
                <SliderControl
                  label="Step batch k"
                  value={stepBatch}
                  min={lower}
                  max={Math.max(lower + 1, upper)}
                  onChange={(value) => set("stepBatch", value)}
                  hint="Step through the window and watch each symbol take its value"
                />
              </ControlBar>
              <FormulaCard
                tex={"m_k=\\frac{B_k-B_{k-1}}{R_k-R_{k-1}}\\qquad c_k=\\frac{B_k}{R_k}"}
                caption={
                  stepMarginal !== null && stepRow
                    ? `Batch ${stepRow.batch_number} (${monthLabel(stepRow.month_start_epoch_milliseconds)}): the batch added ${fmt(stepMarginal, 1)} bytes per row it added; the table as a whole holds ${fmt(stepRow.bytes_per_row, 1)}.`
                    : "Step to a batch after the first of the window."
                }
                symbols={[
                  { tex: "k", name: "batch number: which monthly commit", value: stepRow ? String(stepRow.batch_number) : "none" },
                  { tex: "B_k", name: "hypertable size on disk after batch k, bytes", value: stepRow ? fmtInt(stepRow.hypertable_bytes) : "none" },
                  { tex: "R_k", name: "rows in the hypertable after batch k", value: stepRow ? fmtInt(stepRow.hypertable_row_count) : "none" },
                  { tex: "B_k-B_{k-1}", name: "bytes the batch added", value: stepRow && stepPrevious ? fmtInt(stepRow.hypertable_bytes - stepPrevious.hypertable_bytes) : "none" },
                  { tex: "R_k-R_{k-1}", name: "rows the batch added", value: stepRow && stepPrevious ? fmtInt(stepRow.hypertable_row_count - stepPrevious.hypertable_row_count) : "none" },
                  { tex: "m_k", name: "marginal bytes per row: what this month's rows cost", value: stepMarginal !== null ? fmt(stepMarginal, 2) : "none" },
                  { tex: "c_k", name: "cumulative bytes per row: the whole table's average", value: stepRow ? fmt(stepRow.bytes_per_row, 2) : "none" },
                ]}
              />
              {marginal.length < 1 ? (
                <p className="text-xs text-neutral-500">Needs at least two batches in the window.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={marginal} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
                    <CartesianGrid {...GRID} />
                    <XAxis type="number" dataKey={X_KEY} domain={["dataMin", "dataMax"]} tickFormatter={yearLabel} {...AXIS} />
                    <YAxis domain={["auto", "auto"]} scale={controls.logScale ? "log" : "auto"} allowDataOverflow={controls.logScale} {...AXIS} width={52} tickFormatter={(value: number) => fmt(value, 0)} />
                    <Tooltip
                      {...TOOLTIP}
                      content={({ active, payload }) => {
                        const row = active ? (payload?.[0]?.payload as (typeof marginal)[number] | undefined) : undefined;
                        if (!row) return null;
                        return (
                          <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                            <div className="font-semibold">
                              {monthLabel(row.month_start_epoch_milliseconds)} · batch {row.batch_number}
                            </div>
                            <div>marginal bytes per row {fmt(row.marginal_bytes_per_row, 1)}</div>
                            <div>cumulative bytes per row {fmt(row.bytes_per_row, 1)}</div>
                          </div>
                        );
                      }}
                    />
                    {stepRow && <ReferenceLine x={stepRow.month_start_epoch_milliseconds} stroke={OKABE.purple} strokeDasharray="2 3" />}
                    <Line type="linear" dataKey="marginal_bytes_per_row" name="marginal" stroke={OKABE.orange} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="linear" dataKey="bytes_per_row" name="cumulative" stroke={OKABE.blue} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
              <p className="text-[11px] text-neutral-400">
                <span style={{ color: OKABE.orange }}>━ marginal (solid)</span> · <span style={{ color: OKABE.blue }}>╍ cumulative (dashed)</span> · purple dotted: the stepped batch
              </p>
              <Finding>
                Marginal flat, cumulative rising toward it: convergence, not growth. Over batches 2 to 100 the marginal density is{" "}
                <strong>
                  {fmt(firstNinetyNine.mean, 1)} ± {fmt(firstNinetyNine.deviation, 1)}
                </strong>{" "}
                bytes/row ({firstNinetyNine.count} months); the notebook quoted {fmt(facts.marginal_bytes_per_row_first_99_months, 1)} ± {fmt(facts.marginal_bytes_per_row_first_99_months_spread, 1)}.
              </Finding>
            </Section>

            <Section
              title="Throughput against batch size"
              question="Is a bigger month proportionally slower, or is there a fixed per-statement cost that makes small months look bad? The slope answers it; the residual points out a month that stalled."
            >
              {fit && fitEnds ? (
                <>
                  <FormulaCard
                    tex={"t_k=a+b\\,R^{\\text{month}}_k,\\qquad b=\\frac{S_{xy}}{S_{xx}},\\quad a=\\bar t-b\\,\\bar R"}
                    caption={`Ordinary least squares on ${fit.n} months (the dashboard's regression module, statsmodels parity): each extra million rows costs ${fmt(fit.slope * 1e6, 2)} seconds, and a statement costs ${fmt(fit.intercept, 2)} seconds before it carries any row.`}
                    symbols={[
                      { tex: "t_k", name: "elapsed seconds for batch k's INSERT", value: "per month" },
                      { tex: "R^{\\text{month}}_k", name: "rows in month k (from the lake)", value: "per month" },
                      { tex: "b", name: "slope: seconds per row", value: `${(fit.slope * 1e6).toFixed(3)} s per million rows` },
                      { tex: "a", name: "intercept: fixed seconds per statement", value: `${fmt(fit.intercept, 2)} s` },
                      { tex: "S_{xy},\\,S_{xx}", name: "cross-product and sum of squares of the row count, about their means", value: `S_xx ${fit.sumSquaresX.toExponential(3)}` },
                      { tex: "R^2", name: "share of the seconds' variance the rows explain", value: fit.rSquared === null ? "none" : fmt(fit.rSquared, 4) },
                      { tex: "n", name: "months in the window", value: fmtInt(fit.n) },
                    ]}
                  />
                  <ResponsiveContainer width="100%" height={320}>
                    <ScatterChart margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
                      <CartesianGrid {...GRID} />
                      <XAxis type="number" dataKey="lake_row_count" name="rows in the month" domain={["auto", "auto"]} {...AXIS} tickFormatter={(value: number) => `${fmt(value / 1e6, 1)}M`} />
                      <YAxis type="number" dataKey="elapsed_seconds" name="elapsed seconds" domain={["auto", "auto"]} {...AXIS} width={44} />
                      <Tooltip {...TOOLTIP} cursor={{ strokeDasharray: "3 3" }} content={<MonthTooltip />} />
                      <ReferenceLine segment={[fitEnds[0] as { x: number; y: number }, fitEnds[1] as { x: number; y: number }]} stroke={OKABE.purple} strokeWidth={2} ifOverflow="extendDomain" />
                      <Scatter name="months" data={windowed} fill={OKABE.sky} fillOpacity={0.8} isAnimationActive={false} />
                    </ScatterChart>
                  </ResponsiveContainer>
                  <p className="text-[11px] text-neutral-400">
                    <span style={{ color: OKABE.sky }}>● one month</span> · <span style={{ color: OKABE.purple }}>━ least-squares fit</span>
                  </p>
                  <Finding>
                    Slope {(fit.slope * 1e6).toFixed(3)} seconds per million rows and intercept {fmt(fit.intercept, 2)} seconds:{" "}
                    {fit.rSquared !== null ? `${fmt(fit.rSquared * 100, 1)}% of the variance in elapsed time is the month's size` : "the fit has no variance to explain"}. Slowest against the line (residual
                    seconds): {throughput?.slowest.map((row) => `${monthLabel(row.month_start_epoch_milliseconds)} ${row.residual_seconds >= 0 ? "+" : ""}${fmt(row.residual_seconds, 1)}`).join(" · ")}.
                  </Finding>
                </>
              ) : (
                <p className="text-xs text-neutral-500">Needs at least four batches in the window.</p>
              )}
            </Section>

            <Section title="Every column, as a distribution" question="Each logged column, and the derived marginal density, as its own histogram with its eight numbers, for the batches in the window.">
              <ColumnGrid rows={numericRows} />
            </Section>

            <Section title="Every batch, as committed">
              <BatchTable rows={windowed} />
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
