import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "eurusd-bars-and-labels",
  title: "EURUSD bars, forward labels and distributions",
  summary:
    "EURUSD candles at 1m to 1d on a log axis with the log return beneath, each bar's forward trend direction marked, the class balance and full distributions of every label column, and the development slice's log returns against the sealed fifth.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/Trading/forexmodel/notebooks/eurusd.py",
  related: [
    { label: "Market chart", href: "/" },
    { label: "Label catalog", href: "/labels" },
    { label: "Analytics", href: "/analytics" },
    { label: "FX pair signals", href: "/studies/fx-pair-signals" },
  ],
};
