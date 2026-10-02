import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "data-lifecycle-audit",
  title: "The data lifecycle, audited",
  summary:
    "Every byte is stored, retrieved, moved, computed on, held in memory, saved temporarily and destroyed. The measured 2026-09-23 audit of that trip: 43 verified findings by stage and part of the system, what to fix first, every measurement behind them, and the two the verifiers struck.",
  category: "Diagnostic",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/notebooks/data_lifecycle_audit.py",
  related: [
    { label: "Lake audit: is market.bars clean?", href: "/studies/lake-audit" },
    { label: "Storage formats across the lake", href: "/studies/storage-format-inventory" },
    { label: "Data page: tables and row counts", href: "/data" },
  ],
};
