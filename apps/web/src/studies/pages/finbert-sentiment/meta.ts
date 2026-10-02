import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "finbert-sentiment",
  title: "FinBERT news sentiment: what every model reads",
  summary:
    "The nine finbert_* columns every model is trained with: which scored headlines reach an instrument, how they are added up bar by bar with a fading weight, and a stepper that expands the decayed sum S(t) into its headlines for any bar and half-life.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/notebooks/finbert_sentiment.py",
  related: [
    { label: "Live data hub: news tape and sentiment", href: "/live" },
    { label: "Analytics (news layer)", href: "/analytics" },
  ],
};
