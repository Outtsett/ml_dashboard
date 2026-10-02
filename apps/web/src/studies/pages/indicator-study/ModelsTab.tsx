/**
 * Section 6 (candlestick patterns as direction calls) and section 7 (a
 * walk-forward logistic on every indicator against three baselines).
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Empty, Finding, GRID, OKABE, Section, StudyNotes, StudyState, SwitchControl, TOOLTIP, fmt, fmtInt, fmtTime, useStudyQuery } from "@/studies/kit";
import { WALK_FORWARD_MODELS, type CallsBody, type HitRateRow, type WalkForwardBody, type WalkForwardFoldRow, type WalkForwardSummaryRow } from "@shared/studies/indicator-study";
import { timeframeOf } from "./controls";
import type { TabProps } from "./Page";
import { DataTable, DotWhisker, LegendRow, glyphPath, type Column, type GlyphShape, type WhiskerRow } from "./widgets";

const CLAIM_STYLE: Record<string, { color: string; shape: GlyphShape }> = {
  up: { color: OKABE.orange, shape: "triangle-up" },
  down: { color: OKABE.blue, shape: "triangle-down" },
  "candle colour": { color: OKABE.purple, shape: "square" },
  none: { color: OKABE.grey, shape: "diamond" },
};

function isCalls(data: unknown): data is CallsBody {
  return typeof data === "object" && data !== null && "rows" in data && !("comparison" in data);
}

export function CallsTab({ controls, set }: TabProps) {
  const timeframe = timeframeOf(controls);
  const query = useStudyQuery<unknown>("indicator-study", { part: "calls", timeframe, horizon: controls.horizon });
  const body = isCalls(query.data?.data) ? query.data.data : null;
  const rows = (body?.rows ?? []).filter((row) => !controls.reportableOnly || row.reportable);
  const ordered = [...rows].sort((a, b) => (a.probability_up_given_signal ?? 0) - (b.probability_up_given_signal ?? 0));
  const base = rows[0];
  const whiskers: WhiskerRow[] = ordered.map((row) => ({
    key: `${row.column_name}|${row.signal_side}`,
    label: `${row.column_name}  [${row.signal_side}]`,
    value: row.probability_up_given_signal,
    low: row.probability_up_given_signal_lower_95,
    high: row.probability_up_given_signal_upper_95,
    ...(CLAIM_STYLE[row.claimed_direction] ?? CLAIM_STYLE.none as { color: string; shape: GlyphShape }),
    hollow: !row.reportable,
    details: [
      `claimed direction ${row.claimed_direction} · ${row.pattern_semantics ?? ""}`,
      `signal bars ${fmtInt(row.signal_bar_count)}${row.reportable ? "" : " (fewer than 30: too few to read)"}`,
      `share higher ${row.horizon_bars} bar(s) later ${fmt(row.probability_up_given_signal, 3)} [${fmt(row.probability_up_given_signal_lower_95, 3)}, ${fmt(row.probability_up_given_signal_upper_95, 3)}]`,
      `hit rate in the claimed direction ${fmt(row.hit_rate_in_claimed_direction, 3)}`,
      `base rate up ${fmt(row.base_rate_up, 3)} · permutation p ${fmt(row.permutation_p_value, 4)}`,
    ],
  }));
  const reportable = rows.filter((row) => row.reportable);
  const outside = reportable.filter((row) => base && row.probability_up_given_signal_lower_95 !== null && row.probability_up_given_signal_upper_95 !== null && (row.probability_up_given_signal_lower_95 > (base.base_rate_up_upper_95 ?? 1) || row.probability_up_given_signal_upper_95 < (base.base_rate_up_lower_95 ?? 0)));
  return (
    <Section title="6 · Candlestick patterns as direction calls" question="For each pattern and sign, the share of signal bars whose close was higher h bars later, against the share of ALL bars that were: the base rate, not 0.5. A bearish claim is right when that share is below the base rate.">
      <div className="space-y-2">
        <ControlBar>
          <SwitchControl label="Only patterns with at least 30 signal bars" checked={controls.reportableOnly} onChange={(value) => set("reportableOnly", value)} />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={query.data?.notes ?? []} />
          {whiskers.length > 0 && base ? (
            <>
              <Finding>
                {timeframe}, h = {controls.horizon}: base rate of a higher close {fmt(base.base_rate_up, 3)} [{fmt(base.base_rate_up_lower_95, 3)}, {fmt(base.base_rate_up_upper_95, 3)}].{" "}
                {fmtInt(reportable.length)} pattern-signs have 30 or more signal bars; {fmtInt(outside.length)} of them have an interval entirely outside the base rate&apos;s.
              </Finding>
              <LegendRow
                items={[
                  ...Object.entries(CLAIM_STYLE).map(([claim, style]) => ({ label: `claims ${claim}`, ...style })),
                  { label: "hollow = fewer than 30 signal bars", color: "#d4d4d4", shape: "circle" as const, hollow: true },
                  { label: "white rule and grey band = base rate and its 95% interval", color: "#f5f5f5" },
                ]}
              />
              <DotWhisker
                rows={whiskers}
                domain={[0, 1]}
                axisLabel="share of signal bars with a higher close h bars later"
                references={[{ value: base.base_rate_up ?? 0.5, color: "#f5f5f5" }]}
                band={[base.base_rate_up_lower_95 ?? 0, base.base_rate_up_upper_95 ?? 1]}
                rowHeight={15}
              />
              <DataTable
                rows={rows}
                rowKey={(row) => `${row.column_name}|${row.signal_side}`}
                initialSort={{ key: "permutation_p_value" }}
                pageSize={12}
                columns={HIT_RATE_COLUMNS}
              />
            </>
          ) : (
            <Empty>No pattern reaches 30 signal bars here.</Empty>
          )}
        </StudyState>
      </div>
    </Section>
  );
}

const HIT_RATE_COLUMNS = ([
  "column_name", "signal_side", "claimed_direction", "pattern_semantics", "signal_bar_count", "reportable", "probability_up_given_signal",
  "probability_up_given_signal_lower_95", "probability_up_given_signal_upper_95", "hit_rate_in_claimed_direction", "base_rate_up", "permutation_p_value",
] as const).map((key) => ({
  key,
  label: key,
  value: (row: HitRateRow) => row[key] as string | number | boolean | null,
  numeric: !["column_name", "signal_side", "claimed_direction", "pattern_semantics", "reportable"].includes(key),
}));

// ── section 7 ──────────────────────────────────────────────────────────────

const SUMMARY_COLUMNS: Array<Column<WalkForwardSummaryRow>> = ([
  "model_name", "mean_area_under_roc_curve", "worst_fold_area_under_roc_curve", "best_fold_area_under_roc_curve", "mean_log_loss", "mean_accuracy",
  "independent_window_count", "fold_count", "null_mean_area_under_roc_curve_95th_percentile", "mean_area_under_roc_curve_permutation_p_value",
] as const).map((key) => ({
  key,
  label: key,
  value: (row: WalkForwardSummaryRow) => row[key],
  numeric: key !== "model_name",
  format: key === "model_name" ? undefined : (value: unknown) => (key === "fold_count" ? fmtInt(value as number) : fmt(value as number, 4)),
}));

const MODEL_STYLE: Record<string, { color: string; shape: GlyphShape }> = {
  "logistic on every indicator": { color: OKABE.orange, shape: "diamond" },
  "logistic on last log return": { color: OKABE.blue, shape: "square" },
  "last bar direction persists": { color: OKABE.purple, shape: "triangle-up" },
  "base rate": { color: OKABE.grey, shape: "circle" },
};

function isWalkForward(data: unknown): data is WalkForwardBody {
  return typeof data === "object" && data !== null && "folds" in data;
}

function GlyphDot({ cx, cy, shape, color, hollow = false }: { cx?: number; cy?: number; shape: GlyphShape; color: string; hollow?: boolean }) {
  if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return <path d={glyphPath(shape, cx, cy, 9)} fill={hollow ? "none" : color} stroke={color} strokeWidth={1.4} />;
}

function NullTick({ cx, cy, color }: { cx?: number; cy?: number; color: string }) {
  if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return <rect x={cx - 9} y={cy - 2} width={18} height={4} fill="none" stroke={color} strokeWidth={1.4} />;
}

function FoldTooltip({ folds, metric, label }: { folds: WalkForwardFoldRow[]; metric: "area_under_roc_curve" | "log_loss"; label?: number | string }) {
    const rows = folds.filter((fold) => String(fold.fold_number) === String(label));
    if (!rows.length) return null;
    return (
      <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
        <div className="font-semibold">fold {label} · test {fmtTime(rows[0]?.test_start_timestamp)} to {fmtTime(rows[0]?.test_end_timestamp)} UTC</div>
        {rows.map((fold) => (
          <div key={fold.model_name} style={{ color: MODEL_STYLE[fold.model_name]?.color }}>
            {fold.model_name}: {metric === "area_under_roc_curve" ? `AUC ${fmt(fold.area_under_roc_curve, 4)} (null 95th ${fmt(fold.area_under_roc_curve_null_95th_percentile, 4)}, p ${fmt(fold.area_under_roc_curve_permutation_p_value, 4)})` : `log loss ${fmt(fold.log_loss, 4)}`}
            {` · accuracy ${fmt(fold.accuracy, 4)} · windows ${fmt(fold.independent_window_count, 1)} · train ${fmtInt(fold.train_bar_count)} / test ${fmtInt(fold.test_bar_count)}`}
            {fold.chosen_inverse_regularization !== null ? ` · C ${fold.chosen_inverse_regularization.toExponential(0)}` : ""}
          </div>
        ))}
      </div>
    );
}

export function WalkForwardTab({ controls }: TabProps) {
  const timeframe = timeframeOf(controls);
  const query = useStudyQuery<unknown>("indicator-study", { part: "walkForward", timeframe, horizon: controls.horizon });
  const body = isWalkForward(query.data?.data) ? query.data.data : null;
  const folds = body?.folds ?? [];
  const foldNumbers = [...new Set(folds.map((fold) => fold.fold_number))].sort((a, b) => a - b);
  const data = foldNumbers.map((fold) => {
    const row: Record<string, number | null> = { fold };
    for (const entry of folds.filter((item) => item.fold_number === fold)) {
      row[entry.model_name] = entry.area_under_roc_curve;
      row[`${entry.model_name} null`] = entry.area_under_roc_curve_null_95th_percentile;
      row[`${entry.model_name} loss`] = entry.log_loss;
    }
    return row;
  });
  const models = WALK_FORWARD_MODELS.filter((model) => folds.some((fold) => fold.model_name === model));
  const every = body?.summary.find((row) => row.model_name === "logistic on every indicator");
  return (
    <Section
      title="7 · Walk-forward: every indicator at once"
      question="L2 logistic regression on every transformed indicator plus a bullish and a bearish flag per pattern. The first half of the bars seeds the training window, the second half is cut into test folds, the last h training bars are purged before each fold, and regularisation is picked inside the training fold. Every AUC has its own null: the fold's test labels shifted circularly against the model's fixed predictions."
    >
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {folds.length > 0 ? (
          <div className="space-y-2">
            {every && (
              <Finding>
                {timeframe}, h = {controls.horizon}: the logistic on every indicator averages AUC {fmt(every.mean_area_under_roc_curve, 4)} over {every.fold_count} folds (worst{" "}
                {fmt(every.worst_fold_area_under_roc_curve, 4)}, best {fmt(every.best_fold_area_under_roc_curve, 4)}); shuffled labels reach a mean AUC of{" "}
                {fmt(every.null_mean_area_under_roc_curve_95th_percentile, 4)} at their 95th percentile, p = {fmt(every.mean_area_under_roc_curve_permutation_p_value, 4)}. With
                overlapping h-bar labels a fold holds only test bars ÷ h independent windows, which is why the null tick sits far above 0.5 at 4 hours.
              </Finding>
            )}
            <LegendRow items={[...models.map((model) => ({ label: model, ...(MODEL_STYLE[model] as { color: string; shape: GlyphShape }) })), { label: "hollow bar = that model's null 95th percentile", color: "#d4d4d4", shape: "square" as const, hollow: true }, { label: "0.5", color: "#f5f5f5", dash: true }]} />
            <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="fold" {...AXIS} label={{ value: "test fold (later is right)", position: "insideBottom", offset: -8, fill: "#bdbdbd", fontSize: 10 }} />
                  <YAxis domain={["auto", "auto"]} {...AXIS} tickFormatter={(value: number) => fmt(value, 2)} label={{ value: "out-of-sample AUC", angle: -90, position: "insideLeft", fill: "#bdbdbd", fontSize: 10 }} />
                  <ReferenceLine y={0.5} stroke="#f5f5f5" strokeDasharray="4 4" />
                  <Tooltip content={({ label }) => <FoldTooltip folds={folds} metric="area_under_roc_curve" label={label as number | string | undefined} />} />
                  {models.map((model) => {
                    const style = MODEL_STYLE[model] as { color: string; shape: GlyphShape };
                    return <Line key={model} dataKey={model} stroke={style.color} strokeWidth={1.6} isAnimationActive={false} dot={(props: { cx?: number; cy?: number; index?: number }) => <GlyphDot key={`${model}-${props.index}`} cx={props.cx} cy={props.cy} shape={style.shape} color={style.color} />} />;
                  })}
                  {models.map((model) => {
                    const style = MODEL_STYLE[model] as { color: string; shape: GlyphShape };
                    return <Line key={`${model} null`} dataKey={`${model} null`} stroke="none" isAnimationActive={false} activeDot={false} dot={(props: { cx?: number; cy?: number; index?: number }) => <NullTick key={`${model}-null-${props.index}`} cx={props.cx} cy={props.cy} color={style.color} />} />;
                  })}
                </LineChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="fold" {...AXIS} label={{ value: "test fold", position: "insideBottom", offset: -8, fill: "#bdbdbd", fontSize: 10 }} />
                  <YAxis domain={["auto", "auto"]} {...AXIS} tickFormatter={(value: number) => fmt(value, 3)} label={{ value: "log loss (lower is better)", angle: -90, position: "insideLeft", fill: "#bdbdbd", fontSize: 10 }} />
                  <Tooltip content={({ label }) => <FoldTooltip folds={folds} metric="log_loss" label={label as number | string | undefined} />} />
                  {models.map((model) => {
                    const style = MODEL_STYLE[model] as { color: string; shape: GlyphShape };
                    return <Line key={model} dataKey={`${model} loss`} name={model} stroke={style.color} strokeWidth={1.6} isAnimationActive={false} dot={(props: { cx?: number; cy?: number; index?: number }) => <GlyphDot key={`${model}-loss-${props.index}`} cx={props.cx} cy={props.cy} shape={style.shape} color={style.color} />} />;
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <DataTable
              rows={body?.summary ?? []}
              rowKey={(row) => row.model_name}
              pageSize={4}
              columns={SUMMARY_COLUMNS}
            />
          </div>
        ) : (
          <Empty>No walk-forward folds at this timeframe and horizon.</Empty>
        )}
      </StudyState>
    </Section>
  );
}
