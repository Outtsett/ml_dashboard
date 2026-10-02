/**
 * "Draw on the chart": pushes this study's overlays to the Market chart
 * (PUT /api/chart/overlays, source "chart_companion") and takes them back off
 * (DELETE). The chart draws a set only when its symbol and timeframe match
 * what it shows. Drawings a previous visit left are this study's, so the
 * switch starts from whether the server already holds them.
 */

import { useEffect, useRef, useState } from "react";
import type { Overlay } from "@shared/chartLink";
import { OVERLAY_SOURCE, overlayManifest, type OverlayManifestRow } from "@shared/studies/chart-companion";
import { logWarn } from "@/infrastructure/lib/error_logger";
import { Empty, Finding, Section, fmt, fmtInt } from "@/studies/kit";

const PUSH_DELAY_MILLISECONDS = 350;

export function useChartDrawing({ draw, overlays, symbol, timeframe }: { draw: boolean; overlays: readonly Overlay[]; symbol: string; timeframe: string }): string {
  /** Whether the server holds a set of this study's (from an earlier visit or this one). A ref: it never changes what is drawn on screen. */
  const drawn = useRef(false);
  const [seeded, setSeeded] = useState(false);
  const [message, setMessage] = useState("Drawing is off: switch on Draw on the chart to put these on the Market chart.");

  // Seed from the server: a set left by an earlier visit is cleared when the switch is off.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/chart/overlays", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { sets?: Array<{ source?: string }> };
        if (body.sets?.some((set) => set.source === OVERLAY_SOURCE)) drawn.current = true;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) logWarn("chart-companion", "could not read the chart's overlay sets", { error: String(error) });
      })
      .finally(() => {
        if (!controller.signal.aborted) setSeeded(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!seeded) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        if (draw && overlays.length > 0) {
          const response = await fetch("/api/chart/overlays", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: OVERLAY_SOURCE, symbol, timeframe, overlays }),
            signal: controller.signal,
          });
          if (response.ok) {
            const items = overlayManifest(overlays).reduce((total, row) => total + row.itemCount, 0);
            drawn.current = true;
            setMessage(`Drew ${overlays.length} overlay${overlays.length === 1 ? "" : "s"} (${items.toLocaleString("en-US")} items) on ${symbol} ${timeframe} as "${OVERLAY_SOURCE}".`);
          } else {
            setMessage(`The dashboard refused the overlays (HTTP ${response.status}).`);
          }
        } else if (draw) {
          await fetch(`/api/chart/overlays/${OVERLAY_SOURCE}`, { method: "DELETE", signal: controller.signal });
          drawn.current = false;
          setMessage("Nothing is selected to draw; the chart's drawings from this study are cleared.");
        } else if (drawn.current) {
          const response = await fetch(`/api/chart/overlays/${OVERLAY_SOURCE}`, { method: "DELETE", signal: controller.signal });
          if (response.ok) {
            drawn.current = false;
            setMessage("Drawing switched off: this study's drawings are cleared from the chart.");
          }
        } else {
          setMessage("Drawing is off: switch on Draw on the chart to put these on the Market chart.");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          logWarn("chart-companion", "could not update the chart's overlays", { error: String(error) });
          setMessage(`The dashboard did not answer the overlay request (${String(error)}).`);
        }
      }
    }, PUSH_DELAY_MILLISECONDS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [seeded, draw, overlays, symbol, timeframe]);

  return message;
}

export function DrawingSection({ overlays, message, draw }: { overlays: readonly Overlay[]; message: string; draw: boolean }) {
  const rows: OverlayManifestRow[] = overlayManifest(overlays);
  return (
    <Section title="What would be drawn on the chart" question="Arrows, levels, shading and a line, each only while its switch above is on.">
      <div className="space-y-3">
        <Finding>
          Arrows mark the unusual moves (orange arrow up under the bar for an up move, blue arrow down above the bar for a down move, each labelled with its z-score). Dashed lines mark the highest high, the lowest low and the
          volume-weighted average price of the visible range (the average price weighted by how much traded at each bar, using each bar&apos;s typical price, the mean of high, low and close). Light-blue shading marks stretches where the
          trailing true range sat in the top 10% of its own previous values. A vertical line marks the selected bar. The volume-weighted line is yellow here (the notebook drew it black, which vanishes on this dark chart).
        </Finding>
        {rows.length === 0 ? (
          <Empty>Nothing to draw yet.</Empty>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-0.5 font-normal">overlay</th>
                <th className="py-0.5 font-normal">drawn as</th>
                <th className="py-0.5 font-normal">colour</th>
                <th className="py-0.5 text-right font-normal">item count</th>
                <th className="py-0.5 text-right font-normal">price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.overlay} className="border-t border-neutral-900 text-neutral-200">
                  <td className="py-0.5">{row.overlay}</td>
                  <td className="py-0.5">{row.drawnAs}</td>
                  <td className="py-0.5">
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ backgroundColor: row.color }} aria-hidden="true" />
                    <span className="font-mono text-neutral-400">{row.color}</span>
                  </td>
                  <td className="py-0.5 text-right font-mono tnum">{fmtInt(row.itemCount)}</td>
                  <td className="py-0.5 text-right font-mono tnum">{row.price === null ? "—" : fmt(row.price, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={`text-[11px] ${draw ? "text-neutral-200" : "text-neutral-400"}`}>
          <span className="font-semibold">Chart overlays:</span> {message}
        </p>
      </div>
    </Section>
  );
}
