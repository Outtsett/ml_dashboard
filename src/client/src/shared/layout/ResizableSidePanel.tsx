/**
 * The pull-out panel every non-Market route opens in — News, Regression, Lens,
 * ML Studio, Data and the rest — resizable by dragging its left edge.
 *
 * Width is remembered as a FRACTION of the space the panel shares with the
 * Market chart, so it scales with the window, and is clamped in PIXELS: the
 * panel never narrower than SIDE_PANEL_MINIMUM_PIXELS, the chart never
 * narrower than CHART_MINIMUM_PIXELS (when the row cannot hold both, the two
 * shrink evenly).
 *
 * During a drag the width follows the pointer's ABSOLUTE position against the
 * row's right edge, held in state, so a re-render mid-drag (the left nav
 * animating shut, a window resize) cannot snap the panel back or decouple it
 * from the cursor. The panel's content is a stable element passed in from
 * above, so these renders stop at this component; only things that measure
 * their size (the chart, each scatter canvas) redraw. The fraction is written
 * to storage once, on release. While a drag is live a full-window overlay sits
 * above everything, so an embedded notebook iframe cannot swallow the pointer;
 * losing pointer capture for any reason ends the drag, so the overlay can
 * never be left behind.
 *
 *   drag the edge         resize
 *   double-click / Enter  jump between the default and the wide width
 *   ← →                   24 pixels per press, 96 with Shift
 *   Home / End            narrowest / widest
 *
 * Content inside the panel can ask for the same jumps with
 * `requestSidePanelWidth("wide" | "default" | "toggle")` (a window event the
 * open panel listens for), e.g. the Model Cycle's "Inside the model" Widen button.
 */

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/shared/utils/utils";

export const SIDE_PANEL_WIDTH_KEY = "side-panel-width-fraction-v1";
export const SIDE_PANEL_MINIMUM_PIXELS = 380;
export const CHART_MINIMUM_PIXELS = 360;
export const DEFAULT_FRACTION = 0.45;
export const WIDE_FRACTION = 0.72;
const KEYBOARD_STEP_PIXELS = 24;
const KEYBOARD_LARGE_STEP_PIXELS = 96;

export const SIDE_PANEL_WIDTH_EVENT = "side-panel-width-request";
export type SidePanelWidthRequest = "wide" | "default" | "toggle";

/** Ask the open side panel to go wide, return to the default width, or switch between the two (what double-clicking its edge does). */
export function requestSidePanelWidth(request: SidePanelWidthRequest): void {
  window.dispatchEvent(new CustomEvent<SidePanelWidthRequest>(SIDE_PANEL_WIDTH_EVENT, { detail: request }));
}

/**
 * Narrowest the panel may be. Normally SIDE_PANEL_MINIMUM_PIXELS; when the row
 * is too narrow for both minimums, the panel and the chart shrink evenly
 * rather than the chart losing its floor alone.
 */
export function minimumSidePanelWidth(available: number): number {
  return Math.min(SIDE_PANEL_MINIMUM_PIXELS, Math.max(available / 2, available - CHART_MINIMUM_PIXELS));
}

/** Widest the panel may be when it shares `available` pixels with the chart. */
export function maximumSidePanelWidth(available: number): number {
  return Math.max(minimumSidePanelWidth(available), available - CHART_MINIMUM_PIXELS);
}

export function clampSidePanelWidth(desired: number, available: number): number {
  return Math.min(maximumSidePanelWidth(available), Math.max(minimumSidePanelWidth(available), desired));
}

function loadFraction(): number {
  try {
    const stored = Number(window.localStorage.getItem(SIDE_PANEL_WIDTH_KEY));
    return stored > 0 && stored < 1 ? stored : DEFAULT_FRACTION;
  } catch {
    return DEFAULT_FRACTION;
  }
}

function saveFraction(fraction: number) {
  try {
    window.localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(fraction));
  } catch {
    // Storage unavailable: the width lasts for this visit only.
  }
}

