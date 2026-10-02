/**
 * The study kit: everything a study page builds from. Import from
 * "@/studies/kit" only, so every page shares one look.
 *
 * Charts: Recharts for bars, lines, histograms and scatters (isAnimationActive
 * false); `Heatmap` for matrices; lightweight-charts for price-aligned series.
 * Colours: OKABE only (up/positive orange, down/negative blue), always with a
 * glyph, label or shape as well, never red against green.
 */

import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

export {
  OKABE, AXIS, GRID, TOOLTIP, toneOf, fmt, fmtInt, fmtPercent, fmtUsd, fmtTime,
  Section, Stat, SummaryTable, Histogram, ProbabilityBar, Empty,
} from "@/analytics/common";
export { histogram } from "@shared/analytics/compute";
export { eightNumberSummary } from "@shared/lens/stats";
export { Heatmap } from "@/market/components/Heatmap";
export { ControlBar, SliderControl, SelectControl, SwitchControl, SegmentControl } from "./controls";
export { ColumnGrid } from "./ColumnGrid";
export { Tex, FormulaCard, type FormulaSymbol } from "./Formula";
export { useStudyQuery, useStudyControls, fetchStudy, type StudyBody } from "./useStudy";
export { trendGlyph, trendTone, DATA_COLORS } from "@/shared/theme/dataColors";

/** The server's notes for this response (data not landed, windows capped). */
export function StudyNotes({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border border-[#E69F00]/40 bg-[#E69F00]/5 px-3 py-2">
      {notes.map((note) => (
        <p key={note} className="flex gap-2 text-[11px] text-neutral-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#E69F00]" aria-hidden="true" />
          {note}
        </p>
      ))}
    </div>
  );
}

/** Loading / error / content for one study query. */
export function StudyState({ isLoading, error, children }: { isLoading: boolean; error: unknown; children: ReactNode }) {
  if (error) {
    return (
      <p className="rounded-md border border-[#0072B2]/50 bg-[#0072B2]/10 px-3 py-2 text-xs text-neutral-200">
        {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-xs text-neutral-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Reading the lake…
      </p>
    );
  }
  return <>{children}</>;
}

/** Prose explaining a finding, kept short and beside the chart it explains. */
export function Finding({ children }: { children: ReactNode }) {
  return <p className="max-w-prose text-[12px] leading-relaxed text-neutral-300">{children}</p>;
}
