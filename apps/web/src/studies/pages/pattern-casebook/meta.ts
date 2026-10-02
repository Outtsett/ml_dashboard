import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "pattern-casebook",
  title: "Pattern casebook: the findings as trades",
  summary:
    "The 2026-09-15 'no edge' results for TA-Lib candle patterns on MNQ 2021-2025, restated as dated trades: enter at the next open, exit at the close of candle k, whole ticks and dollars on one contract after the round trip, each beside random bars traded the same way; plus the arithmetic of the 1-minute 'last move' rule.",
  category: "Prescriptive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/findings_casebook.py",
  related: [
    { label: "Candle pattern scorecard", href: "/studies/candle-pattern-scorecard" },
    { label: "Market chart pattern overlays", href: "/" },
    { label: "Analytics (cost-adjusted)", href: "/analytics" },
  ],
};
