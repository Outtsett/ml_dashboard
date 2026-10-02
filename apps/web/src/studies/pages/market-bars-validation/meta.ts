import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "market-bars-validation",
  title: "Every column of market_bars validated against the lake",
  summary:
    "Row counts matching says every row arrived, not that the values did. The column-level evidence for the copy of Iceberg market.bars into PostgreSQL: pass and fail per tier and column, how full each column is, the OHLCV invariants counted on both sides, float sums to a relative 1e-9, bit-exact fingerprints, and the eight numbers of every column.",
  category: "Diagnostic",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/market_bars_columns.py",
  related: [{ label: "Data: lake objects and column profiles", href: "/data" }],
};
