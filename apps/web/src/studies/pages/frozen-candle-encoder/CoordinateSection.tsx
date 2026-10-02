/**
 * Reason 2: how much of the 256-number embedding do the 61 hard TA-Lib labels
 * already explain? One ridge R-squared per coordinate (fitted on 2024, scored
 * on 2025), landed in the probe table, drawn as a histogram with its mean, a
 * per-coordinate strip, and the formula with the stepped coordinate's value.
 */

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, Histogram, OKABE, SliderControl, Stat, SummaryTable, TOOLTIP,
  eightNumberSummary, fmt, fmtInt, histogram,
} from "@/studies/kit";
import { coordinateSummary, type CoordinateRow } from "@shared/studies/frozen-candle-encoder";

interface Props {
  coordinates: readonly CoordinateRow[];
  bins: number;
  coordinate: number;
  onBins: (value: number) => void;
  onCoordinate: (value: number) => void;
}

export function CoordinateSection({ coordinates, bins, coordinate, onBins, onCoordinate }: Props) {
  if (coordinates.length === 0) {
    return <p className="text-xs text-neutral-500">The ridge R-squared rows are not in the lake yet.</p>;
  }
  const values = coordinates.map((row) => row.share_explained_by_the_61_labels);
  const summary = coordinateSummary(values);
  const eight = eightNumberSummary(values);
  const maxCoordinate = Math.max(...coordinates.map((row) => row.embedding_coordinate));
  const selected = coordinates.find((row) => row.embedding_coordinate === coordinate) ?? coordinates[0];
  const selectedValue = selected?.share_explained_by_the_61_labels ?? null;
  const testRows = coordinates[0]?.test_row_count ?? null;
  const trainRows = coordinates[0]?.train_row_count ?? null;
  const bars = histogram(values, bins);
  const markers = [
    { x: summary.mean ?? 0, label: `mean ${fmt(summary.mean, 3)}`, color: OKABE.purple },
    ...(selectedValue !== null ? [{ x: selectedValue, label: `j=${coordinate}`, color: OKABE.sky }] : []),
  ];

  return (
    <div className="space-y-3">
      <Finding>
        A network that names objects must keep far more than the label (fur, edges, pose), and that surplus is what transfers. Here the label is a fixed arithmetic rule over the open, high, low and close of the same candles the image draws, so nothing forces the bottleneck to keep anything the rules do not use. That is an argument; the honest check is to ask how much of the embedding the 61 labels already explain.
      </Finding>

      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Mean R²" value={fmt(summary.mean, 4)} hint="share of a coordinate the 61 labels explain, averaged over 256 coordinates" tone={OKABE.purple} />
        <Stat label="Median R²" value={fmt(summary.median, 4)} />
        <Stat label="Lowest coordinate" value={fmt(summary.minimum, 4)} />
        <Stat label="Highest coordinate" value={fmt(summary.maximum, 4)} />
      </div>

      <FormulaCard
        tex={"R^2_j \\;=\\; 1 - \\frac{\\sum_i \\left(e_{ij} - \\hat{e}_{ij}\\right)^2}{\\sum_i \\left(e_{ij} - \\bar{e}_j\\right)^2}, \\qquad \\hat{e}_{\\cdot j} = \\mathrm{Ridge}\\!\\left(\\mathrm{labels}_{61}\\right)"}
        caption={selectedValue !== null ? `Coordinate ${coordinate}: the 61 labels explain ${fmt(selectedValue * 100, 1)}% of it. Step j below to watch the value and its place in the histogram move.` : undefined}
        symbols={[
          { tex: "e_{ij}", name: "embedding coordinate: the value of coordinate j for window i (not stored in the lake; only R² is landed)", value: "256 numbers per window" },
          { tex: "\\hat{e}_{ij}", name: "its prediction from the labels: what the 61 TA-Lib values alone say that coordinate should be", value: "ridge, fitted on 2024" },
          { tex: "\\bar{e}_j", name: "the coordinate's mean: the baseline a useless prediction would match", value: "per coordinate" },
          { tex: "R^2_j", name: "share explained: 1.0 means the coordinate is entirely the labels, 0.0 means the labels say nothing about it", value: fmt(selectedValue, 4) },
          { tex: "i", name: "window index, over the held-out 2025 windows", value: `1 to ${fmtInt(testRows)}` },
          { tex: "j", name: "coordinate index, over the embedding's coordinates (fitted on " + fmtInt(trainRows) + " windows from 2024)", value: `${coordinate} of 0 to ${maxCoordinate}` },
        ]}
      />

      <ControlBar>
        <SliderControl label="Coordinate j" value={coordinate} min={0} max={maxCoordinate} onChange={onCoordinate} hint="Step through the 256 coordinates" />
        <SliderControl label="Bins" value={bins} min={10} max={60} step={5} onChange={onBins} />
      </ControlBar>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">Coordinates by share the labels explain</h4>
          <Histogram bins={bars} unit="R²" height={240} markers={markers} />
          <p className="text-[11px] text-neutral-400">
            Each bar counts embedding coordinates. If the embedding were nothing but the labels this would pile up against 1.0; it piles up near 0.2 instead.
          </p>
        </div>
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">R² of every coordinate</h4>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={coordinates as CoordinateRow[]} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={0}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="embedding_coordinate" {...AXIS} interval={31} />
              <YAxis domain={[0, 1]} {...AXIS} width={34} />
              <Tooltip {...TOOLTIP} formatter={(value) => [fmt(Number(value), 4), "R²"]} labelFormatter={(label) => `coordinate ${label}`} />
              <ReferenceLine y={summary.mean ?? 0} stroke={OKABE.purple} strokeDasharray="4 3" />
              <ReferenceLine x={coordinate} stroke={OKABE.sky} />
              <Bar dataKey="share_explained_by_the_61_labels" fill={OKABE.orange} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-neutral-400">
            <span style={{ color: OKABE.purple }}>- - mean</span> · <span style={{ color: OKABE.sky }}>| selected coordinate j</span>
          </p>
        </div>
      </div>

      <SummaryTable columns={[{ name: "share explained (R²)", summary: eight }]} />

      <Finding>
        Mean R² {fmt(summary.mean, 4)}, median {fmt(summary.median, 4)}, from {fmt(summary.minimum, 4)} to {fmt(summary.maximum, 4)}. The argument above is only about a quarter true: the labels explain roughly 25% of the embedding, and about 75% is something else, five-candle geometry the network picked up while learning the rules. The objection that the embedding is "just a smooth version of the 61 columns" was too strong. That makes the next test the one that decides it: the surplus exists, so does it predict anything?
      </Finding>
    </div>
  );
}
