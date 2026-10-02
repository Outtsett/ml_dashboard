/**
 * OANDA v20 API -> lake ingestion script.
 *
 * Modes:
 *   backfill  — fetch historical M1 candles and ingest into ohlcv table
 *   stream    — connect to OANDA streaming API for live tick updates
 *
 * Usage:
 *   npx tsx scripts/ingest-oanda.ts backfill [--pairs EURUSD,GBPUSD] [--from 2024-01-01] [--to 2025-01-01]
 *   npx tsx scripts/ingest-oanda.ts stream   [--pairs EURUSD,GBPUSD]
 */
import { Sender } from "@lake/nodejs-client";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SECRETS_PATH = "C:\\Users\\tyler\\.env.secrets";
const lake_HOST = process.env.lake_HOST || "localhost";
const lake_HTTP_PORT = process.env.lake_HTTP_PORT || "9000";
const BATCH_SIZE = 5000; // OANDA max per request
const REQUEST_DELAY_MS = 100; // stay well under 120 req/s limit
const HEARTBEAT_TIMEOUT_MS = 15_000;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_ATTEMPTS = 50;

const DEFAULT_PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "AUD_USD",
  "NZD_USD",
  "USD_CAD",
  "USD_CHF",
  "EUR_GBP",
  "EUR_JPY",
  "GBP_JPY",
  "EUR_AUD",
  "EUR_CHF",
  "GBP_AUD",
  "GBP_CHF",
  "AUD_CAD",
  "AUD_NZD",
  "AUD_JPY",
];

// ---------------------------------------------------------------------------
// Load secrets
// ---------------------------------------------------------------------------

function loadSecrets(): { apiKey: string; accountId: string; env: string } {
  const raw = fs.readFileSync(SECRETS_PATH, "utf-8");
  const lines = raw.split("\n");
  const get = (key: string): string => {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    if (!line) throw new Error(`${key} not found in ${SECRETS_PATH}`);
    return line.split("=").slice(1).join("=").trim();
  };
  return {
    apiKey: get("OANDA_API_KEY"),
    accountId: get("OANDA_ACCOUNT_ID"),
    env: get("OANDA_ENVIRONMENT"),
  };
}

function baseUrl(env: string): string {
  return env === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";
}

function streamUrl(env: string): string {
  return env === "live"
    ? "https://stream-fxtrade.oanda.com"
    : "https://stream-fxpractice.oanda.com";
}

function oandaToSymbol(instrument: string): string {
  return instrument.replace(/_/g, "");
}

// ---------------------------------------------------------------------------
// OANDA API helpers
// ---------------------------------------------------------------------------

interface OandaCandle {
  time: string;
  mid: { o: string; h: string; l: string; c: string };
  volume: number;
  complete: boolean;
}

interface CandleResponse {
  instrument: string;
  granularity: string;
  candles: OandaCandle[];
}

