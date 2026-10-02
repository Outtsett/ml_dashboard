/**
 * ConfusionPanel — V5: how often is the direction right, and why is that not
 * the same as winning trades? A 2x2 direction confusion matrix, toggled
 * between all labelled rows and only rows the threshold actually gates into
 * a trade, plus precision/recall, accuracy and win rate.
 */

import { useState } from "react";
import type { LensConfusion, LensConfusionBlock } from "@shared/lens/types";
import { LensFrame } from "../Frame";
import { CaptionRow, EstimateStat } from "./common";
import { formatEstimate, formatInt, formatPercent } from "./format";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";

export interface ConfusionPanelProps {
  confusion: LensConfusion;
  threshold: number;
}

function Cell({
  label,
  count,
  rowShare,
  columnShare,
  emphasize,
}: {
  label: string;
  count: number;
  rowShare: number | null;
  columnShare: number | null;
  emphasize: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-0.5 rounded-md bg-muted/20 px-2 py-3 text-center"
      style={{ border: emphasize ? "2px solid hsl(var(--foreground))" : "1px solid hsl(var(--border))" }}
      title={`${label}: row share ${rowShare === null ? "—" : formatPercent(rowShare)} · column share ${columnShare === null ? "—" : formatPercent(columnShare)}`}
    >
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono tnum tabular-nums text-lg font-semibold text-foreground">{formatInt(count)}</span>
      <span className="font-mono tnum text-[10px] text-muted-foreground">
        row {rowShare === null ? "—" : formatPercent(rowShare)} · col {columnShare === null ? "—" : formatPercent(columnShare)}
      </span>
    </div>
  );
}

function Matrix({ block, title }: { block: LensConfusionBlock; title: string }) {
  const { counts } = block;
  const predictedUpTotal = counts.truePositive + counts.falsePositive;
  const predictedDownTotal = counts.trueNegative + counts.falseNegative;
  const actualUpTotal = counts.truePositive + counts.falseNegative;
  const actualDownTotal = counts.trueNegative + counts.falsePositive;

  const share = (count: number, rowTotal: number, colTotal: number) => ({
    row: rowTotal > 0 ? count / rowTotal : null,
    col: colTotal > 0 ? count / colTotal : null,
  });

  const tp = share(counts.truePositive, actualUpTotal, predictedUpTotal);
  const fp = share(counts.falsePositive, actualDownTotal, predictedUpTotal);
  const fn = share(counts.falseNegative, actualUpTotal, predictedDownTotal);
  const tn = share(counts.trueNegative, actualDownTotal, predictedDownTotal);

  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title} — n={formatInt(block.n)}</p>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-1 text-xs">
        <div />
        <div className="text-center text-[10px] text-muted-foreground">predicted up</div>
        <div className="text-center text-[10px] text-muted-foreground">predicted down</div>
        <div className="flex items-center text-[10px] text-muted-foreground">actual up</div>
        <Cell label="True positive" count={counts.truePositive} rowShare={tp.row} columnShare={tp.col} emphasize />
        <Cell label="False negative" count={counts.falseNegative} rowShare={fn.row} columnShare={fn.col} emphasize={false} />
        <div className="flex items-center text-[10px] text-muted-foreground">actual down</div>
        <Cell label="False positive" count={counts.falsePositive} rowShare={fp.row} columnShare={fp.col} emphasize={false} />
        <Cell label="True negative" count={counts.trueNegative} rowShare={tn.row} columnShare={tn.col} emphasize />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span>precision (up) {block.precisionUp === null ? "—" : formatPercent(block.precisionUp)}</span>
        <span>recall (up) {block.recallUp === null ? "—" : formatPercent(block.recallUp)}</span>
        <span>precision (down) {block.precisionDown === null ? "—" : formatPercent(block.precisionDown)}</span>
        <span>recall (down) {block.recallDown === null ? "—" : formatPercent(block.recallDown)}</span>
      </div>
    </div>
  );
}

export function ConfusionPanel({ confusion, threshold }: ConfusionPanelProps) {
  const [view, setView] = useState<"all" | "gated">("gated");
  const block = view === "all" ? confusion.allRows : confusion.gatedRows;
  const accuracy = formatEstimate(block.accuracy, (v) => formatPercent(v), 0.5);
  const winRate = formatEstimate(confusion.winRate, (v) => formatPercent(v), 0.5);

  return (
    <LensFrame
      resizeKey="confusion"
      defaultHeight={520}
      title="Direction confusion"
      question="How often is the direction right, and why is that not the same as winning trades?"
      basis={`threshold ${threshold.toFixed(3)} · all rows n=${formatInt(confusion.allRows.n)} · gated rows n=${formatInt(confusion.gatedRows.n)}`}
      testId="lens-confusion"
      actions={
        <ToggleGroup type="single" size="sm" value={view} onValueChange={(v) => v && setView(v as "all" | "gated")}>
          <ToggleGroupItem value="all" data-testid="lens-confusion-all">
            All rows
          </ToggleGroupItem>
          <ToggleGroupItem value="gated" data-testid="lens-confusion-gated">
            Gated rows
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      <div className="flex flex-col gap-3">
        <Matrix block={block} title={view === "all" ? "Every labelled row (predicted up when probability ≥ 0.5)" : "Rows the threshold gates into a trade"} />
        <div className="flex flex-wrap gap-2">
          <EstimateStat label="Accuracy" estimate={accuracy} testId="lens-confusion-accuracy" />
          <EstimateStat label="Win rate" estimate={winRate} testId="lens-confusion-win-rate" />
        </div>
        <CaptionRow>{confusion.explanation}</CaptionRow>
      </div>
    </LensFrame>
  );
}
