/**
 * Publishes what the Market chart shows to the notebooks beside it.
 *
 * Two routes, because a notebook can live in two places:
 *  - INTO EVERY NOTEBOOK FRAME on this page, by postMessage (no network, no
 *    connection used): each frame under /marimo/ receives
 *    `{type: "dashboard:chart-context", context}` whenever the context changes,
 *    and a frame that says `{type: "dashboard:notebook-ready"}` is answered at
 *    once with the current context. `lake.dashboard.follow_chart` listens for it.
 *  - TO THE SERVER (`PUT /api/chart/context`), throttled, for a notebook opened
 *    outside the dashboard (`lake.dashboard.chart_context()` reads it).
 *
 * The crosshair is not published: every context change re-runs a following
 * notebook's cells, and a pointer sweep would re-run them dozens of times a
 * second. A clicked bar (`selectedMs`) is the notebook's focus instead.
 */

import { CHART_CONTEXT_MESSAGE, NOTEBOOK_READY_MESSAGE, type ChartContext } from "@shared/chartLink";
import { logWarn } from "@/infrastructure/lib/error_logger";

/** The context the chart publishes (the server adds `updatedAtIso` and `sequence`). */
export type PublishedChartContext = Omit<ChartContext, "updatedAtIso" | "sequence">;

export const CHART_CONTEXT_EVENT = "dashboard:chart-context";

const SERVER_THROTTLE_MS = 300;

let latest: PublishedChartContext | null = null;
let latestJson = "";
let serverTimer: ReturnType<typeof setTimeout> | null = null;
let bridgeInstalled = false;

export function latestChartContext(): PublishedChartContext | null {
  return latest;
}

/** Every notebook frame on the page (the proxied marimo pages). */
function notebookFrames(): HTMLIFrameElement[] {
  return [...document.querySelectorAll("iframe")].filter((frame) => {
    const source = frame.getAttribute("src") ?? "";
    return source.startsWith("/marimo/") || source.startsWith(`${window.location.origin}/marimo/`);
  });
}

function postToFrames(context: PublishedChartContext): void {
  for (const frame of notebookFrames()) {
    try {
      frame.contentWindow?.postMessage({ type: CHART_CONTEXT_MESSAGE, context }, window.location.origin);
    } catch (err) {
      logWarn("chartContextBridge", "could not post the chart context to a notebook frame", { error: String(err) });
    }
  }
}

function scheduleServerWrite(): void {
  if (serverTimer) return;
  serverTimer = setTimeout(() => {
    serverTimer = null;
    const body = latestJson;
    if (!body) return;
    fetch("/api/chart/context", { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: true })
      .catch((err: unknown) => logWarn("chartContextBridge", "could not publish the chart context", { error: String(err) }));
  }, SERVER_THROTTLE_MS);
}

/** Answers a notebook that has just loaded with the current context. Installed once per page. */
export function installNotebookBridge(): void {
  if (bridgeInstalled || typeof window === "undefined") return;
  bridgeInstalled = true;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data as { type?: unknown } | null;
    if (!data || data.type !== NOTEBOOK_READY_MESSAGE || !latest) return;
    const source = event.source as Window | null;
    source?.postMessage({ type: CHART_CONTEXT_MESSAGE, context: latest }, window.location.origin);
  });
}

/** Publishes the chart's context; a context identical to the last one does nothing. */
export function publishChartContext(context: PublishedChartContext): void {
  const json = JSON.stringify(context);
  if (json === latestJson) return;
  latest = context;
  latestJson = json;
  installNotebookBridge();
  postToFrames(context);
  window.dispatchEvent(new CustomEvent(CHART_CONTEXT_EVENT, { detail: context }));
  scheduleServerWrite();
}

/** Test seam. */
export function resetChartContextBridgeForTests(): void {
  latest = null;
  latestJson = "";
  if (serverTimer) clearTimeout(serverTimer);
  serverTimer = null;
}
