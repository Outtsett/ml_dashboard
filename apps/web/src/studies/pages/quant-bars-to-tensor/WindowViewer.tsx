/**
 * One window of the tensor: position in the window by the six z-scored
 * features, exactly the matrix the model is fed, as a heatmap, six lines or
 * the notebook's table. The slider steps through the windows; the jump buttons
 * land on the train / purge / validation boundaries.
 */

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, GRID, OKABE, SegmentControl, SliderControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import { FEATURE_NAMES, type SplitSummary, type WindowBody } from "@shared/studies/quant-bars-to-tensor";
import { sig, stamp } from "./format";

// Cividis, nine stops from dark blue to yellow (colour-blind safe, sequential).
const CIVIDIS = ["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8678", "#a59c74", "#c3b369", "#e1cc55", "#fee838"];

function cividis(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (CIVIDIS.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(CIVIDIS.length - 1, low + 1);
  const fraction = scaled - low;
  const mix = (a: string, b: string) => {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return `rgb(${pa.map((value, i) => Math.round(value + ((pb[i] as number) - value) * fraction)).join(",")})`;
  };
  return mix(CIVIDIS[low] as string, CIVIDIS[high] as string);
}

const LINE_STYLE: Array<{ color: string; dash?: string }> = [
  { color: OKABE.orange }, { color: OKABE.blue, dash: "6 3" }, { color: OKABE.sky, dash: "2 2" },
  { color: OKABE.purple, dash: "8 3 2 3" }, { color: OKABE.green }, { color: OKABE.yellow, dash: "4 2" },
];

const LABEL_WIDTH = 168;
const CELL_HEIGHT = 26;

function HeatStrip({ window, clip }: { window: WindowBody; clip: number }) {
  const [hover, setHover] = useState<{ position: number; feature: number } | null>(null);
  const columns = window.values.length;
  const cellWidth = Math.max(4, Math.min(28, 640 / Math.max(1, columns)));
  const width = LABEL_WIDTH + columns * cellWidth;
  const height = FEATURE_NAMES.length * CELL_HEIGHT + 22;
  const cell = hover ? window.values[hover.position]?.[hover.feature] : undefined;
  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <svg width={width} height={height} className="font-mono" role="img" aria-label="window heatmap: six features by position in the window" onMouseLeave={() => setHover(null)}>
          {FEATURE_NAMES.map((name, feature) => (
            <g key={name}>
              <text x={LABEL_WIDTH - 6} y={feature * CELL_HEIGHT + CELL_HEIGHT / 2 + 3} textAnchor="end" fontSize={10} className="fill-neutral-400">
                {name.replace(/_fraction_of_range/, "_fraction")}
              </text>
              {window.values.map((row, position) => {
                const value = row[feature] as number;
                const active = hover?.position === position && hover.feature === feature;
                return (
                  <rect
                    key={position}
                    x={LABEL_WIDTH + position * cellWidth}
                    y={feature * CELL_HEIGHT}
                    width={Math.max(1, cellWidth - 1)}
                    height={CELL_HEIGHT - 1}
                    fill={cividis((value + clip) / (2 * clip))}
                    stroke={active ? "#fff" : "none"}
                    strokeWidth={active ? 1.5 : 0}
                    onMouseEnter={() => setHover({ position, feature })}
                  />
                );
              })}
            </g>
          ))}
          {[0, Math.floor((columns - 1) / 2), columns - 1].filter((position, index, all) => all.indexOf(position) === index).map((position) => (
            <text key={position} x={LABEL_WIDTH + position * cellWidth + cellWidth / 2} y={height - 4} textAnchor="middle" fontSize={9} className="fill-neutral-500">
              {position}
            </text>
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span className="flex items-center gap-1 text-neutral-400">
          −{clip}
          <span className="inline-block h-2.5 w-28 rounded-sm" style={{ background: `linear-gradient(to right, ${CIVIDIS.join(",")})` }} />
          +{clip} <span className="text-neutral-500">(z-score, clipped)</span>
        </span>
        <span className="font-mono text-neutral-200">
          {hover && cell !== undefined
            ? `position ${hover.position} · ${stamp(window.timestampsMs[hover.position])} · ${FEATURE_NAMES[hover.feature]} = ${sig(cell)}`
            : "hover a cell for its exact value"}
        </span>
      </div>
    </div>
  );
}

function Lines({ window }: { window: WindowBody }) {
  const data = window.values.map((row, position) => {
    const point: Record<string, number> = { position };
    FEATURE_NAMES.forEach((name, feature) => {
      point[name] = row[feature] as number;
    });
    return point;
  });
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="position" {...AXIS} />
        <YAxis {...AXIS} />
        <Tooltip {...TOOLTIP} formatter={(value) => sig(Number(value))} labelFormatter={(label) => `position ${label}`} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {FEATURE_NAMES.map((name, index) => (
          <Line key={name} dataKey={name} stroke={LINE_STYLE[index]?.color} strokeDasharray={LINE_STYLE[index]?.dash} dot={{ r: 2 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function Table({ window }: { window: WindowBody }) {
  return (
    <div className="max-h-72 overflow-auto rounded border border-neutral-800">
      <table className="w-full text-[11px] font-mono tnum">
        <thead className="sticky top-0 bg-neutral-900">
          <tr className="text-neutral-500">
            <th className="px-2 py-1 text-right font-normal">position_in_window</th>
            <th className="px-2 py-1 text-left font-normal">timestamp</th>
            {FEATURE_NAMES.map((name) => (
              <th key={name} className="px-2 py-1 text-right font-normal">{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {window.values.map((row, position) => (
            <tr key={position} className="border-t border-neutral-900">
              <td className="px-2 py-0.5 text-right text-neutral-400">{position}</td>
              <td className="px-2 py-0.5 text-neutral-400">{stamp(window.timestampsMs[position])}</td>
              {row.map((value, feature) => (
                <td key={FEATURE_NAMES[feature]} className="px-2 py-0.5 text-right text-neutral-200">{sig(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PARTITION_NOTE: Record<WindowBody["partition"], string> = {
  train: "a training window",
  purge: "inside the purge gap: neither trained on nor scored",
  validation: "a validation window",
};

export function WindowViewer({
  window, windowCount, index, onIndex, split, view, onView, clip, onClip,
}: {
  window: WindowBody; windowCount: number; index: number; onIndex: (index: number) => void; split: SplitSummary | null;
  view: string; onView: (view: string) => void; clip: number; onClip: (clip: number) => void;
}) {
  const jumps = split
    ? [
        { label: "first", at: 0 },
        { label: "last train", at: Math.max(0, split.trainEnd - 1) },
        { label: "first validation", at: Math.min(windowCount - 1, split.validationStart) },
        { label: "last", at: windowCount - 1 },
      ]
    : [];
  return (
    <div className="space-y-2">
      <ControlBar>
        <SliderControl label="Window index" value={index} min={0} max={Math.max(1, windowCount - 1)} onChange={onIndex} format={fmtInt} hint="Window i covers usable rows i to i + sequence length - 1; its target is the next row's log return" />
        <div className="flex items-end gap-1">
          <button type="button" onClick={() => onIndex(Math.max(0, index - 1))} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800" aria-label="previous window">◀</button>
          <button type="button" onClick={() => onIndex(Math.min(windowCount - 1, index + 1))} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800" aria-label="next window">▶</button>
          {jumps.map((jump) => (
            <button key={jump.label} type="button" onClick={() => onIndex(jump.at)} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800">{jump.label}</button>
          ))}
        </div>
        <SegmentControl label="View" value={view} options={[{ value: "heatmap", label: "heatmap" }, { value: "lines", label: "lines" }, { value: "table", label: "table" }]} onChange={onView} />
        {view === "heatmap" && (
          <SegmentControl label="Clip at ±" value={clip} options={[{ value: 2, label: "2" }, { value: 3, label: "3" }, { value: 5, label: "5" }]} onChange={onClip} hint="z-scores beyond this saturate the colour" />
        )}
      </ControlBar>
      <p className="text-[11px] text-neutral-400">
        Window {fmtInt(window.windowIndex)} of {fmtInt(windowCount)}: {PARTITION_NOTE[window.partition]}. Ends {stamp(window.endTimestampMs)} at {fmt(window.endClose, 2)};
        the target is the next bar ({stamp(window.targetTimestampMs)}, close {fmt(window.targetClose, 2)}), a log return of{" "}
        <span className="font-mono text-neutral-200">{sig(window.targetLogReturn)}</span>.
        {window.contiguous ? " Every row is a consecutive raw bar." : " A dropped raw bar sits inside this window: its rows are not all adjacent in time."}
      </p>
      {view === "heatmap" && <HeatStrip window={window} clip={clip} />}
      {view === "lines" && <Lines window={window} />}
      {view === "table" && <Table window={window} />}
    </div>
  );
}
