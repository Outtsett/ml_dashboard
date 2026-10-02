/**
 * Section 2 of the audit: the direction label's majority-class baseline per
 * horizon and per calendar year, and what the flat dead zone throws away.
 */

import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, TOOLTIP, fmt, fmtInt, fmtPercent,
} from "@/studies/kit";
import { DIRECTION_HORIZONS, NOTEBOOK_FLAT_THRESHOLDS, type LabelAuditBody } from "@shared/studies/label-audit-1m";
import { DataTable, Legend } from "./parts";

type Direction = LabelAuditBody["direction"];

function majoritySide(upRate: number | null): string {
  if (upRate === null) return "—";
  return upRate >= 0.5 ? "▲ up" : "▼ down";
}

function sideColor(upRate: number | null): string {
  if (upRate === null) return OKABE.grey;
  return upRate >= 0.5 ? OKABE.orange : OKABE.blue;
}

export function DirectionSection({ direction, horizon, onHorizon, flatThreshold, onFlatThreshold }: {
  direction: Direction;
  horizon: number;
  onHorizon: (value: number) => void;
  flatThreshold: number;
  onFlatThreshold: (value: number) => void;
}) {
  const horizons = direction.horizons;
  const selected = horizons.find((row) => row.horizon_bars === horizon);
  const flipped = horizons.filter((row) => row.up_rate !== null && row.up_rate < 0.5).map((row) => row.horizon_bars);
  const years = direction.years;
  const yearMajority = years.map((row) => row.majority_baseline ?? Number.NaN).filter(Number.isFinite);
  const yearLow = yearMajority.length > 0 ? Math.min(...yearMajority) : null;
  const yearHigh = yearMajority.length > 0 ? Math.max(...yearMajority) : null;
  const top = Math.max(0.51, ...horizons.map((row) => row.majority_baseline ?? 0), ...years.map((row) => Math.max(row.up_rate ?? 0, row.majority_baseline ?? 0)));
  const bottom = Math.min(0.45, ...horizons.map((row) => row.up_rate ?? 1), ...years.map((row) => row.up_rate ?? 1));
  const flat = direction.flatSelected;
  const curveTop = Math.max(0.25, direction.flatCurveMaximum);

  return (
    <Section title="2 · Direction: the majority-class baseline is not 0.50" question="Share of bars whose close H bars ahead is higher, and the accuracy a model gets for free by always calling the more common side.">
      <ControlBar>
        <SegmentControl label="Horizon H (1m bars)" value={horizon} options={DIRECTION_HORIZONS.map((value) => ({ value, label: String(value) }))} onChange={onHorizon} hint="Drives the per-year chart, the formula and the flat dead zone" />
      </ControlBar>

      <div className="mt-2 grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">Free accuracy with zero skill, by horizon</h4>
          <Legend items={[
            { glyph: "■", label: "majority-class baseline", color: OKABE.sky },
            { glyph: "●", label: "up-rate P(close[t+H] > close[t])", color: OKABE.orange },
            { glyph: "┈", label: "coin flip 0.50", color: OKABE.grey },
          ]} />
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={horizons.map((row) => ({ ...row, label: String(row.horizon_bars) }))} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="label" {...AXIS} label={{ value: "forward horizon H (1m bars)", position: "insideBottom", offset: -2, fill: "#737373", fontSize: 10 }} height={32} />
              <YAxis domain={[Math.floor(bottom * 100) / 100, Math.ceil(top * 100) / 100]} tickFormatter={(value: number) => value.toFixed(2)} {...AXIS} width={40} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as (typeof horizons)[number] | undefined;
                  if (!row) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                      <div className="font-semibold">H = {row.horizon_bars} bars</div>
                      <div>up-rate {fmt(row.up_rate, 4)} · majority {majoritySide(row.up_rate)}</div>
                      <div>majority baseline {fmt(row.majority_baseline, 4)} · free edge {fmt(row.free_edge_over_coin_flip, 4)}</div>
                      <div>{fmtInt(row.valid_bar_count)} labelled bars</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="2 3" />
              <Bar dataKey="majority_baseline" isAnimationActive={false}>
                {horizons.map((row) => (
                  <Cell key={row.horizon_bars} fill={OKABE.sky} fillOpacity={row.horizon_bars === horizon ? 1 : 0.55} stroke={row.horizon_bars === horizon ? "#f5f5f5" : undefined} />
                ))}
                <LabelList dataKey="majority_baseline" position="top" formatter={(value: number) => fmt(value, 4)} fill="#a3a3a3" fontSize={9} />
              </Bar>
              <Line dataKey="up_rate" stroke={OKABE.orange} dot={{ r: 3, fill: OKABE.orange }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <Finding>
            {flipped.length > 0
              ? <>The majority class is <b>down</b> at H = {flipped.join(", ")} and <b>up</b> at every longer horizon, so a fixed "up is the majority" or a fixed 0.50 is wrong at one end or the other. Grade every direction result on accuracy minus max(up-rate, 1 − up-rate), computed on each fold's own training slice.</>
              : <>The majority class is up at every horizon; grade on accuracy minus the majority baseline, never 0.50.</>}
          </Finding>
        </div>

        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">Up-rate by calendar year at H = {horizon}</h4>
          <Legend items={[
            { glyph: "▲", label: "up is the majority", color: OKABE.orange },
            { glyph: "▼", label: "down is the majority", color: OKABE.blue },
            { glyph: "◆┄", label: "majority-class baseline", color: OKABE.purple },
          ]} />
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={years.map((row) => ({ ...row, label: String(row.year) }))} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="label" {...AXIS} label={{ value: "calendar year (UTC)", position: "insideBottom", offset: -2, fill: "#737373", fontSize: 10 }} height={32} />
              <YAxis domain={[Math.floor(bottom * 100) / 100, Math.ceil(top * 100) / 100]} tickFormatter={(value: number) => value.toFixed(2)} {...AXIS} width={40} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as (typeof years)[number] | undefined;
                  if (!row) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                      <div className="font-semibold">{row.year}, H = {horizon}</div>
                      <div>up-rate {fmt(row.up_rate, 4)} · majority {majoritySide(row.up_rate)} {fmt(row.majority_baseline, 4)}</div>
                      <div>{fmtInt(row.valid_bar_count)} labelled bars</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={0.5} stroke={OKABE.grey} strokeDasharray="2 3" />
              <Bar dataKey="up_rate" isAnimationActive={false}>
                {years.map((row) => <Cell key={row.year} fill={sideColor(row.up_rate)} />)}
                <LabelList dataKey="up_rate" position="top" formatter={(value: number) => `${value >= 0.5 ? "▲" : "▼"} ${fmt(value, 3)}`} fill="#a3a3a3" fontSize={9} />
              </Bar>
              <Line dataKey="majority_baseline" stroke={OKABE.purple} strokeDasharray="5 3" dot={{ r: 4, fill: OKABE.purple, strokeWidth: 0 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <Finding>
            At H = {horizon} the per-year majority baseline runs {fmt(yearLow, 4)} to {fmt(yearHigh, 4)}: a drifting baseline is not a constant, so compute it on each fold's training slice rather than once for the whole series.
          </Finding>
        </div>
      </div>

      <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
        <FormulaCard
          tex={"b_H = \\max\\left(p_H,\\ 1 - p_H\\right), \\qquad \\text{skill}_H = a_H - b_H"}
          caption={selected ? `At H = ${horizon}: ${majoritySide(selected.up_rate)} is the majority, so a model must beat ${fmt(selected.majority_baseline, 4)}, not 0.50.` : undefined}
          symbols={[
            { tex: "H", name: "forward horizon, in 1-minute bars", value: String(horizon) },
            { tex: "p_H", name: "up-rate: share of bars whose close H bars ahead is higher", value: fmt(selected?.up_rate, 4) },
            { tex: "1 - p_H", name: "down-rate (ties count as down, as the label does)", value: fmt(selected?.up_rate === null || selected?.up_rate === undefined ? null : 1 - selected.up_rate, 4) },
            { tex: "b_H", name: "majority-class baseline: accuracy for always calling the commoner side", value: fmt(selected?.majority_baseline, 4) },
            { tex: "a_H", name: "a model's accuracy on the same bars (the quantity being graded)", value: "your model" },
            { tex: "\\text{skill}_H", name: "accuracy the model earned beyond the free baseline", value: "a − b" },
          ]}
        />
        <DataTable
          rows={horizons}
          rowKey={(row) => String(row.horizon_bars)}
          highlight={(row) => row.horizon_bars === horizon}
          columns={[
            { header: "horizon (bars)", cell: (row) => fmtInt(row.horizon_bars), align: "right" },
            { header: "labelled bars", cell: (row) => fmtInt(row.valid_bar_count), align: "right" },
            { header: "up-rate", cell: (row) => fmt(row.up_rate, 6), align: "right" },
            { header: "majority", cell: (row) => <span style={{ color: sideColor(row.up_rate) }}>{majoritySide(row.up_rate)}</span> },
            { header: "majority baseline", cell: (row) => fmt(row.majority_baseline, 6), align: "right" },
            { header: "free edge over coin flip", cell: (row) => fmt(row.free_edge_over_coin_flip, 6), align: "right" },
          ]}
        />
      </div>

      <div className="mt-4 space-y-2">
        <h4 className="text-xs font-semibold text-neutral-200">The flat dead zone at H = {horizon}: how much data does flat_threshold_pts throw away?</h4>
        <ControlBar>
          <SliderControl label="Flat threshold (points)" value={Math.min(flatThreshold, curveTop)} min={0} max={curveTop} step={0.25} onChange={onFlatThreshold} format={(value) => `${fmt(value, 2)} pts`} hint="A bar is dropped when |close[t+H] − close[t]| is below this" />
        </ControlBar>
        {flat && (
          <Finding>
            At {fmt(flat.flat_threshold_points, 2)} points the label keeps {fmtInt(flat.kept_bar_count)} bars ({fmtPercent(flat.kept_share, 2)}) and drops {fmtInt(flat.dropped_flat_bar_count)}; among the kept bars the up-rate is {fmt(flat.up_rate_among_kept, 4)}, so the baseline to beat becomes {fmt(flat.up_rate_among_kept === null ? null : Math.max(flat.up_rate_among_kept, 1 - flat.up_rate_among_kept), 4)}.
          </Finding>
        )}
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <Legend items={[
              { glyph: "━", label: "share of bars kept", color: OKABE.sky },
              { glyph: "┅", label: "up-rate among kept bars", color: OKABE.orange },
            ]} />
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={direction.flatCurve} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="flat_threshold_points" type="number" domain={[0, curveTop]} {...AXIS} tickFormatter={(value: number) => fmt(value, 1)} label={{ value: "flat threshold (points)", position: "insideBottom", offset: -2, fill: "#737373", fontSize: 10 }} height={32} />
                <YAxis yAxisId="kept" domain={[0, 1]} tickFormatter={(value: number) => fmtPercent(value, 0)} {...AXIS} width={40} />
                <YAxis yAxisId="up" orientation="right" domain={["auto", "auto"]} tickFormatter={(value: number) => value.toFixed(3)} {...AXIS} width={44} />
                <Tooltip {...TOOLTIP} labelFormatter={(value) => `threshold ${fmt(Number(value), 2)} pts`} formatter={(value, name) => [name === "kept" ? fmtPercent(Number(value), 2) : fmt(Number(value), 4), name === "kept" ? "share kept" : "up-rate among kept"]} />
                <ReferenceLine yAxisId="kept" x={flatThreshold} stroke={OKABE.purple} />
                <Line yAxisId="kept" dataKey="kept_share" name="kept" stroke={OKABE.sky} dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line yAxisId="up" dataKey="up_rate_among_kept" name="up" stroke={OKABE.orange} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] text-neutral-400">The notebook's pinned thresholds ({NOTEBOOK_FLAT_THRESHOLDS.join(", ")} points) at H = {horizon}:</p>
            <DataTable
              rows={direction.flatPinned}
              rowKey={(row) => String(row.flat_threshold_points)}
              columns={[
                { header: "flat threshold (points)", cell: (row) => fmt(row.flat_threshold_points, 2), align: "right" },
                { header: "kept bars", cell: (row) => fmtInt(row.kept_bar_count), align: "right" },
                { header: "kept share", cell: (row) => fmt(row.kept_share, 4), align: "right" },
                { header: "dropped as flat", cell: (row) => fmtInt(row.dropped_flat_bar_count), align: "right" },
                { header: "up-rate among kept", cell: (row) => fmt(row.up_rate_among_kept, 4), align: "right" },
              ]}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}
