import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "talib-indicator-catalogue",
  title: "Every TA-Lib indicator on front-month MNQ bars",
  summary:
    "161 TA-Lib functions expanded to 180 output columns on front-month MNQ bars (1-minute, 1-hour, 4-hour). Which columns are filled, what each one's distribution and trend look like, how often each of the 61 candlestick patterns fires, and the bars themselves as a wide table and as lines with the contract roll marked.",
  category: "Descriptive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/datalake/notebooks/mnq_talib_1m.py",
  related: [
    { label: "Market chart (indicators and candlestick patterns)", href: "/" },
    { label: "Data (lake column profiles)", href: "/data" },
  ],
};
