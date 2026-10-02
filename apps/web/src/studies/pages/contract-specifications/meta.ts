import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "contract-specifications",
  title: "Stock-index futures: tick, contract size, months, rolls and hours",
  summary:
    "What one tick and one index point are worth for the 42 stock-index futures AMP lists (checked against CME Group), the profit formula operated tick by tick, when the lake's daily volume actually rolled against CME's roll date, and the Globex halt seen as the one stamped hour with no bars.",
  category: "Predictive",
  status: "active-research",
  replaces: "E:/source/repos/ml_dashboard/notebooks/contract_specifications.py",
  related: [
    { label: "Market chart (tick label and price scale)", href: "/" },
    { label: "Model Cycle (cost model reads these rows)", href: "/cycle" },
  ],
};
