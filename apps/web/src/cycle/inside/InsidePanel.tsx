/**
 * "Inside the model" — how the fitted fold model turned one bar's inputs into
 * its output, laid out as a flow: the inputs (left), the model's own view of
 * them (middle, one view per `explainKind`, contract `./types.ts`), and the
 * output chain to the ▲ / ▼ the chart shows (right). The flow wraps to a
 * column when the panel is narrow.
 *
 * Which bar: the chart publishes its crosshair (`setInspect(…, "hover")`) and
 * pins a bar on click (`pinInspect`). With nothing hovered or pinned the panel
 * follows the bar the model just read, at most four times a second. ← / → (the
 * buttons or the arrow keys while the panel has focus) pin the neighbouring
 * test bar; "Follow the model" unpins. A Direction / Price toggle picks which
 * of the fold's two models to open.
 *
 * Data: `useExplain.ts` (manifest, the fold's structure, the bar; bars
 * debounced and their neighbours prefetched). Design:
 * `docs/plans/2026-09-26-cycle-catalog-inside-view.md`.
 */
import { useEffect, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Crosshair, Loader2, Pin } from "lucide-react";

import type { CycleExplainRole } from "@shared/cycle/explain";
import { findBarIndex, type CycleBarColumns, type CycleExplainKind } from "@shared/cycle/schema";

import { requestSidePanelWidth } from "@/shared/layout/ResizableSidePanel";
import { cn } from "@/shared/utils/utils";

import { formatTime } from "../format";
import { isCycleActive, useCycleStore, type CycleInspectSource } from "../store";
import { InputsColumn } from "./InputsColumn";
import { OutputChain, type ChartReading } from "./OutputChain";
import { roleWords } from "./trees/treeTypes";
import type { InsideKindViewProps } from "./types";
import {
  ExplainRequestError,
  foldForTimestamp,
  useExplainBar,
  useExplainManifest,
  useExplainStructure,
  usePrefetchBars,
  useThrottledValue,
  useTreeLoader,
  type CycleExplainManifestFold,
} from "./useExplain";

import { CalibrationView } from "./calibration/CalibrationView";
import { LinearView } from "./linear/LinearView";
import { NaiveBayesView } from "./naiveBayes/NaiveBayesView";
import { NeighborsView } from "./neighbors/NeighborsView";
import { NeuralView } from "./neural/NeuralView";
import { StackingView } from "./stacking/StackingView";
import { SupportVectorsView } from "./supportVectors/SupportVectorsView";
import { ObliviousTreesView } from "./trees/ObliviousTreesView";
import { TreesView } from "./trees/TreesView";

/** Following the model's cursor: at most this often. */
export const CURSOR_FOLLOW_MILLISECONDS = 250;

export const KIND_VIEWS: Record<CycleExplainKind, ComponentType<InsideKindViewProps>> = {
  trees: TreesView,
  oblivious_trees: ObliviousTreesView,
  linear: LinearView,
  neighbors: NeighborsView,
  naive_bayes: NaiveBayesView,
  support_vectors: SupportVectorsView,
  calibration: CalibrationView,
  stacking: StackingView,
  neural: NeuralView,
  opaque: OpaqueView,
};

/** A model the explainer cannot open yet: say so, name the model, never guess a picture. */
function OpaqueView({ manifest }: InsideKindViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-xs text-muted-foreground" data-testid="inside-opaque">
      <p>No Inside view exists yet for this model ({manifest.modelKey ?? manifest.modelId}).</p>
      <p>Its predictions, trades, folds and curves are on the other tabs; its record is in the lake like every run's.</p>
    </div>
  );
}

const SOURCE_LABELS: Record<CycleInspectSource, string> = {
  cursor: "Following the model",
  hover: "Hovered bar",
  pinned: "Pinned bar",
};

/**
 * The test bar (one the model predicted, role "processed") next to `timestamp`
 * in `direction` (-1 earlier, +1 later); null at either end. `timestamp` need
 * not be a bar itself.
 */
export function neighbourTestBar(bars: CycleBarColumns, timestamp: number | null, direction: -1 | 1): number | null {
  if (timestamp === null) return null;
  const timestamps = bars.timestamps;
  let index = findBarIndex(timestamps, timestamp);
  if (index < 0) {
    let low = 0;
    let high = timestamps.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (timestamps[middle]! < timestamp) low = middle + 1;
      else high = middle;
    }
    // `low` is the first bar after the timestamp.
    index = direction === 1 ? low - 1 : low;
  }
  for (let position = index + direction; position >= 0 && position < timestamps.length; position += direction) {
    if (bars.role[position] === "processed") return timestamps[position] ?? null;
  }
  return null;
}

