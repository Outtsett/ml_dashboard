/**
 * The `dashboard` MCP server every panel session gets (in-process, through the
 * Agent SDK's createSdkMcpServer): the dashboard's own page, API and live data
 * as tools, so Claude can show Tyler a result instead of describing it.
 *
 * Every tool is read-only except open_dashboard_page, which only moves the
 * page in the panel's own browser tab.
 */

import { z } from "zod/v4";
import type { ClaudeSession } from "./session";

const DASHBOARD = `http://127.0.0.1:${process.env.DASHBOARD_PORT ?? "5000"}`;
const LIVE = "http://127.0.0.1:17192";
const LIMIT = 30_000;

function text(value: unknown): { content: { type: "text"; text: string }[] } {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return { content: [{ type: "text", text: body.length > LIMIT ? `${body.slice(0, LIMIT)}\n… (${body.length - LIMIT} more characters)` : body }] };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 400)}`);
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export async function dashboardServer(session: ClaudeSession) {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const { createSdkMcpServer, tool } = sdk;

  return createSdkMcpServer({
    name: "dashboard",
    version: "1.0.0",
    tools: [
      tool(
        "open_dashboard_page",
        "Navigate Tyler's dashboard (the tab this panel is in) to a page, optionally switching the chart's symbol and timeframe. Routes: / (Market chart), /live, /news, /cycle, /labels, /ml-studio, /model-catalog, /lens, /regression, /marimo, /databases, /training, /settings. Use it to show him what you built or found.",
        {
          route: z.string().describe("Path starting with /, e.g. /cycle?model=xgboost or /marimo"),
          symbol: z.string().optional().describe("Chart symbol, e.g. MNQ, ES, EURUSD"),
          timeframe: z.string().optional().describe("Chart timeframe, e.g. 1m, 5m, 1h, 1d"),
        },
        async ({ route, symbol, timeframe }) => {
          if (!route.startsWith("/")) return text("route must start with /");
          session.navigate(route, symbol, timeframe);
          return text(`Opened ${route}${symbol ? ` (${symbol}${timeframe ? ` ${timeframe}` : ""})` : ""} in the dashboard.`);
        },
      ),
      tool(
        "dashboard_context",
        "Where Tyler is in the dashboard right now: route, chart symbol, timeframe, Model Cycle run — as last sent with his message.",
        {},
        async () => text(session.context ?? { note: "no context sent yet" }),
      ),
      tool(
        "dashboard_api_get",
        "GET any endpoint of the dashboard's own API (read-only), e.g. /api/training/cycle, /api/labels/lifecycle, /api/charts/series/catalog, /api/sidecars. Returns the JSON (truncated to 30,000 characters).",
        { path: z.string().describe("Path starting with /api/, including any query string") },
        async ({ path }) => {
          if (!path.startsWith("/api/")) return text("path must start with /api/");
          return text(await getJson(`${DASHBOARD}${path}`));
        },
      ),
      tool(
        "live_quotes",
        "Latest live quotes from the dashboard's data hub: OANDA forex (real time), Yahoo futures and the dollar index (~10 min delayed; delaySeconds says how much).",
        { symbols: z.array(z.string()).optional().describe("Filter, e.g. [\"EURUSD\", \"ES\"]") },
        async ({ symbols }) => {
          const data = (await getJson(`${LIVE}/quotes`)) as { quotes: { symbol: string }[] };
          const wanted = symbols?.map((s) => s.toUpperCase());
          return text(wanted ? data.quotes.filter((q) => wanted.includes(q.symbol)) : data.quotes);
        },
      ),
      tool(
        "news_sentiment",
        "FinBERT-scored headlines from the live hub (RSS, Alpha Vantage, GDELT), optionally only those routed to one instrument root, plus that root's FinBERT feature values over the last hours — the same features every model trains on.",
        {
          root: z.string().optional().describe("Instrument root, e.g. MNQ, ES, EURUSD, GC, ZN"),
          limit: z.number().int().min(1).max(200).optional(),
          hours: z.number().min(1).max(168).optional(),
        },
        async ({ root, limit, hours }) => {
          const query = new URLSearchParams({ limit: String(limit ?? 30) });
          if (root) query.set("root", root.toUpperCase());
          const news = await getJson(`${LIVE}/news?${query}`);
          const features = root
            ? await getJson(`${LIVE}/sentiment?roots=${encodeURIComponent(root.toUpperCase())}&hours=${hours ?? 6}&step=15`)
            : undefined;
          return text({ news, features });
        },
      ),
    ],
  });
}
