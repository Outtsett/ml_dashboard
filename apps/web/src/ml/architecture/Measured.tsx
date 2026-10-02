import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Self-measuring box — a robust drop-in for the
 * `<div><ParentSize>{({ width }) => …}</ParentSize></div>` idiom.
 *
 * Why this exists: `@visx/responsive`'s `ParentSize` measures from a
 * ResizeObserver whose first callback can report 0 when the subtree mounts
 * inside a Radix `TabsContent` that was just switched into view (React 19 +
 * react-compiler). When that 0 is latched, the render prop returns `null`
 * forever and the chart never appears. Measuring synchronously in a layout
 * effect (the element is already laid out and visible by then) plus a
 * ResizeObserver for later reflows sidesteps that entirely.
 *
 * Two sizing modes:
 *   - `height` given  — fixed-height box; the explicit height keeps it from
 *     collapsing before the first measurement (tree/forest charts).
 *   - `height` omitted — the box sizes from the flex chain and BOTH dimensions
 *     are measured. Give it `flex-1 min-h-0` via `className` and it fills the
 *     space its parent hands down (network graph canvas).
 *
 * Lives at the domain root because both `graph/` and `trees/` render into
 * just-switched TabsContent panels and are exposed to the same latch.
 */
export function Measured({
  height,
  minWidth = 60,
  minHeight = 40,
  className,
  children,
}: {
  /** Fixed pixel height. Omit to size from the flex chain and measure height. */
  height?: number;
  minWidth?: number;
  minHeight?: number;
  className?: string;
  children: (dims: { width: number; height: number }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setDims((prev) =>
          Math.abs(prev.width - w) > 0.5 || Math.abs(prev.height - h) > 0.5
            ? { width: w, height: h }
            : prev,
        );
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ready = dims.width >= minWidth && dims.height >= minHeight;

  return (
    <div
      ref={ref}
      className={className}
      style={height != null ? { height } : undefined}
    >
      {ready ? children(dims) : null}
    </div>
  );
}