function chartReadingAt(bars: CycleBarColumns, timestamp: number | null): ChartReading | null {
  if (timestamp === null) return null;
  const index = findBarIndex(bars.timestamps, timestamp);
  if (index < 0 || bars.role[index] !== "processed") return null;
  return { probabilityUp: bars.probabilityUp[index] ?? null, direction: bars.predictedDirection[index] ?? null };
}

function foldSentence(fold: CycleExplainManifestFold, role: CycleExplainRole): string | null {
  const status = fold[role];
  const which = `Fold ${fold.foldIndex + 1}'s ${roleWords(role)}`;
  if (status === "training") return `${which} is still training; you can look inside it once it is saved.`;
  if (status === "missing") return `${which} was never saved — the run ended before it was fitted.`;
  if (status === "none") return "This model has no price model, so there is nothing to open for the price.";
  return null;
}

function Message({ children, testId, tone = "neutral" }: { children: ReactNode; testId?: string; tone?: "neutral" | "warning" }) {
  return (
    <p data-testid={testId} className={cn("rounded-md border px-3 py-2 text-sm", tone === "warning" ? "border-[#D55E00]/40 text-[#D55E00]" : "border-white/10 text-neutral-300")}>
      {children}
    </p>
  );
}

export function InsidePanel() {
  // The run's bars are mutable columns appended in place; the compiler would
  // memoize the neighbour lookup on their (unchanging) identity.
  "use no memo";
  const modelId = useCycleStore((state) => state.modelId);
  const status = useCycleStore((state) => state.status);
  const cursorTimestamp = useCycleStore((state) => state.cursor?.barTimestamp ?? null);
  const inspectTimestamp = useCycleStore((state) => state.inspectTimestamp);
  const inspectSource = useCycleStore((state) => state.inspectSource);
  const inspectRole = useCycleStore((state) => state.inspectRole);
  const setInspect = useCycleStore((state) => state.setInspect);
  const pinInspect = useCycleStore((state) => state.pinInspect);
  const setInspectRole = useCycleStore((state) => state.setInspectRole);
  // Subscribe to the version so a new bar re-renders the panel.
  useCycleStore((state) => state.barsVersion);
  const bars = useCycleStore.getState().bars;

  const followed = useThrottledValue(cursorTimestamp, CURSOR_FOLLOW_MILLISECONDS);
  useEffect(() => {
    if (followed !== null) setInspect(followed, "cursor");
  }, [followed, setInspect]);

  const runIsLive = isCycleActive(status);
  const manifestQuery = useExplainManifest(modelId, runIsLive);
  const manifest = manifestQuery.data;
  const hasPriceModel = manifest?.hasPriceModel ?? false;
  const role: CycleExplainRole = inspectRole === "price" && hasPriceModel ? "price" : "direction";

  const timestamp = inspectTimestamp;
  const fold = foldForTimestamp(manifest, timestamp);
  const foldIndex = fold?.foldIndex ?? null;
  const ready = manifest?.available === true && fold !== null && fold[role] === "ready";

  const structureQuery = useExplainStructure(modelId, foldIndex, role, ready);
  const barQuery = useExplainBar(modelId, foldIndex, role, timestamp, ready);
  const loadTree = useTreeLoader(modelId, foldIndex, role);

  const previous = neighbourTestBar(bars, timestamp, -1);
  const next = neighbourTestBar(bars, timestamp, 1);
  const previousFold = foldForTimestamp(manifest, previous);
  const nextFold = foldForTimestamp(manifest, next);
  usePrefetchBars(modelId, previousFold?.foldIndex ?? null, role, [previous], manifest?.available === true && previousFold?.[role] === "ready");
  usePrefetchBars(modelId, nextFold?.foldIndex ?? null, role, [next], manifest?.available === true && nextFold?.[role] === "ready");

  const step = (direction: -1 | 1) => {
    const target = direction === -1 ? previous : next;
    if (target !== null) pinInspect(target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea")) return;
    if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
    else return;
    event.preventDefault();
  };

  const structure = structureQuery.data;
  const bar = barQuery.data;
  const featureNames = manifest?.featureDisplayNames.length ? manifest.featureDisplayNames : (manifest?.featureNames ?? []);
  const barMatches = bar !== undefined && structure !== undefined && bar.role === role && structure.role === role && bar.foldIndex === structure.foldIndex && bar.foldIndex === foldIndex;
  const View = structure ? KIND_VIEWS[structure.explainKind] : null;
  const updating = barQuery.isFetching || barQuery.settling || barQuery.isPlaceholderData;

  let body: ReactNode;
  if (modelId === null) {
    body = <Message>Start a run, or open one, to look inside its model.</Message>;
  } else if (manifestQuery.isPending) {
    body = <Message>Reading the run's explanation files…</Message>;
  } else if (manifestQuery.isError) {
    body = <Message tone="warning">{manifestQuery.error.message}</Message>;
  } else if (manifest && !manifest.available) {
    body = (
      <Message testId="inside-unavailable">
        {manifest.reason ?? "This run was made before Inside the model existed, so there is nothing to open."}
      </Message>
    );
  } else if (timestamp === null) {
    body = <Message>Waiting for the model to reach its first test bar — or hover a bar on the chart.</Message>;
  } else if (fold === null) {
    body = (
      <Message testId="inside-no-fold">
        No fold tested the bar at {formatTime(timestamp)}. The model only explains bars it predicted: hover or click a bar in a test walk, or use → to jump to the next one.
      </Message>
    );
  } else if (fold[role] !== "ready") {
    body = <Message testId="inside-fold-status">{foldSentence(fold, role)}</Message>;
  } else if (structureQuery.isError || (barQuery.isError && !barQuery.data)) {
    const error = (structureQuery.error ?? barQuery.error) as Error;
    const sentence = error instanceof ExplainRequestError && error.status === 409 && !/newer request/i.test(error.message) ? foldSentence({ ...fold, [role]: "training" }, role) : error.message;
    body = <Message tone="warning" testId="inside-error">{sentence}</Message>;
  } else if (!barMatches || !structure || !bar || !View) {
    body = (
      <p className="flex items-center gap-2 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Explaining this bar…
      </p>
    );
  } else {
    body = (
      <div className="flex flex-wrap items-start gap-3" data-testid="inside-flow">
        <InputsColumn bar={bar} featureNames={featureNames} />
        <View manifest={manifest!} structure={structure} bar={bar} role={role} featureNames={featureNames} loadTree={loadTree} />
        <OutputChain bar={bar} structure={structure} role={role} chart={chartReadingAt(bars, bar.timestamp)} />
      </div>
    );
  }

  const SourceIcon = inspectSource === "pinned" ? Pin : Crosshair;

  return (
    <div className="flex flex-col gap-3 outline-none focus-visible:ring-1 focus-visible:ring-[#56B4E9]/60" tabIndex={0} onKeyDown={onKeyDown} data-testid="inside-panel" aria-label="Inside the model">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-semibold text-neutral-100">Inside the model</h2>
          <p className="text-[11px] text-neutral-500">
            {manifest?.displayName ?? "—"}
            {fold && ` · fold ${fold.foldIndex + 1}`}
            {timestamp !== null && <span className="font-mono"> · {formatTime(timestamp)}</span>}
            {updating && ready && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" aria-label="Updating" />}
          </p>
        </div>
        <span
          data-testid="inside-source"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
            inspectSource === "pinned" ? "border-[#CC79A7]/60 text-[#CC79A7]" : inspectSource === "hover" ? "border-[#56B4E9]/60 text-[#56B4E9]" : "border-white/15 text-neutral-300",
          )}
        >
          <SourceIcon className="h-3 w-3" aria-hidden="true" />
          {SOURCE_LABELS[inspectSource]}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={previous === null}
            aria-label="Previous test bar"
            title="Previous test bar (← key)"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-white/10 text-neutral-300 hover:bg-white/[0.06] disabled:opacity-40"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={next === null}
            aria-label="Next test bar"
            title="Next test bar (→ key)"
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-white/10 text-neutral-300 hover:bg-white/[0.06] disabled:opacity-40"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => pinInspect(null)}
            disabled={inspectSource === "cursor"}
            className="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/[0.06] disabled:opacity-40"
          >
            Follow the model
          </button>
          <button
            type="button"
            onClick={() => requestSidePanelWidth("toggle")}
            title="Switch the panel between its default and wide width (the same as double-clicking its left edge)"
            className="rounded border border-white/10 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/[0.06]"
          >
            Widen
          </button>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-white/10 text-[11px]" role="group" aria-label="Which model to open">
          <button
            type="button"
            aria-pressed={role === "direction"}
            onClick={() => setInspectRole("direction")}
            className={cn("px-2 py-1", role === "direction" ? "bg-white/[0.1] text-neutral-100" : "text-neutral-400 hover:text-neutral-100")}
          >
            Direction
          </button>
          <button
            type="button"
            aria-pressed={role === "price"}
            onClick={() => setInspectRole("price")}
            disabled={!hasPriceModel}
            title={hasPriceModel ? "Open the price model" : "This model has no price model, so there is no price forecast to open."}
            className={cn("px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40", role === "price" ? "bg-white/[0.1] text-neutral-100" : "text-neutral-400 hover:text-neutral-100")}
          >
            Price
          </button>
        </div>
      </div>
      <p className="text-[11px] text-neutral-500">
        How the model turned this bar's inputs into its prediction. Hover a bar on the chart to look at it, click to pin it, or step with ← →.
        {manifest && !hasPriceModel && manifest.available && " Price is off: this model has no price model."}
      </p>
      {body}
    </div>
  );
}
