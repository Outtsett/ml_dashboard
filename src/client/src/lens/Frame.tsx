/**
 * LensFrame — the one card chrome every Model Lens view renders inside, so
 * the page reads as one system: title, a plain-words question the view
 * answers, and the n / method line every estimate must carry.
 *
 * Every frame is resizable. Drag the grip along its bottom edge (or focus it
 * and use the arrow keys) to give a view more room; double-click the grip to
 * put it back. The height is remembered per frame in this browser, so a layout
 * tuned for one screen survives a reload. Frames whose body is a single chart
 * let the chart fill whatever height the frame is given.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GripHorizontal } from "lucide-react";
import { cn } from "@/shared/utils/utils";

const STORAGE_PREFIX = "lens-frame-height:";
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 2000;
const KEYBOARD_STEP = 24;

function readStoredHeight(key: string | undefined): number | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    // Private windows and blocked site data both throw here; a frame without a
    // remembered height is not a failure.
    return null;
  }
}

function writeStoredHeight(key: string | undefined, height: number | null): void {
  if (!key) return;
  try {
    if (height === null) window.localStorage.removeItem(STORAGE_PREFIX + key);
    else window.localStorage.setItem(STORAGE_PREFIX + key, String(Math.round(height)));
  } catch {
    /* nothing to do — the layout still works, it just will not be remembered */
  }
}

export interface LensFrameProps {
  title: string;
  /** The question this view answers, in plain words. */
  question?: string;
  /** Sample size / method / window — printed beside the view, never hidden. */
  basis?: string;
  /** Right-aligned controls (toggles, selectors). */
  actions?: ReactNode;
  /** Shown instead of children when the view has no data for this model. */
  unavailableReason?: string;
  className?: string;
  children?: ReactNode;
  testId?: string;
  /**
   * Turns on height resizing and names the slot the height is remembered
   * under. Without it the frame sizes to its content.
   */
  resizeKey?: string;
  /** Starting height in pixels, used until the frame is dragged. */
  defaultHeight?: number;
  minHeight?: number;
  /** The body becomes a flex column that its child can fill (single-chart views). */
  fillBody?: boolean;
}

export function LensFrame({
  title,
  question,
  basis,
  actions,
  unavailableReason,
  className,
  children,
  testId,
  resizeKey,
  defaultHeight,
  minHeight = MIN_HEIGHT,
  fillBody = false,
}: LensFrameProps) {
  const resizable = Boolean(resizeKey && defaultHeight);
  const [height, setHeight] = useState<number | null>(() => (resizable ? readStoredHeight(resizeKey) ?? defaultHeight! : null));
  const sectionRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // A different model (or a different frame) reuses this component; adopt the
  // height stored for the new slot rather than keeping the old one on screen.
  useEffect(() => {
    if (!resizable) return;
    setHeight(readStoredHeight(resizeKey) ?? defaultHeight!);
  }, [resizable, resizeKey, defaultHeight]);

  const clamp = useCallback(
    (value: number) => Math.min(MAX_HEIGHT, Math.max(minHeight, value)),
    [minHeight],
  );

  // Window-level listeners rather than setPointerCapture: capture is tied to a
  // live pointer id, which a synthetic or emulated pointer may not carry, and a
  // drag that silently never starts is worse than a slightly longer handler.
  const beginDrag = (startY: number) => {
    if (!resizable) return;
    // The state height is what the frame is actually pinned to; a measured rect
    // is 0 wherever layout has not run (jsdom, a hidden tab), which would snap
    // the frame to its minimum on the first drag.
    const startHeight = height ?? sectionRef.current?.getBoundingClientRect().height ?? defaultHeight!;
    dragRef.current = { startY, startHeight };

    const move = (event: PointerEvent | MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      setHeight(clamp(drag.startHeight + (event.clientY - drag.startY)));
    };
    const end = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("mouseup", end);
      document.body.style.userSelect = "";
      setHeight((current) => {
        writeStoredHeight(resizeKey, current);
        return current;
      });
    };

    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("mousemove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("mouseup", end);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    beginDrag(event.clientY);
  };

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    // Only when the pointer event did not already start this drag.
    if (dragRef.current) return;
    event.preventDefault();
    beginDrag(event.clientY);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!resizable) return;
    const base = height ?? defaultHeight!;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = clamp(base + (event.key === "ArrowDown" ? KEYBOARD_STEP : -KEYBOARD_STEP));
      setHeight(next);
      writeStoredHeight(resizeKey, next);
    } else if (event.key === "Home" || event.key === "Escape") {
      event.preventDefault();
      setHeight(defaultHeight!);
      writeStoredHeight(resizeKey, null);
    }
  };

  const reset = () => {
    if (!resizable) return;
    setHeight(defaultHeight!);
    writeStoredHeight(resizeKey, null);
  };

  return (
    <section
      ref={sectionRef}
      data-testid={testId}
      className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card", className)}
      style={resizable && height !== null ? { height } : undefined}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h3>
          {question && <p className="mt-0.5 text-xs text-muted-foreground">{question}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("min-h-0 flex-1 p-3", resizable && "overflow-auto", fillBody && "flex flex-col")}>
        {unavailableReason ? (
          <p className="text-sm text-muted-foreground" data-testid={testId ? `${testId}-unavailable` : undefined}>
            Not available for this model: {unavailableReason}
          </p>
        ) : (
          children
        )}
      </div>
      {basis && !unavailableReason && (
        <footer className="border-t border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground tnum">{basis}</footer>
      )}
      {resizable && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${title}. Arrow keys adjust, Home resets.`}
          aria-valuenow={Math.round(height ?? defaultHeight!)}
          aria-valuemin={minHeight}
          aria-valuemax={MAX_HEIGHT}
          tabIndex={0}
          data-testid={testId ? `${testId}-resize` : "lens-frame-resize"}
          onPointerDown={onPointerDown}
          onMouseDown={onMouseDown}
          onDoubleClick={reset}
          onKeyDown={onKeyDown}
          title="Drag to resize · double-click to reset"
          className="flex h-2.5 cursor-ns-resize items-center justify-center rounded-b-lg border-t border-border bg-muted/30 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <GripHorizontal className="h-3 w-3 opacity-60" aria-hidden="true" />
        </div>
      )}
    </section>
  );
}