export function ResizableSidePanel({ children, className }: { children: ReactNode; className?: string }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** Pointer distance from the panel's left edge at the moment the drag began. */
  const grabOffsetRef = useRef(0);
  const [fraction, setFraction] = useState(loadFraction);
  const [available, setAvailable] = useState(0);
  /** The live width while dragging; null when not dragging. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragging = dragWidth !== null;

  // The panel shares its parent row with the chart; that row is the space.
  useLayoutEffect(() => {
    const row = panelRef.current?.parentElement;
    if (!row) return;
    setAvailable(row.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setAvailable(width);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const committedWidth = available > 0 ? clampSidePanelWidth(fraction * available, available) : null;
  const width = dragWidth ?? committedWidth;
  const minimum = minimumSidePanelWidth(available);
  const maximum = maximumSidePanelWidth(available);

  const commit = (pixels: number) => {
    if (available <= 0) return;
    const next = clampSidePanelWidth(pixels, available) / available;
    setFraction(next);
    saveFraction(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || width === null || !panelRef.current || dragging) return;
    event.preventDefault();
    const row = panelRef.current.parentElement?.getBoundingClientRect();
    if (!row) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Layout position (offsetLeft), not the on-screen box: the panel's
    // slide-in animation translates it, and a grab during that animation
    // measured from the translated box threw the whole drag off.
    grabOffsetRef.current = event.clientX - (row.left + panelRef.current.offsetLeft);
    setDragWidth(width);
  };

  /** The panel's right edge is the row's right edge; its left edge sits under the pointer, less the grab offset. */
  const widthAtPointer = (clientX: number): number | null => {
    const row = panelRef.current?.parentElement?.getBoundingClientRect();
    return row ? clampSidePanelWidth(row.right - (clientX - grabOffsetRef.current), row.width) : null;
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const next = widthAtPointer(event.clientX);
    if (next !== null) setDragWidth(next);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragWidth === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    // A release carries the true final position; a cancel or a lost capture
    // does not, so those keep the last width the pointer reached.
    const final = event.type === "pointerup" ? widthAtPointer(event.clientX) ?? dragWidth : dragWidth;
    commit(final);
    setDragWidth(null);
  };

  const toggleWide = () => {
    if (width === null || available <= 0) return;
    const midpoint = ((DEFAULT_FRACTION + WIDE_FRACTION) / 2) * available;
    commit((width < midpoint ? WIDE_FRACTION : DEFAULT_FRACTION) * available);
  };

  // Requests from the panel's content; the ref always holds this render's handler.
  const requestRef = useRef<(request: SidePanelWidthRequest) => void>(() => {});
  useLayoutEffect(() => {
    requestRef.current = (request) => {
      if (request === "toggle") toggleWide();
      else if (available > 0) commit((request === "wide" ? WIDE_FRACTION : DEFAULT_FRACTION) * available);
    };
  });
  useEffect(() => {
    const listener = (event: Event) => requestRef.current((event as CustomEvent<SidePanelWidthRequest>).detail);
    window.addEventListener(SIDE_PANEL_WIDTH_EVENT, listener);
    return () => window.removeEventListener(SIDE_PANEL_WIDTH_EVENT, listener);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (width === null) return;
    const step = event.shiftKey ? KEYBOARD_LARGE_STEP_PIXELS : KEYBOARD_STEP_PIXELS;
    if (event.key === "ArrowLeft") commit(width + step);
    else if (event.key === "ArrowRight") commit(width - step);
    else if (event.key === "Home") commit(minimum);
    else if (event.key === "End") commit(maximum);
    else if (event.key === "Enter") toggleWide();
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={panelRef}
      data-testid="side-panel"
      // transition-none: a caller's duration-* (meant for the slide-in
      // animation) would otherwise animate every width change, because the
      // initial transition-property is `all` — a drag would trail the pointer.
      className={cn("relative shrink-0 flex flex-col transition-none", width === null && "w-[45%]", className)}
      style={width !== null ? { width } : undefined}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the side panel"
        aria-valuemin={available > 0 ? Math.round((100 * minimum) / available) : undefined}
        aria-valuemax={available > 0 ? Math.round((100 * maximum) / available) : undefined}
        aria-valuenow={width !== null && available > 0 ? Math.round((100 * width) / available) : undefined}
        tabIndex={0}
        title="Drag to resize · double-click or Enter to switch between default and wide · arrow keys to nudge"
        data-testid="side-panel-resize-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={toggleWide}
        onKeyDown={onKeyDown}
        className="group absolute inset-y-0 -left-1.5 z-20 flex w-3 cursor-col-resize touch-none items-center justify-center outline-none"
      >
        <span
          className={cn(
            "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
            dragging ? "bg-[#0072B2]" : "bg-white/10 group-hover:bg-[#0072B2]/80 group-focus-visible:bg-[#0072B2]",
          )}
        />
        <span
          className={cn(
            "relative flex h-9 w-3 items-center justify-center rounded-sm border transition-colors",
            dragging
              ? "border-[#0072B2] bg-[#0072B2]/30 text-white"
              : "border-white/15 bg-neutral-900 text-white/50 group-hover:border-[#0072B2]/70 group-hover:text-white/80 group-focus-visible:border-[#0072B2]",
          )}
        >
          <GripVertical className="h-3 w-3" />
        </span>
        {dragging && width !== null && available > 0 && (
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-neutral-900/95 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white/90 ring-1 ring-[#0072B2]/60">
            {Math.round(width)} px · {Math.round((100 * width) / available)}%
          </span>
        )}
      </div>
      {dragging && <div className="fixed inset-0 z-[70] cursor-col-resize" aria-hidden />}
      {children}
    </div>
  );
}
