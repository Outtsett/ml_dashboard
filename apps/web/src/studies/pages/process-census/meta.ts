import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "process-census",
  title: "Why are there so many node processes?",
  summary:
    "Counts the running processes and separates launcher plumbing (a shell wrapper that starts the next thing and idles) from runtime (a process doing work), shows who owns each one and how deep its launcher chain is, and models what each launch strategy costs: N = C x (L + R) + 2M + P.",
  category: "Predictive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/ml_dashboard/notebooks/process_census.py",
  related: [
    { label: "System", href: "/system" },
    { label: "Hardware (live telemetry)", href: "/hardware" },
    { label: "Machine health study", href: "/studies/machine-health" },
  ],
};
