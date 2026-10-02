import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "fx-pair-signals",
  title: "Forex pairs: cost, correlation and which features survive",
  summary:
    "For 18 spot pairs: what each costs to trade (spread in basis points, the 21:00 UTC rollover, spread / ATR(14) from 1m to 1d), how many independent bets the panel holds once the shared currency legs are removed, and which of 50 price-structure features beat a best-of-N day-block null for volatility against direction.",
  category: "Prescriptive",
  status: "active-research",
  replaces: "E:/source/repos/ml_dashboard/Trading/forexmodel/notebooks/19_pair_signals.py",
  related: [
    { label: "Analytics (one symbol)", href: "/analytics" },
    { label: "Market chart", href: "/" },
  ],
};