async function fetchCandles(
  apiKey: string,
  base: string,
  instrument: string,
  from: string,
  to: string,
  granularity = "M1",
  count?: number
): Promise<OandaCandle[]> {
  // Use from + count for pagination (OANDA rejects from+to when range > 5000)
  const params = new URLSearchParams({
    granularity,
    price: "M",
    from,
    count: String(count || BATCH_SIZE),
  });

  const url = `${base}/v3/instruments/${instrument}/candles?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (res.status === 429) {
    console.log(`[oanda] rate limited, waiting 4s...`);
    await sleep(4000);
    return fetchCandles(apiKey, base, instrument, from, to, granularity, count);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OANDA API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as CandleResponse;
  return data.candles.filter((c) => c.complete);
}

// ---------------------------------------------------------------------------
// Backfill mode
// ---------------------------------------------------------------------------

async function backfillPair(
  pair: string,
  fromDate: string,
  toDate: string,
  apiKey: string,
  base: string,
): Promise<number> {
  const configStr = `http::addr=${lake_HOST}:${lake_HTTP_PORT};auto_flush=off;`;
  const sender = await Sender.fromConfig(configStr);
  const symbol = oandaToSymbol(pair);
  let cursor = fromDate;
  let pairRows = 0;

  console.log(`[backfill] ${symbol} starting from ${cursor}`);

  while (cursor < toDate) {
    const candles = await fetchCandles(apiKey, base, pair, cursor, toDate);
    if (candles.length === 0) break;

    for (const c of candles) {
      const tsMs = new Date(c.time).getTime();

      await sender
        .table("ohlcv")
        .symbol("symbol", symbol)
        .symbol("asset_class", "forex")
        .symbol("root", symbol)
        .floatColumn("open", parseFloat(c.mid.o))
        .floatColumn("high", parseFloat(c.mid.h))
        .floatColumn("low", parseFloat(c.mid.l))
        .floatColumn("close", parseFloat(c.mid.c))
        .floatColumn("volume", c.volume)
        .at(tsMs, "ms");

      pairRows++;
    }

    await sender.flush();

    const lastTime = candles[candles.length - 1].time;
    const lastMs = new Date(lastTime).getTime();
    const newCursor = new Date(lastMs + 60_000).toISOString();

    if (newCursor <= cursor) break;
    cursor = newCursor;

    if (pairRows % 50_000 === 0) {
      console.log(
        `[backfill] ${symbol}: ${pairRows.toLocaleString()} rows | through ${lastTime.slice(0, 16)}`
      );
    }
  }

  await sender.flush();
  await sender.close();

  console.log(
    `[backfill] ${symbol} complete: ${pairRows.toLocaleString()} rows`
  );
  return pairRows;
}

async function backfill(
  pairs: string[],
  fromDate: string,
  toDate: string
): Promise<void> {
  const secrets = loadSecrets();
  const base = baseUrl(secrets.env);

  console.log(
    `[backfill] ${pairs.length} pairs (parallel) | ${fromDate} -> ${toDate} | env: ${secrets.env}`
  );

  const startTime = Date.now();

  // Run all pairs concurrently — each gets its own Sender instance
  const results = await Promise.all(
    pairs.map((pair) => backfillPair(pair, fromDate, toDate, secrets.apiKey, base))
  );

  const totalRows = results.reduce((a, b) => a + b, 0);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[backfill] done: ${totalRows.toLocaleString()} total rows in ${elapsed}s`
  );
}

// ---------------------------------------------------------------------------
// Stream mode
// ---------------------------------------------------------------------------

