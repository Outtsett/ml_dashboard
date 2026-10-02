import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "lake-audit",
  title: "Lake audit: is market.bars clean?",
  summary:
    "The data-quality audit of the Iceberg bars table: 21 row-level checks (errors against warnings, rows a clean would drop against rows it only reports), duplicate uniqueness keys, per-slice coverage and staleness, every past run and its remediation.",
  category: "Diagnostic",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/datalake/notebooks/lake_audit.py",
  related: [{ label: "Data page: tables and row counts", href: "/data" }],
};
