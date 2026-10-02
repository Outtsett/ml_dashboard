/**
 * Data & infrastructure — where the numbers come from and what runs the job.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Data ───────────────────────────────────────────────────────────────
  {
    id: "tick-data",
    term: "tick data",
    domain: "data",
    definition:
      "Every individual quote or trade, unaggregated. **The only source that can answer a path question**, and orders of magnitude larger than bars.",
    see: ["ohlc", "path", "resampling"],
  },
  {
    id: "level-1-2-3",
    term: "Level 1 / 2 / 3 data",
    domain: "data",
    definition:
      "**L1** best bid and ask; **L2** aggregated depth per price level; **L3** every individual order with its identity.",
    see: ["order-book", "market-depth", "tick-data"],
  },
  {
    id: "consolidated-tape",
    term: "consolidated tape",
    domain: "data",
    definition:
      "A single merged record of all trades across venues. **Spot FX has none** — it is OTC, so every feed is one venue's view.",
    see: ["otc", "tick-data"],
  },
  {
    id: "data-vendor",
    term: "data vendor",
    domain: "data",
    aliases: ["databento", "oanda", "polygon", "refinitiv"],
    definition:
      "A supplier of market data. **Two vendors disagree on the same hour** — different venues, different filtering, different timestamp conventions.",
    why: "Reconciling sources is an analysis-time judgement. Storage should record what each venue said, not pick a winner.",
    see: ["consolidated-tape", "data-quality"],
  },
  {
    id: "data-quality",
    term: "data quality",
    domain: "data",
    aliases: ["bad print", "outlier tick", "stale quote"],
    definition:
      "Whether the data reflects the market. Bad prints, stale quotes, zero-volume bars, wrong timezones, duplicated rows.",
    why: "A fat tail from bad prints and one from macro releases are the same statistic and completely different facts. Check where the extremes land before modelling them.",
    see: ["outlier", "validation-rule", "session"],
  },
  {
    id: "validation-rule",
    term: "data validation",
    domain: "data",
    definition:
      "Assertions a row must satisfy to be stored — high ≥ low, high ≥ max(open, close), no negative volume, monotone timestamps.",
    why: "Quarantine the failures rather than clamping them: a clamped bad row is invisible, and a quarantined one is a bug report.",
    see: ["data-quality", "schema-contract"],
  },
  {
    id: "schema-contract",
    term: "schema contract",
    domain: "data",
    definition:
      "The agreed column names, types and constraints a dataset must satisfy, enforced at the write boundary.",
    see: ["validation-rule", "data-versioning"],
  },
  {
    id: "data-versioning",
    term: "data versioning",
    domain: "data",
    definition:
      "Being able to say exactly which bytes a model trained on. **A version number is an answer**; a file modification time is a guess.",
    see: ["reproducibility", "lakehouse", "point-in-time"],
  },
  {
    id: "lakehouse",
    term: "lakehouse",
    aliases: ["iceberg", "delta lake", "parquet", "hudi"],
    domain: "data",
    definition:
      "Table semantics — atomic append, schema evolution, snapshots, time travel — over columnar files in object storage.",
    why: "Atomic append matters most: a download that dies mid-write leaves the table at its previous version rather than a half-written file that reads as valid but is short.",
    see: ["parquet-columnar", "data-versioning", "medallion"],
  },
  {
    id: "parquet-columnar",
    term: "columnar storage",
    domain: "data",
    definition:
      "Storing by column rather than by row, so reading three columns of a hundred does not read the other ninety-seven. **Compresses far better**, since a column is homogeneous.",
    see: ["lakehouse", "olap"],
  },
  {
    id: "medallion",
    term: "bronze / silver / gold",
    domain: "data",
    definition:
      "Zones by refinement: **bronze** vendor bytes exactly as received, **silver** validated and conformed, **gold** aggregates ready to serve.",
    why: "Only bronze is irreplaceable. Everything downstream is rebuildable, which is what decides your backup policy.",
    see: ["lakehouse", "data-versioning"],
  },
  {
    id: "olap",
    term: "OLAP / OLTP",
    domain: "data",
    definition:
      "**OLTP** for many small transactional reads and writes; **OLAP** for scanning and aggregating large ranges. Different engines, different storage.",
    see: ["time-series-database", "parquet-columnar"],
  },
  {
    id: "time-series-database",
    term: "time-series database",
    aliases: ["lake", "influxdb", "timescale", "clickhouse"],
    domain: "data",
    definition:
      "A store optimised for timestamped, append-heavy data — time-partitioned, memory-mapped, with time-aware SQL like `SAMPLE BY` and `ASOF JOIN`.",
    why: "Rolling windows, gap detection and resampling belong here. Heavy vectorised maths over a contiguous block does not.",
    see: ["olap", "asof-join", "ilp"],
  },
  {
    id: "asof-join",
    term: "ASOF join",
    domain: "data",
    definition:
      "Joining each row to the most recent earlier row in another table. **The correct way to attach a quote to a trade** — an equality join would need identical timestamps.",
    see: ["time-series-database", "point-in-time"],
  },
  {
    id: "ilp",
    term: "ILP",
    expansion: "InfluxDB Line Protocol",
    domain: "data",
    definition:
      "A compact text format for streaming timestamped rows into a time-series database, batched and flushed rather than inserted one by one.",
    see: ["time-series-database", "idempotent-write"],
  },
  {
    id: "idempotent-write",
    term: "idempotent write",
    domain: "data",
    definition:
      "A write that can be repeated without changing the result — upsert on a natural key rather than blind append.",
    why: "Re-ingesting an overlapping date range is the normal shape of an incremental pull. Plain append silently doubles those rows.",
    see: ["schema-contract", "backfill"],
  },
  {
    id: "backfill",
    term: "backfill",
    domain: "data",
    definition:
      "Loading history for a period already passed, or recomputing a derived table after a definition changes.",
    see: ["idempotent-write", "data-versioning"],
  },
  {
    id: "partitioning",
    term: "partitioning",
    domain: "data",
    definition:
      "Splitting a table by a column — usually date — so a filtered query reads only the matching files.",
    why: "The single biggest lever on scan cost. Partition by what you filter on, not by what feels tidy.",
    see: ["parquet-columnar", "lakehouse"],
  },
  {
    id: "vectorisation",
    term: "vectorisation",
    aliases: ["simd", "numpy", "polars", "columnar compute"],
    domain: "infrastructure",
    definition:
      "Operating on whole arrays in one call so the work happens in compiled, SIMD-wide code instead of a Python loop.",
    why: "Usually two or three orders of magnitude. If a pipeline is slow, make the pipeline faster rather than training on less data.",
    see: ["parquet-columnar", "gpu"],
  },
  {
    id: "gpu",
    term: "GPU / CUDA",
    domain: "infrastructure",
    definition:
      "Massively parallel hardware for the dense linear algebra neural networks are made of. **VRAM is usually the binding constraint**, not compute.",
    see: ["mixed-precision", "vectorisation", "batch-size"],
  },
  {
    id: "mixed-precision",
    term: "mixed precision",
    aliases: ["amp", "fp16", "bf16"],
    domain: "infrastructure",
    definition:
      "Computing in 16-bit where it is safe and 32-bit where it is not. **Roughly halves memory and speeds training** with no accuracy cost when loss scaling is handled.",
    see: ["gpu", "batch-size"],
  },
  {
    id: "streaming",
    term: "streaming vs batch",
    domain: "infrastructure",
    definition:
      "Processing events as they arrive versus in scheduled chunks. **Streaming is harder to reason about and the only option when latency matters.**",
    see: ["latency", "websocket"],
  },
  {
    id: "websocket",
    term: "WebSocket / SSE",
    domain: "infrastructure",
    definition:
      "**WebSocket** is a bidirectional persistent connection; **SSE** is one-way server-to-client over plain HTTP and reconnects on its own.",
    why: "For a dashboard pushing updates, SSE is usually enough and far simpler.",
    see: ["streaming", "backpressure"],
  },
  {
    id: "backpressure",
    term: "backpressure",
    domain: "infrastructure",
    definition:
      "What a fast producer does when a slow consumer cannot keep up — block, buffer, or drop. **Choosing none of the three means running out of memory.**",
    see: ["streaming", "websocket"],
  },
  {
    id: "idempotency-key",
    term: "idempotency key",
    domain: "infrastructure",
    definition:
      "A caller-supplied identifier letting a server recognise a retry and not perform the action twice. **Essential anywhere a retry could place a second order.**",
    see: ["idempotent-write"],
  },
  {
    id: "circuit-breaker-sw",
    term: "circuit breaker (software)",
    domain: "infrastructure",
    definition:
      "Stopping calls to a failing dependency for a cooling-off period instead of retrying into an outage.",
    see: ["kill-switch", "backpressure"],
  },
  {
    id: "observability",
    term: "observability",
    aliases: ["telemetry", "tracing", "metrics", "logging"],
    domain: "infrastructure",
    definition:
      "Being able to tell what a running system is doing from its outputs — logs, metrics and traces.",
    why: "A dev server that dies and parks silently is an observability failure before it is anything else.",
    see: ["experiment-tracking"],
  },
];
