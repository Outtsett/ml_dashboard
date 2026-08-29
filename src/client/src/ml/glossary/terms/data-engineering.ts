/**
 * Data engineering — moving data, and the constructs that keep it correct.
 *
 * SRP: Data only. Merged by `../index.ts`.
 *
 * `data-infra.ts` holds the storage layer and the market-data specifics. This
 * file is the pipeline layer: orchestration, modelling, streaming semantics,
 * and the correctness constructs (idempotency, watermarks, delivery guarantees)
 * that decide whether a re-run produces the same table twice.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Pipelines and orchestration ────────────────────────────────────────
  {
    id: "etl-elt",
    term: "ETL vs ELT",
    domain: "data-engineering",
    definition:
      "**ETL** transforms before loading, so the warehouse only ever holds clean data. **ELT** loads raw first and transforms in place, so the raw bytes survive and a transform bug is fixable without re-fetching.",
    why: "ELT won because storage got cheap and re-fetching a vendor's history did not.",
    see: ["medallion", "pipeline", "backfill"],
  },
  {
    id: "pipeline",
    term: "pipeline",
    domain: "data-engineering",
    definition:
      "An ordered set of steps turning source data into something usable. **Its correctness is a property of the whole chain**, not of any one step.",
    see: ["dag", "orchestration", "lineage"],
  },
  {
    id: "dag",
    term: "DAG",
    expansion: "Directed Acyclic Graph",
    domain: "data-engineering",
    definition:
      "Tasks with dependencies and no cycles — the shape every orchestrator uses. **Acyclic is the load-bearing word**: it guarantees a valid execution order exists.",
    see: ["orchestration", "task-dependency", "pipeline"],
  },
  {
    id: "orchestration",
    term: "orchestration",
    aliases: ["airflow", "dagster", "prefect", "scheduler"],
    domain: "data-engineering",
    definition:
      "Deciding what runs, when, in what order, and what to do when it fails. **Scheduling is the easy half; failure handling is the job.**",
    see: ["dag", "retry", "sla", "backfill"],
  },
  {
    id: "task-dependency",
    term: "task dependency",
    domain: "data-engineering",
    definition:
      "An edge saying one step must finish before another starts. **Sensors** wait on an external condition — a file landing, a partition appearing — instead of a clock.",
    see: ["dag", "orchestration"],
  },
  {
    id: "retry",
    term: "retry & exponential backoff",
    domain: "data-engineering",
    definition:
      "Re-running a failed task, with a doubling delay and jitter so a fleet of retries does not synchronise into a thundering herd.",
    why: "Only safe when the task is idempotent. Retrying a non-idempotent append doubles the rows.",
    see: ["idempotent-write", "circuit-breaker-sw", "dead-letter-queue"],
  },
  {
    id: "sla",
    term: "SLA / freshness",
    domain: "data-engineering",
    definition:
      "How late a dataset is allowed to be before someone is told. **Freshness is a data-quality dimension** as much as correctness is — a perfectly accurate table from yesterday is wrong for a live model.",
    see: ["orchestration", "observability", "data-quality"],
  },
  {
    id: "de-backfill",
    term: "backfill & reprocessing",
    domain: "data-engineering",
    definition:
      "Running a pipeline over historical partitions — because history arrived late, or because the logic changed and yesterday's output is now wrong.",
    why: "The reason transforms must be **deterministic and idempotent**: a backfill re-runs them over data that already produced output once.",
    see: ["idempotent-write", "backfill", "partitioning"],
  },
  {
    id: "cdc",
    term: "CDC",
    expansion: "Change Data Capture",
    domain: "data-engineering",
    definition:
      "Streaming a database's row-level changes — usually by tailing its write-ahead log — instead of polling for what looks new.",
    why: "Polling on `updated_at` misses hard deletes and anything updated inside the polling window. CDC misses neither.",
    see: ["wal", "streaming", "upsert"],
  },
  {
    id: "upsert",
    term: "upsert / merge",
    symbol: "MERGE INTO … ON key WHEN MATCHED …",
    domain: "data-engineering",
    definition:
      "Insert if the key is new, update if it exists. **The operation that makes a re-run safe** where a plain insert would duplicate.",
    see: ["idempotent-write", "natural-key", "de-backfill"],
  },
  {
    id: "natural-key",
    term: "natural vs surrogate key",
    domain: "data-engineering",
    definition:
      "A **natural key** identifies a row by what it means — (symbol, timeframe, timestamp, venue). A **surrogate key** is a generated id with no meaning.",
    why: "The natural key defines what a duplicate IS. Getting it wrong — omitting the venue, say — silently collapses two genuine observations into one.",
    see: ["upsert", "idempotent-write", "schema-contract"],
  },

  // ── Modelling ──────────────────────────────────────────────────────────
  {
    id: "star-schema",
    term: "star schema",
    aliases: ["dimensional modelling", "kimball", "snowflake schema"],
    domain: "data-engineering",
    definition:
      "A central **fact** table of measurements surrounded by **dimension** tables of descriptive attributes. Denormalised on purpose, for query speed.",
    see: ["fact-dimension", "normalisation", "olap"],
  },
  {
    id: "fact-dimension",
    term: "fact vs dimension",
    domain: "data-engineering",
    definition:
      "**Facts** are the numeric events you aggregate — a trade, a fill, a bar. **Dimensions** are the context you slice by — instrument, venue, session, strategy.",
    see: ["star-schema", "grain"],
  },
  {
    id: "grain",
    term: "grain",
    domain: "data-engineering",
    definition:
      "What exactly one row of a table represents. **The first thing to declare and the one most often left implicit** — *one bar per symbol per minute per venue* is a grain; *bars* is not.",
    why: "Every duplicate bug and every double-counted aggregate is a grain that was never written down.",
    see: ["natural-key", "fact-dimension", "schema-contract"],
  },
  {
    id: "scd",
    term: "SCD",
    expansion: "Slowly Changing Dimension",
    domain: "data-engineering",
    definition:
      "How a dimension records change over time. **Type 1** overwrites and loses history; **Type 2** adds a row with valid-from/valid-to so the past stays queryable.",
    why: "Type 2 is what makes point-in-time correctness possible. Type 1 quietly rewrites history and creates look-ahead.",
    see: ["point-in-time", "look-ahead-bias", "temporal-table"],
  },
  {
    id: "temporal-table",
    term: "bitemporal data",
    domain: "data-engineering",
    definition:
      "Tracking two clocks: when something was **true in the world**, and when the system **learned it**. A restated figure changes the second without changing the first.",
    see: ["scd", "point-in-time", "event-time"],
  },
  {
    id: "normalisation",
    term: "normalisation vs denormalisation",
    domain: "data-engineering",
    definition:
      "**Normalised** stores each fact once and joins to assemble; **denormalised** duplicates it to avoid joins. Transactional systems normalise, analytical ones do not.",
    why: "Not to be confused with normalising a feature. Same word, unrelated meaning.",
    see: ["star-schema", "olap", "z-score"],
  },
  {
    id: "materialised-view",
    term: "materialised view",
    domain: "data-engineering",
    definition:
      "A query's result stored as a table and refreshed on a schedule or incrementally. **Trades staleness for speed.**",
    see: ["incremental-model", "olap", "time-series-database"],
  },
  {
    id: "incremental-model",
    term: "incremental model",
    domain: "data-engineering",
    definition:
      "A transform that processes only new or changed rows rather than rebuilding from scratch, usually keyed on a high-water mark.",
    why: "Fast, and it diverges from a full rebuild the moment late data arrives — which is why a periodic full refresh is worth keeping.",
    see: ["watermark", "late-arriving-data", "de-backfill"],
  },

  // ── Streaming semantics ────────────────────────────────────────────────
  {
    id: "event-time",
    term: "event time vs processing time",
    domain: "data-engineering",
    definition:
      "**Event time** is when it happened; **processing time** is when your system saw it. They differ by network delay, batching, and outages.",
    why: "Aggregating on processing time puts a delayed trade in the wrong minute. Every windowed calculation in market data must key on event time.",
    see: ["watermark", "late-arriving-data", "temporal-table"],
  },
  {
    id: "watermark",
    term: "watermark",
    domain: "data-engineering",
    definition:
      "The stream's assertion that no event older than time T will arrive — the signal that a window can be closed and emitted.",
    why: "Sets the trade-off directly: an aggressive watermark emits fast and drops stragglers; a conservative one is complete and late.",
    see: ["event-time", "late-arriving-data", "windowing"],
  },
  {
    id: "late-arriving-data",
    term: "late-arriving data",
    domain: "data-engineering",
    definition:
      "Events showing up after their window closed. Options: drop, emit a correction, or hold windows open longer.",
    why: "The reason a metric silently changes after the fact — and why a backtest built on a corrected table is not what the model would have seen live.",
    see: ["watermark", "point-in-time", "incremental-model"],
  },
  {
    id: "windowing",
    term: "windowing",
    aliases: ["tumbling", "sliding", "session window", "hopping"],
    domain: "data-engineering",
    definition:
      "How a stream is chunked. **Tumbling** windows are fixed and non-overlapping; **sliding/hopping** overlap; **session** windows close after a gap of inactivity.",
    see: ["watermark", "event-time", "rolling-window"],
  },
  {
    id: "delivery-guarantees",
    term: "at-most-once / at-least-once / exactly-once",
    domain: "data-engineering",
    definition:
      "**At-most-once** may lose messages; **at-least-once** may duplicate; **exactly-once** does neither — and is normally achieved as at-least-once delivery plus an idempotent consumer, not as a genuine primitive.",
    see: ["idempotent-write", "retry", "offset"],
  },
  {
    id: "message-broker",
    term: "message broker",
    aliases: ["kafka", "pulsar", "rabbitmq", "queue"],
    domain: "data-engineering",
    definition:
      "A durable buffer between producers and consumers, so neither has to be up when the other is. **Decouples rate as well as availability.**",
    see: ["topic-partition", "offset", "backpressure"],
  },
  {
    id: "topic-partition",
    term: "topic & partition",
    domain: "data-engineering",
    definition:
      "A **topic** is a named stream; **partitions** split it for parallelism. Ordering is guaranteed **within a partition only**.",
    why: "So the partition key decides what stays ordered. Key by instrument and one instrument's events stay in sequence; key randomly and they do not.",
    see: ["message-broker", "offset", "consumer-group"],
  },
  {
    id: "offset",
    term: "offset & commit",
    domain: "data-engineering",
    definition:
      "A consumer's position in a partition. **Committing before processing risks loss; committing after risks duplication** — which is why the consumer has to be idempotent.",
    see: ["delivery-guarantees", "consumer-group", "topic-partition"],
  },
  {
    id: "consumer-group",
    term: "consumer group",
    domain: "data-engineering",
    definition:
      "A set of consumers sharing a partition assignment so each message is handled once by the group. **Rebalancing** redistributes partitions when membership changes.",
    see: ["topic-partition", "offset"],
  },
  {
    id: "dead-letter-queue",
    term: "dead-letter queue",
    expansion: "DLQ",
    domain: "data-engineering",
    definition:
      "Where a message goes after failing repeatedly, so one bad record cannot block the partition behind it.",
    why: "Without one, a single unparseable message stalls the stream indefinitely — the poison-pill failure.",
    see: ["retry", "message-broker", "validation-rule"],
  },
  {
    id: "micro-batch",
    term: "micro-batch",
    domain: "data-engineering",
    definition:
      "Processing a stream in small fixed intervals. **The pragmatic middle ground** — most of streaming's freshness with batch's simpler failure semantics.",
    see: ["streaming", "windowing"],
  },

  // ── Storage mechanics ──────────────────────────────────────────────────
  {
    id: "wal",
    term: "WAL",
    expansion: "Write-Ahead Log",
    domain: "data-engineering",
    definition:
      "Every change appended to a durable log before being applied. **The basis of crash recovery**, of replication, and of change data capture.",
    see: ["acid", "cdc", "replication"],
  },
  {
    id: "acid",
    term: "ACID",
    expansion: "Atomicity, Consistency, Isolation, Durability",
    domain: "data-engineering",
    definition:
      "**Atomic** all-or-nothing, **consistent** invariants preserved, **isolated** concurrent transactions do not see each other's partial work, **durable** survives a crash.",
    why: "Atomicity is what stops a half-written load reading as a complete one.",
    see: ["wal", "isolation-level", "lakehouse"],
  },
  {
    id: "isolation-level",
    term: "isolation level",
    aliases: ["read committed", "repeatable read", "serializable", "snapshot"],
    domain: "data-engineering",
    definition:
      "How much concurrent transactions can see of each other. **Serializable** is strongest and slowest; **snapshot** gives each transaction a consistent point-in-time view.",
    see: ["acid", "eventual-consistency"],
  },
  {
    id: "eventual-consistency",
    term: "eventual consistency & CAP",
    domain: "data-engineering",
    definition:
      "Replicas converge given time without new writes. **CAP**: under a network partition you choose consistency or availability, not both.",
    see: ["replication", "isolation-level"],
  },
  {
    id: "replication",
    term: "replication & sharding",
    domain: "data-engineering",
    definition:
      "**Replication** copies the same data for durability and read scale; **sharding** splits different data across nodes for write scale. Different problems, often confused.",
    see: ["eventual-consistency", "partitioning"],
  },
  {
    id: "compaction",
    term: "compaction & vacuum",
    domain: "data-engineering",
    definition:
      "Merging many small files into fewer large ones and reclaiming space from deleted versions. **Small-file proliferation is the standard lakehouse performance failure.**",
    see: ["lakehouse", "partitioning", "parquet-columnar"],
  },
  {
    id: "predicate-pushdown",
    term: "predicate & projection pushdown",
    domain: "data-engineering",
    definition:
      "Pushing filters and column selection down to the storage layer, so unmatched row groups and unread columns are never loaded.",
    why: "With partitioning and column statistics, a well-filtered query on a terabyte table can touch a few megabytes.",
    see: ["parquet-columnar", "partitioning", "z-order"],
  },
  {
    id: "z-order",
    term: "Z-ordering / clustering",
    domain: "data-engineering",
    definition:
      "Physically co-locating rows that are near each other in several columns at once, so filters on any of them skip more files.",
    see: ["predicate-pushdown", "partitioning", "compaction"],
  },
  {
    id: "bloom-filter",
    term: "Bloom filter",
    domain: "data-engineering",
    definition:
      "A compact probabilistic set: **no false negatives, some false positives**. Cheaply answers *is this key definitely absent from this file*.",
    see: ["predicate-pushdown", "partitioning"],
  },
  {
    id: "shuffle",
    term: "shuffle & data skew",
    domain: "data-engineering",
    definition:
      "Redistributing rows across workers so matching keys meet — the expensive step in any distributed join or group-by. **Skew** is one key holding far more rows than the rest, so one worker does all the work.",
    why: "A single dominant instrument in a market dataset is a textbook skew: every other partition finishes and one runs for an hour.",
    see: ["broadcast-join", "partitioning", "spill"],
  },
  {
    id: "broadcast-join",
    term: "broadcast join",
    domain: "data-engineering",
    definition:
      "Sending a small table to every worker so a join needs no shuffle at all. **Only safe while the small side stays small.**",
    see: ["shuffle", "spill"],
  },
  {
    id: "spill",
    term: "spill to disk",
    domain: "data-engineering",
    definition:
      "Writing intermediate results out when they exceed memory. **Correct, and often a hundred times slower** — usually the reason a job that used to finish now does not.",
    see: ["shuffle", "vectorisation"],
  },

  // ── Governance ─────────────────────────────────────────────────────────
  {
    id: "lineage",
    term: "lineage",
    domain: "data-engineering",
    definition:
      "The recorded path from source to output — which inputs, which code version, which run produced this table.",
    why: "Answers the only question that matters after a bad number ships: what else came from the same place.",
    see: ["data-versioning", "data-contract", "reproducibility"],
  },
  {
    id: "data-contract",
    term: "data contract",
    domain: "data-engineering",
    definition:
      "An explicit agreement on schema, semantics, freshness and ownership between a producer and its consumers, enforced at the boundary.",
    why: "Turns a silent breaking change into a failed write, which is where you want to find it.",
    see: ["schema-contract", "schema-evolution", "validation-rule"],
  },
  {
    id: "schema-evolution",
    term: "schema evolution",
    aliases: ["backward compatible", "forward compatible"],
    domain: "data-engineering",
    definition:
      "Changing a schema without breaking readers. **Adding a nullable column is safe; renaming or retyping one is not.**",
    see: ["data-contract", "serialisation-format", "lakehouse"],
  },
  {
    id: "serialisation-format",
    term: "Avro / Protobuf / JSON",
    domain: "data-engineering",
    definition:
      "Wire formats. **JSON** is readable and large; **Avro** carries its schema and suits row-oriented streams; **Protobuf** is compact and needs a shared definition.",
    see: ["schema-registry", "parquet-columnar", "schema-evolution"],
  },
  {
    id: "schema-registry",
    term: "schema registry",
    domain: "data-engineering",
    definition:
      "A central store of message schemas and their versions, so producers and consumers agree and compatibility is checked before a change ships.",
    see: ["serialisation-format", "data-contract", "schema-evolution"],
  },
  {
    id: "data-catalog",
    term: "data catalog",
    domain: "data-engineering",
    definition:
      "The searchable inventory of what datasets exist, what they mean, who owns them and where they came from.",
    see: ["lineage", "data-contract", "data-mesh"],
  },
  {
    id: "data-mesh",
    term: "data mesh",
    domain: "data-engineering",
    definition:
      "Treating each domain's data as a product its own team owns and publishes, rather than routing everything through one central team.",
    why: "An organisational answer to a bottleneck. It needs strong contracts and a real catalog to not become a swamp.",
    see: ["data-contract", "data-catalog"],
  },
  {
    id: "retention-ttl",
    term: "retention & TTL",
    domain: "data-engineering",
    definition:
      "How long data is kept before deletion or archival. **Driven by cost, by regulation, and by what is actually reconstructible.**",
    why: "Only irreplaceable raw data needs backing up. Anything a script can rebuild is a cache with a long name.",
    see: ["medallion", "data-versioning"],
  },
  {
    id: "pii",
    term: "PII & anonymisation",
    expansion: "Personally Identifiable Information",
    domain: "data-engineering",
    definition:
      "Data identifying a person. **Pseudonymisation** replaces identifiers with tokens and is reversible; **anonymisation** is meant not to be.",
    why: "Re-identification from combined quasi-identifiers is easier than it looks, so *anonymised* is a claim to test rather than assume.",
    see: ["retention-ttl", "data-contract"],
  },
  {
    id: "reconciliation",
    term: "reconciliation",
    domain: "data-engineering",
    definition:
      "Checking two independent sources of the same quantity agree — a vendor feed against the exchange, a computed P&L against the broker's.",
    why: "The only check that catches an error both sides of your own pipeline share.",
    see: ["data-quality", "data-vendor", "validation-rule"],
  },
];
