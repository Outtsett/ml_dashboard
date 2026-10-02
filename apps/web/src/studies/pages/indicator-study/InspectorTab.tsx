/**
 * Section 2: step through every bar a pattern fired on, with the numbers
 * TA-Lib's rule compared (the candle's body and shadows against the
 * CandleSettings trailing averages) and, for six patterns, an independent
 * re-implementation's verdict beside TA-Lib's.
 */

import { ControlBar, Empty, Finding, FormulaCard, OKABE, Section, SelectControl, StudyNotes, StudyState, fmt, fmtInt, fmtTime, useStudyQuery } from "@/studies/kit";
import type { InspectorBody, InspectorRow } from "@shared/studies/indicator-study";
import { CandleChart } from "./CandleChart";
import { timeframeOf } from "./controls";
import type { TabProps } from "./Page";
import { CommitSlider, DataTable, LegendRow, type Column } from "./widgets";

function isInspector(data: unknown): data is InspectorBody {
  return typeof data === "object" && data !== null && "occurrenceCount" in data;
}

const THRESHOLD_COLUMNS: Array<keyof InspectorRow> = [
  "open", "high", "low", "close", "real_body", "upper_shadow", "lower_shadow", "high_low_range", "body_long_or_short_threshold",
  "body_doji_threshold", "shadow_very_short_threshold", "shadow_short_threshold", "near_threshold",
];

