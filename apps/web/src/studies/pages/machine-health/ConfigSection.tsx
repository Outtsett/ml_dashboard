/**
 * The configuration changes made to this machine, each with the exact command
 * that reverts it (one click copies it), and the login items per snapshot.
 */

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Finding, Section, fmtTime } from "@/studies/kit";
import type { ConfigurationRow, StartupRow } from "@shared/studies/machine-health";
import { DataTable, type TableColumn } from "./DataTable";

function CopyCommand({ command }: { command: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!command) return <span className="text-neutral-500">none</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the command stays selectable in the cell.
    }
  };
  return (
    <span className="flex items-start gap-1.5">
      <button type="button" onClick={copy} className="mt-0.5 shrink-0 rounded border border-neutral-700 p-0.5 text-neutral-400 hover:text-neutral-100" title="Copy the revert command" aria-label="Copy the revert command">
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
      <code className="break-all font-mono text-[10px] text-neutral-200">{command}</code>
    </span>
  );
}

const CONFIGURATION_COLUMNS: Array<TableColumn<ConfigurationRow>> = [
  { key: "changed", header: "changed (local)", value: (row) => row.changedTime, render: (row) => fmtTime(row.changedTime), align: "right" },
  { key: "setting_path", header: "setting_path", value: (row) => row.settingPath, className: "break-all" },
  { key: "setting_name", header: "setting_name", value: (row) => row.settingName, className: "break-all" },
  { key: "value_before", header: "value_before", value: (row) => row.valueBefore },
  { key: "value_after", header: "value_after", value: (row) => row.valueAfter },
  { key: "change_reason", header: "change_reason", value: (row) => row.changeReason },
  { key: "revert_command", header: "revert_command", value: (row) => row.revertCommand, render: (row) => <CopyCommand command={row.revertCommand} /> },
];

const STARTUP_COLUMNS: Array<TableColumn<StartupRow>> = [
  { key: "snapshot_label", header: "snapshot_label", value: (row) => row.snapshotLabel },
  { key: "snapshot", header: "snapshot (local)", value: (row) => row.snapshotTime, render: (row) => fmtTime(row.snapshotTime), align: "right" },
  { key: "startup_location", header: "startup_location", value: (row) => row.startupLocation },
  { key: "entry_name", header: "entry_name", value: (row) => row.entryName, className: "break-all" },
  { key: "enabled", header: "enabled", value: (row) => (row.enabled ? "enabled" : "disabled") },
];

export function ConfigSection({ configuration, startup }: { configuration: ConfigurationRow[]; startup: StartupRow[] }) {
  const enabled = startup.filter((row) => row.enabled).length;
  return (
    <Section title="Configuration changes, each with its exact revert command" question="What was changed on this machine, and how is each change undone?">
      <div className="space-y-3">
        <Finding>
          {configuration.length} changes are recorded. Copy a revert command and run it in PowerShell to undo that one change.
        </Finding>
        <DataTable rows={configuration} columns={CONFIGURATION_COLUMNS} pageSize={15} />
        <div className="text-xs font-semibold text-neutral-200">Login items per snapshot</div>
        <Finding>{startup.length} login items in the snapshot, {enabled} enabled and {startup.length - enabled} disabled.</Finding>
        <DataTable rows={startup} columns={STARTUP_COLUMNS} pageSize={15} />
      </div>
    </Section>
  );
}
