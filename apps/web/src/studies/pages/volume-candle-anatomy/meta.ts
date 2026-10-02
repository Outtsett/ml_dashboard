import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "volume-candle-anatomy",
  title: "Volume and the parts of a candle",
  summary:
    "What each reading of a volume bar (raw contracts, height against the trailing maximum, z-score, rank, colour-signed) says about the upper wick, lower wick and body of the same MNQ candle, with a bid-ask-bounce control and a mutual-information test for dependence a correlation cannot see.",
  category: "Diagnostic",
  status: "record-of-past-round",
  replaces: "E:/source/repos/datalake/notebooks/volume_candle_anatomy.py",
  related: [
    { label: "Price regression", href: "/regression" },
    { label: "Analytics", href: "/analytics" },
  ],
};
