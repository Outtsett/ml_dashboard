/**
 * How a label value is drawn on this page: the same encoding the Market
 * chart's label overlay uses (market/components/labelMarkerStyle.ts), so a
 * label looks the same here as on the chart.
 *
 *   signed   values within [-2, 2]: ▲ orange up, ▼ blue down, larger for ±2, ● grey for 0
 *   ordinal  anything wider (regimes 0..3, range buckets, continuous returns): a cividis ramp, ■
 */

import { labelDomain, labelMarkerStyle, type LabelDomain } from "@/market/components/labelMarkerStyle";

export type PointShape = "triangleUp" | "triangleDown" | "circle" | "square";

export interface LabelStyle {
  color: string;
  shape: PointShape;
  /** Size multiplier (1 = one unit label). */
  size: number;
  /** Glyph + words, so the class reads without its colour. */
  name: string;
}

export function domainOf(values: ReadonlyArray<number | null>): LabelDomain {
  return labelDomain(values.filter((value): value is number => value !== null && Number.isFinite(value)));
}

function formatLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toPrecision(3);
}

export function labelStyle(value: number | null, domain: LabelDomain): LabelStyle {
  if (value === null || !Number.isFinite(value)) return { color: "#808A99", shape: "circle", size: 0.6, name: "○ no label" };
  const style = labelMarkerStyle(value, domain);
  if (domain.kind === "ordinal") return { color: style.color, shape: "square", size: style.size, name: `■ ${formatLabel(value)}` };
  if (style.shape === "arrowUp") return { color: style.color, shape: "triangleUp", size: style.size, name: `${value >= 2 ? "▲▲" : "▲"} ${formatLabel(value)} up` };
  if (style.shape === "arrowDown") return { color: style.color, shape: "triangleDown", size: style.size, name: `${value <= -2 ? "▼▼" : "▼"} ${formatLabel(value)} down` };
  return { color: style.color, shape: "circle", size: style.size, name: `● ${formatLabel(value)}` };
}

/** Draw one point of the given shape centred on (x, y). */
export function drawPoint(context: CanvasRenderingContext2D, x: number, y: number, shape: PointShape, radius: number): void {
  context.beginPath();
  if (shape === "circle") {
    context.arc(x, y, radius, 0, Math.PI * 2);
  } else if (shape === "square") {
    context.rect(x - radius, y - radius, radius * 2, radius * 2);
  } else {
    const direction = shape === "triangleUp" ? -1 : 1;
    context.moveTo(x, y + direction * radius * 1.2);
    context.lineTo(x - radius * 1.1, y - direction * radius * 0.8);
    context.lineTo(x + radius * 1.1, y - direction * radius * 0.8);
    context.closePath();
  }
  context.fill();
}
