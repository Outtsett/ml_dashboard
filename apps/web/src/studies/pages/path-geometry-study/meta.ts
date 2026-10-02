import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "path-geometry-study",
  title: "Path geometry: rise over run as shape",
  summary:
    "Does the efficiency ratio (net displacement over path length) say anything about the next hour on MNQ 1m? It separates a ramp from a scribble and sits below the random-walk line intraday, but four forecast targets are all null; a second half checks the direction label sits on the right bar.",
  category: "Predictive",
  status: "record-of-past-round",
  replaces: "E:/source/repos/ml_dashboard/Trading/quant/model/notebooks/path_geometry_study.py",
  related: [
    { label: "Label catalog", href: "/labels" },
    { label: "Direction labels on candles", href: "/studies/direction-labels-on-candles" },
    { label: "Market chart (Efficiency Ratio indicator)", href: "/" },
  ],
};
