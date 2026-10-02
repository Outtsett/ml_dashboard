import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "timescaledb-load-monitor",
  title: "market_bars into TimescaleDB: the monthly load",
  summary:
    "The loader's log of 179 monthly INSERT commits moving the lake's futures 1-second slice into a TimescaleDB hypertable: throughput, bytes per row cumulative against marginal, and whether a bigger month is proportionally slower.",
  category: "Diagnostic",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/timescaledb_load.py",
  related: [{ label: "Storage format inventory", href: "/studies/storage-format-inventory" }],
};