async function stream(pairs: string[]): Promise<void> {
  const https = await import("node:https");
  const secrets = loadSecrets();
  const base = streamUrl(secrets.env);
  const configStr = `http::addr=${lake_HOST}:${lake_HTTP_PORT};auto_flush=off;`;

  const instruments = pairs.join(",");
  const streamPath = `/v3/accounts/${secrets.accountId}/pricing/stream?instruments=${encodeURIComponent(instruments)}`;
  const parsedBase = new URL(base);

  let reconnectAttempts = 0;

  while (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    const sender = await Sender.fromConfig(configStr);
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    let tickCount = 0;
    let lastFlush = Date.now();

    console.log(
      `[stream] connecting to ${pairs.length} pairs (attempt ${reconnectAttempts + 1})...`
    );

    try {
      await new Promise<void>((resolve, reject) => {
        const req = https.request(
          {
            hostname: parsedBase.hostname,
            port: 443,
            path: streamPath,
            method: "GET",
            headers: { Authorization: `Bearer ${secrets.apiKey}` },
          },
          (res) => {
            if (res.statusCode !== 200) {
              let body = "";
              res.on("data", (c: Buffer) => (body += c.toString()));
              res.on("end", () =>
                reject(new Error(`OANDA stream ${res.statusCode}: ${body}`))
              );
              return;
            }

            console.log(`[stream] connected, receiving ticks...`);
            reconnectAttempts = 0;

            const resetHeartbeat = () => {
              if (heartbeatTimer) clearTimeout(heartbeatTimer);
              heartbeatTimer = setTimeout(() => {
                console.log(
                  `[stream] no heartbeat for ${HEARTBEAT_TIMEOUT_MS / 1000}s, destroying connection...`
                );
                res.destroy();
              }, HEARTBEAT_TIMEOUT_MS);
            };
            resetHeartbeat();

            let buffer = "";

            res.on("data", async (chunk: Buffer) => {
              buffer += chunk.toString();
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.trim()) continue;

                let msg: any;
                try {
                  msg = JSON.parse(line);
                } catch {
                  continue;
                }

                resetHeartbeat();

                if (msg.type === "HEARTBEAT") continue;

                if (msg.type === "PRICE" && msg.tradeable) {
                  const symbol = oandaToSymbol(msg.instrument);
                  const bid = parseFloat(msg.bids?.[0]?.price || "0");
                  const ask = parseFloat(msg.asks?.[0]?.price || "0");
                  const mid = (bid + ask) / 2;
                  const tsMs = new Date(msg.time).getTime();

                  await sender
                    .table("ohlcv")
                    .symbol("symbol", symbol)
                    .symbol("asset_class", "forex")
                    .symbol("root", symbol)
                    .floatColumn("open", mid)
                    .floatColumn("high", mid)
                    .floatColumn("low", mid)
                    .floatColumn("close", mid)
                    .floatColumn("volume", 1)
                    .at(tsMs, "ms");

                  tickCount++;

                  // flush every 5 seconds or 100 ticks
                  if (
                    tickCount % 100 === 0 ||
                    Date.now() - lastFlush > 5000
                  ) {
                    await sender.flush();
                    lastFlush = Date.now();
                  }

                  if (tickCount % 1000 === 0) {
                    console.log(
                      `[stream] ${tickCount.toLocaleString()} ticks ingested`
                    );
                  }
                }
              }
            });

            res.on("end", () => resolve());
            res.on("error", (err: Error) => reject(err));
          }
        );

        req.on("error", (err: Error) => reject(err));
        req.end();
      });
    } catch (err: any) {
      console.error(`[stream] error: ${err.message}`);
    } finally {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      try {
        await sender.flush();
        await sender.close();
      } catch {}
    }

    reconnectAttempts++;
    console.log(`[stream] reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
    await sleep(RECONNECT_DELAY_MS);
  }

  console.error(
    `[stream] max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, exiting`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(): {
  mode: string;
  pairs: string[];
  from: string;
  to: string;
} {
  const args = process.argv.slice(2);
  const mode = args[0] || "backfill";

  let pairs = DEFAULT_PAIRS;
  let from = "2020-01-01T00:00:00Z";
  let to = new Date().toISOString();

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--pairs" && args[i + 1]) {
      pairs = args[i + 1].split(",").map((p) => {
        // accept both EURUSD and EUR_USD
        if (p.length === 6 && !p.includes("_")) {
          return `${p.slice(0, 3)}_${p.slice(3)}`;
        }
        return p;
      });
      i++;
    } else if (args[i] === "--from" && args[i + 1]) {
      from = args[i + 1].includes("T")
        ? args[i + 1]
        : `${args[i + 1]}T00:00:00Z`;
      i++;
    } else if (args[i] === "--to" && args[i + 1]) {
      to = args[i + 1].includes("T")
        ? args[i + 1]
        : `${args[i + 1]}T00:00:00Z`;
      i++;
    }
  }

  return { mode, pairs, from, to };
}

async function main() {
  const { mode, pairs, from, to } = parseArgs();

  switch (mode) {
    case "backfill":
      await backfill(pairs, from, to);
      break;
    case "stream":
      await stream(pairs);
      break;
    default:
      console.error(`Unknown mode: ${mode}. Use 'backfill' or 'stream'.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});

