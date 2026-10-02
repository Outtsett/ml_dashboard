/**
 * Calibration: does the model rank outcomes? For each of the four bracket
 * heads the predictions of the chosen trial are sorted by predicted
 * probability and cut into ten equal groups; the picture is the realised win
 * rate of each group against the probability the model claimed, and the mean
 * net points a trade of that group earned.
 */

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CalibrationRow, MultimodalBody } from "@shared/studies/multimodal-model";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, TOOLTIP, fmt, fmtInt, fmtPercent,
} from "@/studies/kit";
import type { TabProps } from "./controls";
import { HEADS, headLabel, headStyle } from "./parts";
import { TrialPicker, WindowControl } from "./TrialDetail";

function baseRate(rows: CalibrationRow[]): number | null {
  const total = rows.reduce((sum, row) => sum + row.row_count, 0);
  if (total === 0) return null;
  return rows.reduce((sum, row) => sum + (row.realised_win_rate ?? 0) * row.row_count, 0) / total;
}

function HeadPanel({ head, rows }: { head: string; rows: CalibrationRow[] }) {
  const style = headStyle(head);
  const base = baseRate(rows);
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">
        <span style={{ color: style.color }}>{style.glyph}</span> {style.label}: realised <span style={{ color: OKABE.sky }}>●━</span> vs predicted <span style={{ color: OKABE.orange }}>◆┅</span>
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={rows} margin={{ top: 6, right: 10, left: 0, bottom: 14 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="decile" {...AXIS} label={{ value: "predicted-probability decile (0 lowest)", position: "insideBottom", offset: -8, fill: "#999", fontSize: 9 }} />
          <YAxis {...AXIS} width={40} domain={["auto", "auto"]} tickFormatter={(value: number) => fmtPercent(value, 0)} />
          {base !== null && <ReferenceLine y={base} stroke={OKABE.grey} strokeDasharray="2 3" />}
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as CalibrationRow | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{style.label}, decile {row.decile}</div>
                  <div>realised win rate {fmtPercent(row.realised_win_rate, 2)}</div>
                  <div>predicted probability {fmtPercent(row.predicted_probability, 2)}</div>
                  <div>mean net {fmt(row.mean_net_points, 3)} points over {fmtInt(row.row_count)} rows</div>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="realised_win_rate" stroke={OKABE.sky} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          <Line
            type="monotone"
            dataKey="predicted_probability"
            stroke={OKABE.orange}
            strokeDasharray="5 3"
            dot={{ r: 3, stroke: OKABE.orange, fill: "#111" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function NetPanel({ head, rows }: { head: string; rows: CalibrationRow[] }) {
  const style = headStyle(head);
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">
        <span style={{ color: style.color }}>{style.glyph}</span> {style.label}: mean net points per row, by decile
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={rows} margin={{ top: 6, right: 10, left: 0, bottom: 4 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="decile" {...AXIS} />
          <YAxis {...AXIS} width={40} tickFormatter={(value: number) => fmt(value, 1)} />
          <ReferenceLine y={0} stroke={OKABE.grey} />
          <Tooltip {...TOOLTIP} formatter={(value: number) => [fmt(value, 3), "mean net points"]} labelFormatter={(label) => `decile ${label}`} />
          <Bar dataKey="mean_net_points" isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.decile} fill={(row.mean_net_points ?? 0) > 0 ? OKABE.orange : OKABE.blue} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Calibration({ controls, set, body }: TabProps & { body: MultimodalBody }) {
  const detail = body.detail;
  const picker = (
    <ControlBar>
      <TrialPicker trials={body.trials} selected={body.selectedRecipe} set={set} />
      <WindowControl controls={controls} set={set} />
    </ControlBar>
  );
  if (!detail || detail.calibration.length === 0) {
    return (
      <div className="space-y-3">
        {picker}
        <Empty>No predictions are landed for this trial.</Empty>
      </div>
    );
  }
  const byHead = new Map<string, CalibrationRow[]>();
  for (const row of detail.calibration) {
    const rows = byHead.get(row.head) ?? [];
    rows.push(row);
    byHead.set(row.head, rows);
  }
  const heads = HEADS.filter((head) => byHead.has(head));

  const formulaHead = byHead.has(controls.calibrationHead) ? controls.calibrationHead : (heads[0] ?? "long_r2");
  const formulaRows = byHead.get(formulaHead) ?? [];
  const n = formulaRows.reduce((sum, row) => sum + row.row_count, 0);
  const position = Math.max(1, Math.round((controls.rank / 100) * n));
  const decile = Math.floor((position * 10) / (n + 1));
  const inDecile = formulaRows.find((row) => row.decile === decile);

  return (
    <div className="space-y-3">
      {picker}
      <Section
        title="Does the model rank outcomes? Realised win rate by predicted-probability decile"
        question="If the model ranks, the blue line climbs from left to right. Flat means the probability carries no information about which brackets win; the dotted grey line is the head's overall win rate."
      >
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          {heads.map((head) => (
            <HeadPanel key={head} head={head} rows={byHead.get(head) ?? []} />
          ))}
        </div>
        <div className="mt-2 space-y-1">
          {heads.map((head) => {
            const rows = byHead.get(head) ?? [];
            const first = rows[0];
            const last = rows[rows.length - 1];
            return (
              <Finding key={head}>
                <span style={{ color: headStyle(head).color }}>{headStyle(head).glyph}</span> <b>{headLabel(head)}</b>: the top decile wins {fmtPercent(last?.realised_win_rate, 1)} against {fmtPercent(first?.realised_win_rate, 1)} for the bottom one
                (the model claimed {fmtPercent(last?.predicted_probability, 1)} and {fmtPercent(first?.predicted_probability, 1)}); mean net {fmt(last?.mean_net_points, 2)} against {fmt(first?.mean_net_points, 2)} points a row.
              </Finding>
            );
          })}
        </div>
      </Section>

      <Section title="Does a higher decile pay?" question="Mean net points after costs of every bracket the head was offered, by decile. A model with an edge earns more in the top deciles than in the bottom ones.">
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          {heads.map((head) => (
            <NetPanel key={head} head={head} rows={byHead.get(head) ?? []} />
          ))}
        </div>
      </Section>

      <Section title="How a row is placed in a decile" question="Sort the head's predictions by probability; a row's decile is its rank scaled into ten groups. Drag the position to see which decile a row lands in.">
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <div className="space-y-2">
            <FormulaCard
              tex={"d_i \\;=\\; \\left\\lfloor \\frac{10 \\, r_i}{n + 1} \\right\\rfloor \\qquad \\widehat{w}_d \\;=\\; \\frac{1}{|G_d|}\\sum_{i \\in G_d} \\mathbf{1}\\!\\left[\\mathrm{net}_i > 0\\right]"}
              symbols={[
                { tex: "d_i", name: "decile of prediction i, from 0 (lowest probability) to 9 (highest)", value: String(decile) },
                { tex: "r_i", name: "rank of prediction i when all of the head's predictions are sorted by probability (1 = lowest); ties broken by row order", value: fmtInt(position) },
                { tex: "n", name: "number of predictions of this head with a probability and an outcome, in the chosen quarters", value: fmtInt(n) },
                { tex: "G_d", name: "the group of predictions in decile d", value: fmtInt(inDecile?.row_count) },
                { tex: "\\widehat{w}_d", name: "realised win rate of group d: the share of its brackets that ended above zero net points", value: fmtPercent(inDecile?.realised_win_rate, 2) },
                { tex: "\\mathrm{net}_i", name: "net points of the bracket offered in prediction i, after costs", value: inDecile ? `mean ${fmt(inDecile.mean_net_points, 3)}` : "—" },
              ]}
              caption={`Head ${headLabel(formulaHead)}. The model's claim for this group was ${fmtPercent(inDecile?.predicted_probability, 2)}.`}
            />
          </div>
          <ControlBar>
            <SegmentControl label="Head" value={formulaHead} options={heads.map((head) => ({ value: head, label: headLabel(head) }))} onChange={(value) => set("calibrationHead", value)} />
            <SliderControl label="Position in the sorted list" value={controls.rank} min={1} max={100} onChange={(value) => set("rank", value)} format={(value) => `${value}%`} />
          </ControlBar>
        </div>
      </Section>

      <Section
        title="Every numeric column of the prediction frame"
        question={`${fmtInt(detail.predictionSample.length)} of ${fmtInt(detail.predictionRowCount)} rows (every k-th by a hash of its own timestamp, so the same rows every time); one panel per column.`}
      >
        <ColumnGrid rows={detail.predictionSample} title="Prediction frame columns" />
      </Section>
    </div>
  );
}
