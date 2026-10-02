/**
 * One panel per direction-label column (the labels are binary, so the column
 * grid of numeric histograms skips them): how many bars in the window are
 * down, up and unlabeled, the window's up-rate, and the whole table's up-rate
 * beside it. The baseline moving from under 0.5 to over 0.5 as the horizon
 * grows is the reason a label is graded against its own majority class.
 */

import { useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ControlBar, SegmentControl, SwitchControl, TOOLTIP, fmt, fmtInt, fmtPercent,
} from "@/studies/kit";
import {
  DIRECTION_HORIZONS, directionLabelName, horizonWords, type HorizonSummary, type WindowBars,
} from "@shared/studies/direction-labels-on-candles";
import { DOWN_COLOR, UP_COLOR } from "./DirectionChart";

interface PanelData {
  horizon: number;
  down: number;
  up: number;
  unlabeled: number;
  windowUpRate: number | null;
  tableUpRate: number | null;
}

function panelData(bars: WindowBars, tableByHorizon: Map<number, HorizonSummary>): PanelData[] {
  return DIRECTION_HORIZONS.map((horizon) => {
    const labels = bars.directionLabels[String(horizon)] ?? [];
    let up = 0;
    let down = 0;
    let unlabeled = 0;
    for (const label of labels) {
      if (label === 1) up += 1;
      else if (label === 0) down += 1;
      else unlabeled += 1;
    }
    return {
      horizon, down, up, unlabeled,
      windowUpRate: up + down > 0 ? up / (up + down) : null,
      tableUpRate: tableByHorizon.get(horizon)?.upRate ?? null,
    };
  });
}

export function LabelPanels({ bars, table }: { bars: WindowBars; table: readonly HorizonSummary[] }) {
  const [scale, setScale] = useState<"count" | "share">("count");
  const [order, setOrder] = useState<"horizon" | "gap">("horizon");
  const [showBaseline, setShowBaseline] = useState(true);
  const panels = panelData(bars, new Map(table.map((row) => [row.horizon, row])));
  if (order === "gap") {
    const gap = (panel: PanelData) => Math.abs((panel.windowUpRate ?? 0.5) - (panel.tableUpRate ?? 0.5));
    panels.sort((a, b) => gap(b) - gap(a));
  }

  return (
    <div className="space-y-2">
      <ControlBar>
        <SegmentControl label="Bars shown as" value={scale} options={[{ value: "count", label: "count" }, { value: "share", label: "share" }]} onChange={setScale} />
        <SegmentControl
          label="Order" value={order} onChange={setOrder}
          options={[{ value: "horizon", label: "horizon" }, { value: "gap", label: "window vs table gap" }]}
          hint="Sort by how far the window's up-rate sits from the whole table's"
        />
        <SwitchControl label="Whole-table up-rate" checked={showBaseline} onChange={setShowBaseline} />
      </ControlBar>
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
        {panels.map((panel) => {
          const labeled = panel.up + panel.down;
          const data = [
            { name: "▼ down (0)", value: scale === "share" ? (labeled > 0 ? panel.down / labeled : 0) : panel.down, color: DOWN_COLOR },
            { name: "▲ up (1)", value: scale === "share" ? (labeled > 0 ? panel.up / labeled : 0) : panel.up, color: UP_COLOR },
          ];
          return (
            <div key={panel.horizon} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
              <div className="truncate text-[11px] font-medium text-neutral-200" title={directionLabelName(panel.horizon)}>
                {directionLabelName(panel.horizon)}
              </div>
              <div className="text-[10px] text-neutral-500">{horizonWords(panel.horizon)}</div>
              <ResponsiveContainer width="100%" height={84}>
                <BarChart data={data} layout="vertical" margin={{ top: 2, right: 34, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide domain={scale === "share" ? [0, 1] : [0, "dataMax"]} />
                  <YAxis type="category" dataKey="name" width={62} tick={{ fontSize: 10, fill: "#a3a3a3" }} tickLine={false} axisLine={false} />
                  <Tooltip {...TOOLTIP} formatter={(value) => (scale === "share" ? fmtPercent(Number(value), 2) : fmtInt(Number(value)))} />
                  <Bar dataKey="value" isAnimationActive={false}>
                    {data.map((row) => (
                      <Cell key={row.name} fill={row.color} />
                    ))}
                    <LabelList dataKey="value" position="right" fontSize={10} fill="#d4d4d4" formatter={(value: number) => (scale === "share" ? fmtPercent(value, 1) : fmtInt(value))} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <dl className="mt-1 grid grid-cols-2 gap-x-2 text-[10px] font-mono tnum">
                <dt className="text-neutral-500">window up-rate</dt>
                <dd className="text-right text-neutral-200">{fmt(panel.windowUpRate, 4)}</dd>
                {showBaseline && (
                  <>
                    <dt className="text-neutral-500">whole table</dt>
                    <dd className="text-right text-neutral-200">{fmt(panel.tableUpRate, 4)}</dd>
                  </>
                )}
                <dt className="text-neutral-500">unlabeled bars</dt>
                <dd className="text-right text-neutral-200">{fmtInt(panel.unlabeled)}</dd>
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}
