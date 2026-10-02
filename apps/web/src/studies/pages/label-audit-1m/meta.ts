import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "label-audit-1m",
  title: "Label audit: every supervised target measured on MNQ 1m",
  summary:
    "Eleven label families measured on 2,340,445 one-minute MNQ bars: which baseline each must beat (direction's is not 0.50 and flips side with the horizon), which third classes are dead (triple barrier, swing), what the zero-range floor cost the volatility baseline, and which purge is too short. Eight findings, all applied 2026-08-02.",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/label_audit.py",
  related: [
    { label: "Label catalog and its audit record", href: "/labels" },
    { label: "Market chart", href: "/" },
  ],
};
