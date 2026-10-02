/**
 * Section 6: learning, epoch by epoch and batch by batch. Training loss, the
 * held-out direction accuracy against the majority-class baseline (dashed),
 * and the loss on every eighth batch across all epochs. The table under them
 * is the best epoch; the verdict is its skill over the baseline, because
 * beating 50% is not the bar, beating the majority class is.
 */

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ColumnGrid, Finding, FormulaCard, GRID, OKABE, Section, Stat, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import { skillOverMajority, type BatchLossRow, type EpochRow, type TrainingRunRow } from "@shared/studies/training-environment";
import { SERIES_STYLES, markerDot } from "./shared";

export function LearningSection({ epochs, batches, run }: { epochs: EpochRow[]; batches: BatchLossRow[]; run: TrainingRunRow | null }) {
  if (epochs.length === 0) {
    return (
      <Section title="6 · Learning, epoch by epoch and batch by batch" question="Loss, and accuracy against the majority-class baseline.">
        <p className="py-4 text-xs text-neutral-400">Waiting for the first epoch.</p>
      </Section>
    );
  }
  const best = epochs.reduce((top, row) => ((row.direction_accuracy ?? -1) > (top.direction_accuracy ?? -1) ? row : top), epochs[0] as EpochRow);
  const skill = best.direction_accuracy !== null && best.majority_baseline_accuracy !== null ? skillOverMajority(best.direction_accuracy, best.majority_baseline_accuracy) : null;
  const beats = skill !== null && skill > 0;
  const first = epochs[0] as EpochRow;
  const last = epochs[epochs.length - 1] as EpochRow;
  const meanSeconds = epochs.reduce((sum, row) => sum + (row.seconds ?? 0), 0) / epochs.length;
  const [lossStyle, accuracyStyle, baselineStyle] = [SERIES_STYLES[1]!, SERIES_STYLES[0]!, SERIES_STYLES[5]!];
  const axisLabel = (value: string) => ({ value, position: "insideBottom" as const, offset: -2, fill: "#8a8a8a", fontSize: 10 });

  return (
    <Section title="6 · Learning, epoch by epoch and batch by batch" question="Beating 50% is not the bar; beating the majority class is.">
      <div className="space-y-3">
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={epochs} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="epoch" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} {...AXIS} label={axisLabel("epoch")} />
                <YAxis {...AXIS} width={52} domain={["auto", "auto"]} tickFormatter={(value: number) => fmt(value, 5)} />
                <Tooltip {...TOOLTIP} formatter={(value: number) => [fmt(value, 5), "train_loss"]} labelFormatter={(label) => `epoch ${label}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="train_loss" name="training loss" stroke={lossStyle.colour} strokeWidth={2} strokeDasharray={lossStyle.dash} dot={markerDot(lossStyle)} legendType="plainline" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={epochs} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="epoch" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} {...AXIS} label={axisLabel("epoch")} />
                <YAxis {...AXIS} width={52} domain={["auto", "auto"]} tickFormatter={(value: number) => fmt(value, 3)} />
                <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [fmt(value, 4), name]} labelFormatter={(label) => `epoch ${label}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="direction_accuracy" name="direction accuracy" stroke={accuracyStyle.colour} strokeWidth={2} dot={markerDot(accuracyStyle)} legendType="plainline" isAnimationActive={false} />
                <Line dataKey="majority_baseline_accuracy" name="majority-class baseline (dashed)" stroke={baselineStyle.colour} strokeWidth={2} strokeDasharray="6 4" dot={false} legendType="plainline" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {batches.length > 0 && (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={batches} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="step" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false} {...AXIS} label={axisLabel("batch (every 8th, across all epochs)")} />
              <YAxis {...AXIS} width={52} domain={["auto", "auto"]} tickFormatter={(value: number) => fmt(value, 4)} />
              <Tooltip
                {...TOOLTIP}
                formatter={(value: number) => [fmt(value, 5), "batch loss"]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as BatchLossRow | undefined;
                  return row ? `epoch ${row.epoch}, batch ${row.batch} of ${row.batch_count}` : "";
                }}
              />
              <Line dataKey="loss" name="batch loss" stroke={OKABE.blue} strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}

        <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label="Best direction accuracy" value={fmt(best.direction_accuracy, 4)} hint={`at epoch ${best.epoch}`} />
          <Stat label="Majority-class baseline" value={fmt(best.majority_baseline_accuracy, 4)} />
          <Stat label={`Skill ${beats ? "▲" : "▼"}`} value={skill === null ? "—" : `${skill >= 0 ? "+" : ""}${skill.toFixed(4)}`} tone={beats ? OKABE.orange : OKABE.blue} hint={beats ? "beats the baseline" : "does not beat the baseline"} />
          <Stat label="Train loss, first to last" value={`${fmt(first.train_loss, 5)} → ${fmt(last.train_loss, 5)}`} />
          <Stat label="Seconds per epoch" value={fmt(meanSeconds, 1)} />
          <Stat label="Status" value={run?.status === "finished" ? "finished" : "still running"} />
          <Stat label="Best epoch" value={fmtInt(best.epoch)} />
          <Stat label="Epochs seen" value={`${fmtInt(epochs.length)} of ${fmtInt(first.epochs_configured)}`} />
        </div>
        <Finding>
          The best epoch is {fmtInt(best.epoch)}, at accuracy {fmt(best.direction_accuracy, 4)} against a baseline of {fmt(best.majority_baseline_accuracy, 4)}: skill {skill === null ? "unknown" : (skill >= 0 ? "+" : "") + skill.toFixed(4)},{" "}
          <strong>{beats ? "beats the baseline" : "does not beat the baseline"}</strong>. Read the train-loss column against the accuracy column. Loss falling while accuracy sits on the baseline is the model fitting the training set and not generalising — which is a statement about the label and the horizon, not about the encoder.
        </Finding>
        <FormulaCard
          tex={String.raw`\mathrm{skill}=a-m,\qquad m=\max(p_{\uparrow},\,1-p_{\uparrow})`}
          symbols={[
            { tex: "a", name: "direction accuracy on the held-out test split, best epoch", value: fmt(best.direction_accuracy, 4) },
            { tex: "p_{\\uparrow}", name: "share of test bars whose upper barrier was touched first", value: "from the test labels" },
            { tex: "m", name: "majority-class baseline: accuracy of always guessing the commoner class", value: fmt(best.majority_baseline_accuracy, 4) },
            { tex: "\\mathrm{skill}", name: "accuracy above the baseline (positive = beats it)", value: skill === null ? "—" : `${skill >= 0 ? "+" : ""}${skill.toFixed(4)}` },
          ]}
        />
        <ColumnGrid rows={epochs} exclude={["epoch", "epochs_configured"]} title="Every numeric column of the epoch frame" />
      </div>
    </Section>
  );
}
