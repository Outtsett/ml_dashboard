import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "storage-format-inventory",
  title: "Is all my data in parquet?",
  summary:
    "Which physical file format holds the bytes across the lake and the data-bearing repositories (17,876 files measured 2026-09-11), sliced by store, zone, format family and file size.",
  category: "Descriptive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/data_format_inventory.py",
  related: [{ label: "Lake objects and row counts (Data)", href: "/databases" }],
};
