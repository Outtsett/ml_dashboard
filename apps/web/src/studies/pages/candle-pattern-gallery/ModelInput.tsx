/**
 * The chart-CNN's exact input: the binary image render.py draws from 48 bars,
 * 144 by 94 pixels, one lit pixel per tick. Drawn by `renderModelInput` (the
 * same arithmetic as the Python), scaled up without smoothing. Over it the
 * page can shade the columns of the pattern's own bars and outline the one
 * bar being inspected.
 */

import { useEffect, useRef } from "react";
import { MODEL_INPUT, renderModelInput, type GalleryBar } from "@shared/studies/candle-pattern-gallery";
import { OKABE } from "@/studies/kit";

export interface ModelInputProps {
  bars: readonly GalleryBar[];
  /** CSS width in pixels; the 144-pixel raster is scaled to it. */
  cssWidth: number;
  shadePattern?: boolean;
  /** Index of the inspected bar (0..47): its three columns are outlined. */
  marker?: number | null;
  /** Pixel rows to mark with a horizontal guide (the row of the price being placed). */
  guideRows?: readonly number[];
  onSelectBar?: (index: number) => void;
}

export function ModelInput({ bars, cssWidth, shadePattern = false, marker = null, guideRows = [], onSelectBar }: ModelInputProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height, pixelsPerBar, bars: barCount } = MODEL_INPUT;
  const guideKey = guideRows.join(",");

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const pixels = renderModelInput(bars);
    const image = context.createImageData(width, height);
    for (let i = 0; i < pixels.length; i += 1) {
      const lit = pixels[i] === 255;
      image.data[i * 4] = lit ? 245 : 10;
      image.data[i * 4 + 1] = lit ? 245 : 10;
      image.data[i * 4 + 2] = lit ? 245 : 10;
      image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    if (shadePattern) {
      context.fillStyle = "rgba(86,180,233,0.22)";
      bars.forEach((bar, index) => {
        if (bar.is_pattern_bar) context.fillRect(index * pixelsPerBar, 0, pixelsPerBar, height);
      });
    }
    if (marker !== null && marker >= 0 && marker < barCount) {
      context.strokeStyle = OKABE.yellow;
      context.lineWidth = 1;
      context.strokeRect(marker * pixelsPerBar + 0.5, 0.5, pixelsPerBar - 1, height - 1);
    }
    context.fillStyle = OKABE.orange;
    for (const row of guideRows) context.fillRect(0, row, width, 1);
    // guideKey stands for guideRows so a new array with the same rows does not redraw.
  }, [bars, shadePattern, marker, guideKey, width, height, pixelsPerBar, barCount]);

  return (
    <canvas
      ref={canvas}
      width={width}
      height={height}
      role="img"
      aria-label="the chart-CNN input image"
      className={`block rounded ${onSelectBar ? "cursor-pointer" : ""}`}
      style={{ width: cssWidth, height: (cssWidth * height) / width, imageRendering: "pixelated", maxWidth: "100%" }}
      onClick={
        onSelectBar
          ? (event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const index = Math.floor(((event.clientX - box.left) / box.width) * barCount);
              onSelectBar(Math.min(barCount - 1, Math.max(0, index)));
            }
          : undefined
      }
    />
  );
}