export function InspectorTab({ controls, set, overview }: TabProps) {
  const timeframe = timeframeOf(controls);
  const counts = overview?.patternFiringCounts ?? [];
  const pattern = counts.some((row) => row.column_name === controls.inspectorPattern) ? controls.inspectorPattern : (counts[0]?.column_name ?? controls.inspectorPattern);
  const query = useStudyQuery<unknown>("indicator-study", { part: "inspector", timeframe, pattern, context: controls.context, occurrence: controls.occurrence }, { enabled: overview !== null });
  const body = isInspector(query.data?.data) ? query.data.data : null;
  const row = overview?.catalogue.find((entry) => entry.column_name === pattern);
  const bar = body?.barIndex ?? null;
  const current = body?.rows.find((entry) => entry.bar_index === bar) ?? null;

  const table = (body?.rows ?? []).filter((entry) => bar !== null && entry.bar_index >= bar - 3 && entry.bar_index <= bar);
  const columns: Array<Column<InspectorRow>> = [
    { key: "bar_index", label: "bar_index", value: (entry) => entry.bar_index, numeric: true },
    { key: "timestamp", label: "bar open (UTC)", value: (entry) => entry.timestamp, format: (value) => fmtTime(value as number) },
    { key: "talib_value", label: "talib_value", value: (entry) => entry.talib_value, numeric: true },
    ...(body?.hasReference ? [{ key: "independent_reimplementation", label: "independent_reimplementation", value: (entry: InspectorRow) => entry.independent_reimplementation, numeric: true }] : []),
    ...THRESHOLD_COLUMNS.map((key) => ({ key, label: key, value: (entry: InspectorRow) => entry[key] as number | null, numeric: true, format: (value: unknown) => fmt(value as number | null, 4) })),
  ];

  return (
    <div className="space-y-3">
      <Section title="2 · Pattern inspector: step through every firing" question="The table gives the numbers TA-Lib's rule actually compared: each candle's real body and shadows, and the CandleSettings thresholds, trailing averages over the bars BEFORE the one being judged.">
        <div className="space-y-2">
          <ControlBar>
            <SelectControl
              label="Pattern"
              value={pattern}
              options={counts.map((entry) => ({ value: entry.column_name, label: `${entry.column_name}  (${fmtInt(entry.firing_count)} bars)` }))}
              onChange={(value) => {
                set("inspectorPattern", value);
                set("occurrence", 1);
              }}
            />
            <CommitSlider label="Bars of context each side" value={controls.context} min={5} max={60} onCommit={(value) => set("context", value)} />
            <CommitSlider
              label={`Occurrence (of ${fmtInt(body?.occurrenceCount ?? 0)})`}
              value={Math.min(controls.occurrence, Math.max(1, body?.occurrenceCount ?? 1))}
              min={1}
              max={Math.max(1, body?.occurrenceCount ?? 1)}
              onCommit={(value) => set("occurrence", value)}
              wide
            />
          </ControlBar>
          <StudyState isLoading={query.isLoading} error={query.error}>
            <StudyNotes notes={query.data?.notes ?? []} />
            {body && body.rows.length > 0 && bar !== null ? (
              <>
                <Finding>
                  <strong>{row?.talib_function}</strong> — {row?.semantics_description ?? "no semantics recorded"}.{" "}
                  {body.hasReference
                    ? "An independent re-implementation from the C source exists for this pattern; its verdict is in the table beside TA-Lib's."
                    : "No independent re-implementation for this one; the thresholds below are the inputs its rule compares."}{" "}
                  Occurrence {fmtInt(body.occurrence)} is bar {fmtInt(bar)} ({fmtTime(current?.timestamp)} UTC), TA-Lib value {fmt(current?.talib_value, 0)}.
                </Finding>
                <LegendRow
                  items={[
                    { label: "the pattern's bar and the two before it", color: OKABE.yellow, shape: "square" },
                    { label: "every firing of this pattern in view (value above the bar)", color: OKABE.vermillion, shape: "square" },
                  ]}
                />
                <CandleChart
                  bars={body.rows.map((entry) => ({ ...entry }))}
                  showVolume={false}
                  bands={body.rows.filter((entry) => entry.bar_index >= bar - 2 && entry.bar_index <= bar).map((entry) => ({ bar_index: entry.bar_index, color: "rgba(240,228,66,0.3)" }))}
                  markers={body.rows
                    .filter((entry) => (entry.talib_value ?? 0) !== 0)
                    .map((entry) => ({ bar_index: entry.bar_index, shape: "square" as const, position: "aboveBar" as const, color: OKABE.vermillion, text: String(entry.talib_value) }))}
                  height={320}
                />
                <DataTable rows={table} columns={columns} rowKey={(entry) => String(entry.bar_index)} pageSize={4} />
                {current && (
                  <FormulaCard
                    tex={"T_i = \\phi \\cdot \\frac{1}{P}\\sum_{k=1}^{P} R_{i-k} \\quad(\\div 2\\ \\text{for the two-shadow range}),\\qquad \\text{fires when } |C_i - O_i| \\lessgtr T_i"}
                    caption="TA_CANDLEAVERAGE: a CandleSettings threshold is the mean of a range over the P bars strictly before bar i, times a factor. A period of 0 means the bar's own range."
                    symbols={[
                      { tex: "i", name: "the bar being judged (this occurrence)", value: `bar ${fmtInt(bar)}` },
                      { tex: "|C_i - O_i|", name: "real body: |close − open| of bar i, index points", value: fmt(current.real_body, 2) },
                      { tex: "R", name: "the range the setting averages: real body, high − low, or the two shadows", value: `high − low ${fmt(current.high_low_range, 2)}` },
                      { tex: "P", name: "bars averaged: 10 for BodyLong / BodyDoji / ShadowVeryShort / ShadowShort, 5 for Near", value: "10 or 5" },
                      { tex: "\\phi", name: "factor: BodyLong 1.0, BodyDoji 0.1, ShadowVeryShort 0.1, ShadowShort 1.0, Near 0.2", value: "per setting" },
                      { tex: "T^{BodyLong}_i", name: "body long-or-short threshold (mean real body of the 10 bars before)", value: fmt(current.body_long_or_short_threshold, 4) },
                      { tex: "T^{BodyDoji}_i", name: "doji threshold (0.1 × mean high − low range)", value: fmt(current.body_doji_threshold, 4) },
                      { tex: "T^{ShadowVeryShort}_i", name: "very short shadow threshold (0.1 × mean high − low range)", value: fmt(current.shadow_very_short_threshold, 4) },
                      { tex: "T^{ShadowShort}_i", name: "short shadow threshold (mean of the two shadows ÷ 2)", value: fmt(current.shadow_short_threshold, 4) },
                      { tex: "T^{Near}_i", name: "near threshold (0.2 × mean high − low range of 5 bars)", value: fmt(current.near_threshold, 4) },
                    ]}
                  />
                )}
              </>
            ) : (
              <Empty>This pattern never fires at {timeframe}.</Empty>
            )}
          </StudyState>
        </div>
      </Section>
      <Section title="Independent re-implementation against TA-Lib, every bar, every timeframe" question="Six patterns transcribed from TA-Lib's C source without TA-Lib; agreement is counted over every bar.">
        <DataTable
          rows={overview?.independentCheck ?? []}
          rowKey={(entry) => `${entry.timeframe}|${entry.talib_function}`}
          pageSize={18}
          columns={[
            { key: "timeframe", label: "timeframe", value: (entry) => entry.timeframe },
            { key: "talib_function", label: "talib_function", value: (entry) => entry.talib_function },
            { key: "compared_bar_count", label: "compared_bar_count", value: (entry) => entry.compared_bar_count, numeric: true },
            { key: "agreeing_bar_count", label: "agreeing_bar_count", value: (entry) => entry.agreeing_bar_count, numeric: true },
            { key: "agreement_percent", label: "agreement_percent", value: (entry) => entry.agreement_percent, numeric: true, format: (value) => fmt(value as number, 4) },
            { key: "talib_signal_bar_count", label: "talib_signal_bar_count", value: (entry) => entry.talib_signal_bar_count, numeric: true },
            { key: "reference_signal_bar_count", label: "reference_signal_bar_count", value: (entry) => entry.reference_signal_bar_count, numeric: true },
          ]}
        />
      </Section>
    </div>
  );
}
