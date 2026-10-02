/**
 * RegistryDetailDrawer — right-side drawer for a single model version.
 *
 * Sections:
 *   1. Header — version id · catalog · symbol · status
 *   2. Metadata grid — runner / data hash / hpo study / paths / dates
 *   3. Lineage — ancestor chain (oldest → current) + children list
 *   4. Deployments — past + active deployments for this version
 *   5. Actions — promote (with status target) / rollback (with parent target)
 *
 * Promotion supports dry-run preview so gates can be inspected before
 * committing. Override flow requires a `reason` and uses the X-User header
 * to attribute the override.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Undo2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/shared/ui/sheet";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { MetricCell } from "@/backtest/components";
import { fmtNum, fmtRelative, fmtShortId, fmtDateTime } from "@/shared/utils/format";

type ModelStatus = "candidate" | "shadow" | "paper" | "live" | "retired";

interface ModelVersion {
  versionId: number;
  catalogId: string;
  runnerKey: string;
  status: ModelStatus;
  dataHash: string;
  symbol: string;
  timeframe: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  featurePipeline: string;
  modelArtifactPath: string;
  diagnosticsPath: string;
  trainedAt: string;
  promotedAt: string | null;
  retiredAt: string | null;
  parentVersionId: number | null;
  hpoStudyId: string | null;
  metricsSummary: { headline?: number | null; [k: string]: unknown } | null;
}

interface DeploymentRow {
  deploymentId: number;
  versionId: number;
  mode: "shadow" | "paper" | "live";
  status: "running" | "paused" | "stopped" | "failed";
  startedAt: string;
  endedAt: string | null;
}

interface DetailResponse {
  version: ModelVersion;
  ancestors: ModelVersion[];
  children: ModelVersion[];
  deployments: DeploymentRow[];
}

interface RegistryDetailDrawerProps {
  versionId: number;
  onClose: () => void;
  onAction?: () => void;
}

const STATUS_OPTIONS: ModelStatus[] = [
  "candidate",
  "shadow",
  "paper",
  "live",
  "retired",
];

export function RegistryDetailDrawer({
  versionId,
  onClose,
  onAction,
}: RegistryDetailDrawerProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["model-version", versionId],
    queryFn: async (): Promise<DetailResponse> => {
      const r = await fetch(`/api/model-versions/${versionId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const [targetStatus, setTargetStatus] = useState<ModelStatus>("paper");
  const [overrideMode, setOverrideMode] = useState(false);
  const [reason, setReason] = useState("");

  const promoteMutation = useMutation({
    mutationFn: async (opts: { dryRun: boolean }) => {
      const body: Record<string, unknown> = {
        to_status: targetStatus,
        dryRun: opts.dryRun,
      };
      if (overrideMode) {
        body.override = true;
        body.reason = reason || "no reason provided";
      }
      const r = await fetch(`/api/model-versions/${versionId}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await r.json();
      if (!r.ok && !opts.dryRun) {
        throw new Error(
          payload?.error ?? `HTTP ${r.status}`,
        );
      }
      return { ok: r.ok, payload, dryRun: opts.dryRun };
    },
    onSuccess: ({ ok, payload, dryRun }) => {
      if (dryRun) {
        toast.message(
          payload?.allowed === false
            ? "Gates would BLOCK promotion"
            : "Gates would allow promotion",
          {
            description: payload?.message ?? `${payload?.results?.length ?? 0} gates evaluated`,
          },
        );
      } else if (ok) {
        toast.success(`Promoted version #${versionId} → ${targetStatus}`);
        queryClient.invalidateQueries({ queryKey: ["model-version", versionId] });
        onAction?.();
      } else {
        toast.error("Promotion blocked by gates");
      }
    },
    onError: (err: Error) => {
      toast.error("Promotion failed", { description: err.message });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: async () => {
      if (!data?.version.parentVersionId) {
        throw new Error("No parent version to roll back to");
      }
      const r = await fetch(`/api/model-versions/${versionId}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to_version_id: data.version.parentVersionId }),
      });
      if (!r.ok) {
        const payload = await r.json();
        throw new Error(payload?.error ?? `HTTP ${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      toast.success(`Rolled back from version #${versionId}`);
      queryClient.invalidateQueries({ queryKey: ["model-version", versionId] });
      onAction?.();
    },
    onError: (err: Error) => {
      toast.error("Rollback failed", { description: err.message });
    },
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full max-w-3xl overflow-y-auto p-0"
        data-testid="registry-detail-drawer"
      >
        <SheetHeader className="border-b border-border/50 p-4">
          {isLoading || !data ? (
            <SheetTitle className="font-display text-base">Loading version…</SheetTitle>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px]">
                  #{data.version.versionId}
                </Badge>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {data.version.catalogId}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {data.version.symbol}@{data.version.timeframe}
                </Badge>
                <Badge variant="outline" className="ml-auto font-mono text-[10px] uppercase">
                  {data.version.status}
                </Badge>
              </div>
              <SheetTitle className="font-display text-base font-semibold">
                {data.version.runnerKey}
              </SheetTitle>
              <SheetDescription className="font-mono text-[11px] text-muted-foreground">
                trained {fmtDateTime(Date.parse(data.version.trainedAt))} · data hash{" "}
                {fmtShortId(data.version.dataHash, 10)}
              </SheetDescription>
            </>
          )}
        </SheetHeader>

        {data && (
          <>
            {/* Metadata grid */}
            <section className="grid grid-cols-2 gap-2 p-4 text-[11px]">
              <MetaRow label="Headline" value={
                <MetricCell
                  value={fmtNum(
                    typeof data.version.metricsSummary?.headline === "number"
                      ? data.version.metricsSummary.headline
                      : null,
                    3,
                  )}
                  numeric={
                    typeof data.version.metricsSummary?.headline === "number"
                      ? data.version.metricsSummary.headline
                      : null
                  }
                  tone="auto"
                />
              } />
              <MetaRow label="HPO study" value={fmtShortId(data.version.hpoStudyId, 12)} />
              <MetaRow label="Feature pipeline" value={data.version.featurePipeline} />
              <MetaRow label="Date range" value={`${data.version.dateRangeStart} → ${data.version.dateRangeEnd}`} />
              <MetaRow label="Artifact" value={
                <span className="truncate text-[10px]">{data.version.modelArtifactPath}</span>
              } />
              <MetaRow label="Promoted" value={
                data.version.promotedAt ? fmtRelative(Date.parse(data.version.promotedAt)) : "—"
              } />
            </section>

            {/* Lineage chain */}
            <section className="border-t border-border/40 px-4 pb-4 pt-3">
              <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Lineage ({data.ancestors.length} ancestors · {data.children.length} children)
              </h3>
              <div className="flex flex-wrap items-center gap-1">
                {[...data.ancestors].reverse().map((a) => (
                  <LineageChip key={a.versionId} version={a} />
                ))}
                {data.ancestors.length > 0 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
                <LineageChip version={data.version} highlight />
                {data.children.length > 0 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
                {data.children.map((c) => (
                  <LineageChip key={c.versionId} version={c} />
                ))}
              </div>
            </section>

            {/* Deployments */}
            <section className="border-t border-border/40 px-4 pb-4 pt-3">
              <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Deployments ({data.deployments.length})
              </h3>
              {data.deployments.length === 0 ? (
                <p className="text-[11px] italic text-muted-foreground">
                  No deployment history.
                </p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border/40 text-[9px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-1 text-left">#</th>
                      <th className="py-1 text-left">Mode</th>
                      <th className="py-1 text-left">Status</th>
                      <th className="py-1 text-right">Started</th>
                      <th className="py-1 text-right">Ended</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deployments.map((d) => (
                      <tr key={d.deploymentId} className="border-b border-border/30">
                        <td className="py-1 font-mono">#{d.deploymentId}</td>
                        <td className="py-1 font-mono uppercase">{d.mode}</td>
                        <td className="py-1 font-mono uppercase">{d.status}</td>
                        <td className="py-1 text-right font-mono text-muted-foreground">
                          {fmtRelative(Date.parse(d.startedAt))}
                        </td>
                        <td className="py-1 text-right font-mono text-muted-foreground">
                          {d.endedAt ? fmtRelative(Date.parse(d.endedAt)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Actions */}
            <section className="border-t border-border/40 bg-card/60 px-4 pb-4 pt-3">
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Actions
              </h3>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Promote to
                  </Label>
                  <Select value={targetStatus} onValueChange={(v) => setTargetStatus(v as ModelStatus)}>
                    <SelectTrigger className="h-7 w-32 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s} className="text-[11px]">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="ml-2 flex items-center gap-1.5">
                    <Switch
                      id="override-switch"
                      checked={overrideMode}
                      onCheckedChange={setOverrideMode}
                    />
                    <Label
                      htmlFor="override-switch"
                      className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      Override gates
                    </Label>
                  </div>
                </div>

                {overrideMode && (
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for override (required for audit log)"
                    className="h-16 text-[11px]"
                  />
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    disabled={promoteMutation.isPending}
                    onClick={() => promoteMutation.mutate({ dryRun: true })}
                  >
                    Dry-run gates
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={
                      promoteMutation.isPending ||
                      (overrideMode && reason.trim().length < 5)
                    }
                    onClick={() => promoteMutation.mutate({ dryRun: false })}
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Promote → {targetStatus}
                  </Button>

                  <Button
                    size="sm"
                    variant="destructive"
                    className="ml-auto h-7 text-[11px]"
                    disabled={
                      !data.version.parentVersionId || rollbackMutation.isPending
                    }
                    onClick={() => rollbackMutation.mutate()}
                  >
                    <Undo2 className="mr-1 h-3 w-3" />
                    Rollback to #{data.version.parentVersionId ?? "—"}
                  </Button>
                </div>
              </div>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/30 pb-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="truncate font-mono text-[11px] text-foreground/90">
        {value}
      </span>
    </div>
  );
}

function LineageChip({
  version,
  highlight = false,
}: {
  version: { versionId: number; status: string; metricsSummary?: { headline?: number | null } | null };
  highlight?: boolean;
}) {
  const head = version.metricsSummary?.headline;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${
        highlight
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border/40 bg-white/[0.02] text-muted-foreground"
      }`}
    >
      #{version.versionId}
      <span className="uppercase text-[9px]">{version.status}</span>
      {typeof head === "number" && (
        <span className="text-[9px] text-foreground/70">
          {head.toFixed(2)}
        </span>
      )}
    </span>
  );
}
