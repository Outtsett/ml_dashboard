import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "feature-ladder-what-to-encode",
  title: "How do you know what to encode?",
  summary:
    "An incremental feature ladder on MNQ 5-minute bars, fitted 2021-2023 and scored once on 2025: each rung adds one named block, and it must beat a best-of-five shuffled copy of itself on the target you care about. Four targets, four different answers.",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/what_to_encode.py",
  related: [
    { label: "Analytics: the four layers for a symbol", href: "/analytics" },
    { label: "Label catalog", href: "/labels" },
  ],
};
