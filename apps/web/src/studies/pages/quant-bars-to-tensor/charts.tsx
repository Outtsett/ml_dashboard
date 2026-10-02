/**
 * The pipeline's three overview pictures: the continuous series with the share
 * of bars that survive the z-score warmup and the train / purge / validation
 * spans, the split as a proportional bar, and the two baselines side by side.
 */

import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, OKABE, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import type { BaselineSummary, ContractSpan, SplitSummary, TimelinePoint } from "@shared/studies/quant-bars-to-tensor";
import { sig, stamp, stampDay } from "./format";

export function TimelineChart({ points, contracts, split }: { points: readonly TimelinePoint[]; contracts: readonly ContractSpan[]; split: SplitSummary | null }) {
  if (points.length === 0) return null;
  const first = points[0]?.timestampMs ?? 0;
  const last = points[points.length - 1]?.timestampMs ?? first;
  const trainEnd = split?.trainEndTimestampMs ?? null;
  const validationStart = split?.validationStartTimestampMs ?? null;
  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={points as TimelinePoint[]} margin={{ top: 14, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="timestampMs" type="number" scale="time" domain={[first, last]} {...AXIS} tickFormatter={(value: number) => stampDay(value)} />
          <YAxis yAxisId="price" {...AXIS} domain={["auto", "auto"]} tickFormatter={(value: number) => fmtInt(value)} width={52} />
          <YAxis yAxisId="share" orientation="right" domain={[0, 1]} {...AXIS} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} width={40} />
          {trainEnd !== null && <ReferenceArea yAxisId="price" x1={first} x2={trainEnd} fill={OKABE.blue} fillOpacity={0.07} label={{ value: "train windows", fill: OKABE.blue, fontSize: 10, position: "insideTopLeft" }} />}
          {trainEnd !== null && validationStart !== null && (
            <ReferenceArea yAxisId="price" x1={trainEnd} x2={validationStart} fill={OKABE.yellow} fillOpacity={0.3} label={{ value: "purge", fill: OKABE.yellow, fontSize: 10, position: "insideTop" }} />
          )}
          {validationStart !== null && <ReferenceArea yAxisId="price" x1={validationStart} x2={last} fill={OKABE.orange} fillOpacity={0.09} label={{ value: "validation windows", fill: OKABE.orange, fontSize: 10, position: "insideTopLeft" }} />}
          {contracts.slice(1).map((contract) => (
            <ReferenceLine key={contract.contractSymbol} yAxisId="price" x={contract.firstTimestampMs} stroke={OKABE.purple} strokeDasharray="4 3" label={{ value: `roll to ${contract.contractSymbol}`, fill: OKABE.purple, fontSize: 10, position: "insideBottomRight" }} />
          ))}
          <Tooltip
            {...TOOLTIP}
            labelFormatter={(value) => stamp(Number(value))}
            formatter={(value, name) => [name === "usableShare" ? `${(Number(value) * 100).toFixed(1)}%` : fmt(Number(value), 2), name === "usableShare" ? "bars usable" : "close"]}
          />
          <Area yAxisId="share" type="stepAfter" dataKey="usableShare" name="usableShare" stroke={OKABE.sky} fill={OKABE.sky} fillOpacity={0.25} strokeDasharray="3 2" isAnimationActive={false} />
          <Line yAxisId="price" dataKey="close" name="close" stroke={OKABE.blue} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.blue }}>━ close (front month, not back-adjusted)</span> · <span style={{ color: OKABE.sky }}>┄ share of bars with all six z-scores known (right axis)</span> ·{" "}
        <span style={{ color: OKABE.purple }}>┆ contract roll</span>
      </p>
    </div>
  );
}

export function SplitBar({ split, windowCount }: { split: SplitSummary; windowCount: number }) {
  const total = Math.max(1, windowCount);
  const segments = [
    { key: "train", label: "train", count: split.trainWindowCount, background: OKABE.blue, text: "#fff", pattern: undefined as string | undefined },
    { key: "purge", label: "purge", count: split.purgeWindowCount, background: OKABE.yellow, text: "#000", pattern: "repeating-linear-gradient(45deg, rgba(0,0,0,0.35) 0 3px, transparent 3px 7px)" },
    { key: "validation", label: "validation", count: split.validationWindowCount, background: OKABE.orange, text: "#000", pattern: undefined },
  ];
  const purgeShown = Math.min(split.purgeWindowCount, windowCount - split.trainEnd);
  return (
    <div className="space-y-1">
      <div className="flex h-9 overflow-hidden rounded border border-neutral-700" role="img" aria-label="train, purge and validation windows in proportion">
        {segments.map((segment) => {
          const count = segment.key === "purge" ? purgeShown : segment.count;
          return (
            <div
              key={segment.key}
              className="flex min-w-[2px] items-center justify-center overflow-hidden text-[10px] font-semibold"
              style={{ width: `${(count / total) * 100}%`, background: segment.background, backgroundImage: segment.pattern, color: segment.text }}
              title={`${segment.label}: ${fmtInt(count)} windows (${((count / total) * 100).toFixed(2)}%)`}
            >
              {count / total > 0.08 ? `${segment.label} ${fmtInt(count)}` : ""}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-neutral-500">
        <span>window 0</span>
        <span>train ends at {fmtInt(split.trainEnd)}</span>
        <span>validation starts at {fmtInt(split.validationStart)}</span>
        <span>{fmtInt(windowCount)}</span>
      </div>
    </div>
  );
}

export function BaselineChart({ baseline }: { baseline: BaselineSummary }) {
  const rows = [
    { name: "predict zero", value: baseline.zeroPredictionMeanSquaredError, color: OKABE.blue, note: "MSE of always forecasting no move: the variance of the target around zero" },
    { name: "copy last return (notebook)", value: baseline.persistenceMeanSquaredError, color: OKABE.orange, note: "MSE of the z-scored last return scaled by std(target) / std(last return)" },
    { name: "best scaled copy", value: baseline.bestScaledCopyMeanSquaredError, color: OKABE.sky, note: "MSE of the least-squares multiple of the last return, no intercept (not in the notebook)" },
  ];
  const floor = Math.min(...rows.map((row) => row.value));
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 70, left: 8, bottom: 4 }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" {...AXIS} domain={[0, "auto"]} tickFormatter={(value: number) => value.toExponential(1)} />
        <YAxis type="category" dataKey="name" width={170} {...AXIS} interval={0} />
        <ReferenceLine x={floor} stroke={OKABE.grey} strokeDasharray="4 3" />
        <Tooltip
          {...TOOLTIP}
          content={({ payload }) => {
            const row = payload?.[0]?.payload as (typeof rows)[number] | undefined;
            if (!row) return null;
            return (
              <div style={TOOLTIP.contentStyle} className="max-w-xs space-y-0.5 px-2 py-1 text-[11px]">
                <div className="font-semibold">{row.name}</div>
                <div>mean squared error {sig(row.value)}</div>
                <div className="text-neutral-400">{row.note}</div>
              </div>
            );
          }}
        />
        <Bar dataKey="value" isAnimationActive={false} label={{ position: "right", fill: "#d4d4d4", fontSize: 10, formatter: (value: number) => sig(value) }}>
          {rows.map((row) => (
            <Cell key={row.name} fill={row.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
