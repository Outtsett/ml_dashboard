/** The per-fold table (every column) and the per-fold pictures of it. */

import {
  Bar, BarChart, CartesianGrid, Cell, ErrorBar, Legend, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, ControlBar, Finding, GRID, OKABE, Section, SelectControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import type { OosFoldRow } from "@shared/studies/quant-oos-results";
import { type CellKind, formatCell, sci, signGlyph, small } from "./format";

/** Every column of the landed `folds` table, in order, with how its cell reads. */
export const FOLD_COLUMNS: ReadonlyArray<{ key: keyof OosFoldRow; kind: CellKind; note: string }> = [
  { key: "train_window_count", kind: "integer", note: "windows the model trained on (expanding)" },
  { key: "test_window_count", kind: "integer", note: "windows scored, never seen" },
  { key: "train_first_timestamp", kind: "timestamp", note: "first training bar" },
  { key: "train_last_timestamp", kind: "timestamp", note: "last training bar" },
  { key: "test_first_timestamp", kind: "timestamp", note: "first test bar, after the purge gap" },
  { key: "test_last_timestamp", kind: "timestamp", note: "last test bar" },
  { key: "target_scale", kind: "scientific", note: "training-set standard deviation of the target, applied unchanged to test" },
  { key: "train_mean_squared_error", kind: "scientific", note: "model error on its own training windows" },
  { key: "test_mean_squared_error", kind: "scientific", note: "model error on test windows" },
  { key: "zero_prediction_mean_squared_error", kind: "scientific", note: "error of predicting zero: the line to beat" },
  { key: "persistence_mean_squared_error", kind: "scientific", note: "error of copying the last return (rescaled)" },
  { key: "out_of_sample_r_squared", kind: "fixed", note: "1 - model error / predict-zero error" },
  { key: "persistence_r_squared", kind: "fixed", note: "the same for copying the last return" },
  { key: "directional_accuracy", kind: "fixed", note: "share of non-zero targets whose sign was called right" },
  { key: "directional_accuracy_standard_error", kind: "scientific", note: "sqrt(0.25 / non-zero windows)" },
  { key: "information_coefficient", kind: "fixed", note: "Spearman rank correlation of prediction and target" },
  { key: "prediction_standard_deviation", kind: "scientific", note: "spread of the model's forecasts" },
  { key: "target_standard_deviation", kind: "scientific", note: "spread of the realised targets" },
  { key: "in_sample_out_of_sample_gap", kind: "fixed", note: "test error / train error - 1" },
  { key: "gross_mean_return_per_trade", kind: "scientific", note: "log return per trade before cost" },
  { key: "net_mean_return_per_trade", kind: "scientific", note: "log return per trade after the round-turn cost" },
  { key: "trade_count", kind: "integer", note: "one trade per window" },
  { key: "seconds", kind: "fixed", note: "training time" },
];

const NUMERIC_KEYS = FOLD_COLUMNS.filter((column) => column.kind !== "timestamp").map((column) => column.key);

function isKey(value: string): value is keyof OosFoldRow {
  return (NUMERIC_KEYS as string[]).includes(value);
}

function FoldTable({ folds }: { folds: OosFoldRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="w-full min-w-[560px] text-[10px] font-mono tnum">
        <thead>
          <tr className="bg-neutral-900/70 text-neutral-400">
            <th className="sticky left-0 bg-neutral-900 px-2 py-1 text-left font-normal">column</th>
            {folds.map((fold) => (
              <th key={fold.fold_index} className="px-2 py-1 text-right font-normal">fold {fold.fold_index}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FOLD_COLUMNS.map((column) => (
            <tr key={column.key} className="border-t border-neutral-900" title={column.note}>
              <td className="sticky left-0 bg-neutral-950 px-2 py-0.5 text-neutral-400">{column.key}</td>
              {folds.map((fold) => {
                const value = fold[column.key];
                const signed = column.key === "out_of_sample_r_squared" || column.key === "information_coefficient" || column.key === "net_mean_return_per_trade" || column.key === "gross_mean_return_per_trade";
                return (
                  <td key={fold.fold_index} className="whitespace-nowrap px-2 py-0.5 text-right text-neutral-200">
                    {signed && typeof value === "number" ? `${signGlyph(value)} ` : ""}
                    {formatCell(value, column.kind)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function tickOf(value: number): string {
  return Math.abs(value) > 0 && Math.abs(value) < 0.001 ? sci(value, 0) : fmt(value, Math.abs(value) >= 100 ? 0 : 3);
}

export function FoldSection({ folds, column, onColumn }: { folds: OosFoldRow[]; column: string; onColumn: (value: string) => void }) {
  const selected: keyof OosFoldRow = isKey(column) ? column : "out_of_sample_r_squared";
  const values = folds.map((fold) => ({ fold: `fold ${fold.fold_index}`, value: fold[selected] as number }));
  const canBeNegative = values.some((row) => row.value < 0);

  const errors = folds.map((fold) => ({
    index: fold.fold_index,
    accuracy: fold.directional_accuracy,
    whisker: 1.96 * fold.directional_accuracy_standard_error,
    above: fold.directional_accuracy > 0.5,
    standardError: fold.directional_accuracy_standard_error,
  }));

  const mse = folds.map((fold) => ({
    fold: `fold ${fold.fold_index}`,
    model: fold.test_mean_squared_error,
    zero: fold.zero_prediction_mean_squared_error,
    persistence: fold.persistence_mean_squared_error,
  }));

  const worstPersistence = Math.min(...folds.map((fold) => fold.persistence_r_squared));
  const bestR2 = Math.max(...folds.map((fold) => fold.out_of_sample_r_squared));
  const positiveFolds = folds.filter((fold) => fold.out_of_sample_r_squared > 0).length;
  const persistenceRatios = folds.map((fold) => fold.persistence_mean_squared_error / fold.zero_prediction_mean_squared_error);
  const ratioLow = Math.min(...persistenceRatios);
  const ratioHigh = Math.max(...persistenceRatios);

  return (
    <Section title="A. Per-fold results" question="Each fold trains a transformer from scratch on everything before its purge gap and scores the next slice of bars.">
      <div className="space-y-3">
        <FoldTable folds={folds} />
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <h4 className="text-xs font-semibold text-neutral-200">Model error against the two baselines</h4>
            <Finding>
              Predict-zero is the line to beat. Copying the last return is the weaker baseline here: its error is {fmt(ratioLow, 2)} to {fmt(ratioHigh, 2)} times
              predict-zero&apos;s across the folds (R² as low as {fmt(worstPersistence, 3)}), so beating it means nothing.
            </Finding>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={mse} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="fold" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={(v: number) => sci(v, 1)} width={58} domain={[0, "auto"]} />
                <Tooltip {...TOOLTIP} formatter={(value, name) => [sci(Number(value), 4), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="model" name="model" fill={OKABE.sky} isAnimationActive={false} />
                <Bar dataKey="zero" name="predict zero" fill={OKABE.grey} isAnimationActive={false} />
                <Bar dataKey="persistence" name="copy last return" fill={OKABE.purple} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="min-w-0 space-y-1">
            <h4 className="text-xs font-semibold text-neutral-200">Directional accuracy, with ±1.96 standard errors</h4>
            <Finding>
              ▲ above 0.50, ■ at or below it. {errors.filter((row) => row.above).length} of {errors.length} folds sit above the line, and the bars show how little
              that is: the whiskers are about ±{fmt(1.96 * (errors[0]?.standardError ?? 0) * 100, 2)} points wide.
            </Finding>
            <ResponsiveContainer width="100%" height={220}>
              <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid {...GRID} />
                <XAxis type="number" dataKey="index" name="fold" domain={[-0.5, folds.length - 0.5]} ticks={folds.map((fold) => fold.fold_index)} {...AXIS} />
                <YAxis type="number" dataKey="accuracy" name="directional accuracy" domain={[0.49, 0.53]} {...AXIS} tickFormatter={(v: number) => fmt(v, 3)} width={48} />
                <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="4 3" label={{ value: "0.50", fill: OKABE.grey, fontSize: 10, position: "right" }} />
                <Tooltip
                  {...TOOLTIP}
                  content={({ payload }) => {
                    const row = payload?.[0]?.payload as (typeof errors)[number] | undefined;
                    if (!row) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                        <div className="font-semibold">fold {row.index}</div>
                        <div>accuracy {fmt(row.accuracy, 5)}</div>
                        <div>standard error {fmt(row.standardError, 5)}</div>
                        <div>{row.above ? "▲ above 0.50" : "■ at or below 0.50"}</div>
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={errors}
                  isAnimationActive={false}
                  shape={(props: { cx?: number; cy?: number; payload?: { above: boolean } }) => {
                    const { cx = 0, cy = 0, payload } = props;
                    return payload?.above ? (
                      <polygon points={`${cx},${cy - 6} ${cx - 6},${cy + 5} ${cx + 6},${cy + 5}`} fill={OKABE.orange} />
                    ) : (
                      <rect x={cx - 5} y={cy - 5} width={10} height={10} fill={OKABE.blue} />
                    );
                  }}
                >
                  <ErrorBar dataKey="whisker" direction="y" width={6} stroke="#d4d4d4" />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="min-w-0 space-y-1">
          <ControlBar>
            <SelectControl
              label="Inspect any column"
              value={selected}
              options={NUMERIC_KEYS.map((key) => ({ value: key, label: key }))}
              onChange={onColumn}
              hint="Draws the chosen column of the table above, one bar per fold"
            />
            <span className="self-center text-[11px] text-neutral-400">
              {FOLD_COLUMNS.find((entry) => entry.key === selected)?.note}
              {canBeNegative ? " · ▲ orange above zero, ▼ blue below" : ""}
            </span>
          </ControlBar>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={values} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="fold" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={tickOf} width={62} />
              {canBeNegative && <ReferenceLine y={0} stroke={OKABE.grey} />}
              <Tooltip
                {...TOOLTIP}
                formatter={(value) => {
                  const number = Number(value);
                  return [`${signGlyph(number)} ${Math.abs(number) >= 100 ? fmtInt(number) : small(number, 6)}`, selected];
                }}
              />
              <Bar dataKey="value" isAnimationActive={false}>
                {values.map((row) => (
                  <Cell key={row.fold} fill={canBeNegative ? (row.value >= 0 ? OKABE.orange : OKABE.blue) : OKABE.sky} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Finding>
            Out-of-sample R² is above zero in {positiveFolds} of {folds.length} folds and at most {fmt(bestR2, 5)}; R² below zero means the model&apos;s error is larger than predicting zero&apos;s. A model that forecasts nothing lands near R² = 0 and accuracy = 0.50.
          </Finding>
        </div>
      </div>
    </Section>
  );
}
