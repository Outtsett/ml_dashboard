import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "tail-clocks",
  title: "Fat tails and how many the calendar invents",
  summary:
    "Sample the same 1-minute futures data every N minutes, every N contracts or every N dollars, with the same bar count, and count the moves beyond k standard deviations against what a bell curve predicts. The calendar clock carries most of the fat tail; the activity clocks carry far less.",
  category: "Descriptive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/datalake/notebooks/tails.py",
  related: [
    { label: "Analytics: hourly movement profile", href: "/analytics" },
    { label: "Market chart", href: "/" },
  ],
};
