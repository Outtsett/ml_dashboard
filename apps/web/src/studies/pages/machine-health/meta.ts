import type { StudyMeta } from "../../types";

export const meta: StudyMeta = {
  slug: "machine-health",
  title: "Machine health: crashes, resets, dumps, background load",
  summary:
    "A forensic view of this PC's stability: every application crash and hang, kernel bugcheck and hard reset from the Windows event logs, the time between unclean shutdowns, which programs crash and whether a dump was kept, the dump files on disk, a background-process snapshot, and each configuration change with its exact revert command.",
  category: "Descriptive",
  status: "diagnostic-tool",
  replaces: "E:/source/repos/dotfiles/diagnostics/notebooks/machine_health.py",
  related: [
    { label: "Hardware (live telemetry)", href: "/hardware" },
    { label: "System", href: "/system" },
  ],
};
