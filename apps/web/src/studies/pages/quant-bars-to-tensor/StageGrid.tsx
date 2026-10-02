/**
 * Every column of every frame the pipeline builds, each as its own histogram
 * with its eight numbers: the raw bars, the six features, their z-scores and
 * the target. The server sends a 120-bin histogram per column over its 0.1th to
 * 99.9th percentile; the bin control merges adjacent bins, so re-binning never
 * asks the server again. Counts outside the drawn range are stated, not hidden.
 */

import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ControlBar, OKABE, SegmentControl, SelectControl, SwitchControl, TOOLTIP, fmtInt } from "@/studies/kit";
import { HISTOGRAM_BIN_CHOICES, mergeBins, type ColumnPanel, type PipelineStage } from "@shared/studies/quant-bars-to-tensor";
import { sig } from "./format";

const STAGE_COLOR: Record<PipelineStage, string> = {
  "raw bars": OKABE.sky,
  "feature vector": OKABE.orange,
  "z-scored features": OKABE.blue,
  "windowed target": OKABE.purple,
};
const STAGE_GLYPH: Record<PipelineStage, string> = {
  "raw bars": "■",
  "feature vector": "▲",
  "z-scored features": "◆",
  "windowed target": "●",
};

type StageFilter = "all" | PipelineStage;
type SortKey = "pipeline" | "skewness" | "kurtosis";

const SUMMARY_ROWS: Array<[keyof ColumnPanel["summary"], string]> = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "sd"], ["skewness", "skew"],
  ["kurtosis", "kurt"], ["percentile25", "p25"], ["percentile75", "p75"], ["minimum", "min"], ["maximum", "max"],
];

function Panel({ panel, bins, logScale }: { panel: ColumnPanel; bins: number; logScale: boolean }) {
  const { histogram, summary } = panel;
  const color = STAGE_COLOR[panel.stage];
  const merged = histogram ? mergeBins(histogram.counts, bins) : [];
  const width = histogram ? (histogram.upper - histogram.lower) / Math.max(1, merged.length) : 0;
  const data = merged.map((count, index) => ({
    index,
    count,
    shown: logScale ? Math.log10(count + 1) : count,
    lower: (histogram?.lower ?? 0) + index * width,
    upper: (histogram?.lower ?? 0) + (index + 1) * width,
  }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-neutral-200" title={`${panel.name}: ${panel.description}`}>{panel.name}</span>
        <span className="shrink-0 text-[10px]" style={{ color }} title={panel.stage}>{STAGE_GLYPH[panel.stage]} {panel.stage}</span>
      </div>
      <p className="mb-1 truncate text-[10px] text-neutral-500" title={panel.description}>{panel.description}</p>
      {histogram ? (
        <ResponsiveContainer width="100%" height={92}>
          <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
            <XAxis dataKey="index" hide />
            <YAxis hide />
            <Tooltip
              {...TOOLTIP}
              formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "bars"]}
              labelFormatter={(_label, payload) => {
                const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                return bin ? `${sig(bin.lower)} to ${sig(bin.upper)}` : "";
              }}
            />
            <Bar dataKey="shown" fill={color} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="flex h-[92px] items-center text-[11px] text-neutral-500">no finite value</p>
      )}
      {histogram && (
        <div className="flex justify-between font-mono text-[9px] text-neutral-500">
          <span>{sig(histogram.lower)}</span>
          <span title="values outside the drawn range (0.1th to 99.9th percentile)">
            outside: {fmtInt(histogram.below)} below, {fmtInt(histogram.above)} above
          </span>
          <span>{sig(histogram.upper)}</span>
        </div>
      )}
      <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[10px] font-mono tnum">
        <dt className="col-span-3 text-neutral-500">n {fmtInt(summary.count)}</dt>
        {SUMMARY_ROWS.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-1">
            <span className="text-neutral-500">{label}</span>
            <span className="text-neutral-200">{sig(summary[key] as number | null)}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function StageGrid({ panels }: { panels: readonly ColumnPanel[] }) {
  const [stage, setStage] = useState<StageFilter>("all");
  const [bins, setBins] = useState<number>(30);
  const [logScale, setLogScale] = useState(false);
  const [order, setOrder] = useState<SortKey>("pipeline");
  const [filter, setFilter] = useState("");

  const shown = panels
    .filter((panel) => stage === "all" || panel.stage === stage)
    .filter((panel) => panel.name.toLowerCase().includes(filter.toLowerCase()));
  if (order !== "pipeline") {
    shown.sort((a, b) => Math.abs(b.summary[order] ?? 0) - Math.abs(a.summary[order] ?? 0));
  }

  return (
    <div className="space-y-2">
      <ControlBar>
        <SegmentControl
          label="Stage"
          value={stage}
          options={[
            { value: "all", label: "all" },
            { value: "raw bars", label: "bars" },
            { value: "feature vector", label: "features" },
            { value: "z-scored features", label: "z-scores" },
            { value: "windowed target", label: "target" },
          ]}
          onChange={setStage}
        />
        <SelectControl label="Bins" value={String(bins)} options={HISTOGRAM_BIN_CHOICES.map((choice) => ({ value: String(choice), label: String(choice) }))} onChange={(value) => setBins(Number(value))} />
        <SwitchControl label="Log counts" checked={logScale} onChange={setLogScale} />
        <SegmentControl
          label="Sort by"
          value={order}
          options={[{ value: "pipeline", label: "pipeline" }, { value: "skewness", label: "|skew|" }, { value: "kurtosis", label: "|kurt|" }]}
          onChange={setOrder}
        />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Filter</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="column name"
            className="h-7 w-36 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
          />
        </label>
      </ControlBar>
      {shown.length === 0 ? (
        <p className="text-xs text-neutral-500">No column matches.</p>
      ) : (
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
          {shown.map((panel) => (
            <Panel key={panel.name} panel={panel} bins={bins} logScale={logScale} />
          ))}
        </div>
      )}
    </div>
  );
}
