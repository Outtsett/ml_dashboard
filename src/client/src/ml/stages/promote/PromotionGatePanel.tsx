/**
 * PromotionGatePanel — Gate-by-gate promotion preview + commit.
 *
 * W7.e of `docs/plans/2026-05-09-ml-studio-workshop-integration-frontend.md`.
 * Renders inside the right Sheet drawer when `state.drawerMode === "promote"`.
 *
 * Flow:
 *   1. POST /api/model-versions/:id/promote { to_status, dryRun: true }
 *      → server returns the gate-by-gate evaluation (measured value,
 *        threshold, pass/fail, optional reason). We use TanStack Query so
 *        the dry-run is cached per (versionId, toStatus).
 *   2. Render each gate with green ✓ / red ✗ / amber ? (null + reason).
 *   3. If all pass OR user enters an override reason, the commit button
 *      becomes enabled. Commit posts the same payload with `dryRun: false`
 *      (and `override: true, reason: ...` if the user used override).
 *   4. On success, dispatch `setSelectedVersion(null)` to close the drawer
 *      and invalidate the registry query so the row re-renders with its new
 *      status.
 *
 * Promotion ladder: candidate → shadow → paper → live → retired. The next
 * status is computed from the version's current status; "live" steps to
 * "retired" only via a guarded path (user can still override).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Rocket,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Textarea } from "@/shared/ui/textarea";
import { Label } from "@/shared/ui/label";
import { toast } from "sonner";
import { apiRequest } from "@/infrastructure/api/query_client";
import { useMLStudio } from "../../MLStudioContext";
import type { ModelVersionStatus } from "./RegistryTable";

// ─── Types (mirror server `/promote` response) ───────────────────────────────

export interface PromotionGate {
  id: string;
  label: string;
  /** "Sharpe ≥ 0.20", "ECE ≤ 0.10", "fold-σ ≤ 0.30" — already formatted. */
  thresholdLabel: string;
  measured: number | null;
  passed: boolean;
  /** Populated when measured is null OR passed is false. */
  reason: string | null;
}

export interface PromotionDryRun {
  versionId: number;
  fromStatus: ModelVersionStatus;
  toStatus: ModelVersionStatus;
  gates: PromotionGate[];
  allPassed: boolean;
  /** True iff the server rule allows promotion to `toStatus` from `fromStatus`. */
  transitionAllowed: boolean;
  transitionDeniedReason: string | null;
}

export interface PromotionCommitResult {
  versionId: number;
  status: ModelVersionStatus;
  promotedAt: string;
}

// ─── Promotion ladder ─────────────────────────────────────────────────────────

const PROMOTION_LADDER: ModelVersionStatus[] = [
  "candidate",
  "shadow",
  "paper",
  "live",
];

export function nextStatus(current: ModelVersionStatus): ModelVersionStatus | null {
  const idx = PROMOTION_LADDER.indexOf(current);
  if (idx === -1) return null; // retired
  if (idx === PROMOTION_LADDER.length - 1) return "retired";
  return PROMOTION_LADDER[idx + 1] ?? null;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function usePromotionDryRun(
  versionId: number | null,
  toStatus: ModelVersionStatus | null,
) {
  return useQuery<PromotionDryRun>({
    queryKey: ["/api/model-versions", versionId, "promote", "dryRun", toStatus],
    enabled: versionId != null && toStatus != null,
    queryFn: async ({ signal }) => {
      if (versionId == null || toStatus == null) {
        throw new Error("missing versionId or toStatus");
      }
      const res = await fetch(`/api/model-versions/${versionId}/promote`, {
        method: "POST",
        signal,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_status: toStatus, dryRun: true }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      return (await res.json()) as PromotionDryRun;
    },
    staleTime: 15_000,
  });
}

interface CommitArgs {
  versionId: number;
  toStatus: ModelVersionStatus;
  override: boolean;
  reason: string | null;
}

// ─── Visual primitives ───────────────────────────────────────────────────────

function GateRow({ gate }: { gate: PromotionGate }) {
  const Icon = gate.passed
    ? CheckCircle2
    : gate.measured == null
      ? AlertTriangle
      : XCircle;
  const tone = gate.passed
    ? "text-emerald-300"
    : gate.measured == null
      ? "text-amber-300"
      : "text-rose-300";
  const measuredLabel =
    gate.measured == null
      ? "—"
      : Number.isFinite(gate.measured)
        ? gate.measured.toFixed(3)
        : "—";

  return (
    <li
      className={cn(
        "flex items-start gap-2 py-2 border-b border-white/5 last:border-0",
      )}
      data-testid={`gate-${gate.id}`}
    >
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", tone)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium text-foreground truncate">
            {gate.label}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/80 shrink-0">
            {gate.thresholdLabel}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 mt-0.5">
          <span className={cn("text-[10px]", tone)}>
            {gate.passed ? "Passed" : gate.measured == null ? "No data" : "Failed"}
          </span>
          <span className={cn("font-mono text-xs", tone)}>{measuredLabel}</span>
        </div>
        {gate.reason ? (
          <p className="mt-1 text-[10px] text-muted-foreground/80">
            {gate.reason}
          </p>
        ) : null}
      </div>
    </li>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface PromotionGatePanelProps {
  versionId: number;
  /** Current status of the version (drives the next-status target). */
  currentStatus: ModelVersionStatus;
  /** Optional override of next status (e.g. user picks shadow → paper directly). */
  forceTargetStatus?: ModelVersionStatus;
}

export function PromotionGatePanel({
  versionId,
  currentStatus,
  forceTargetStatus,
}: PromotionGatePanelProps) {
  const { dispatch } = useMLStudio();
  const queryClient = useQueryClient();

  const targetStatus = useMemo<ModelVersionStatus | null>(
    () => forceTargetStatus ?? nextStatus(currentStatus),
    [forceTargetStatus, currentStatus],
  );

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const dryRun = usePromotionDryRun(versionId, targetStatus);

  const commitMut = useMutation<PromotionCommitResult, Error, CommitArgs>({
    mutationFn: async (args) => {
      const res = await apiRequest(
        "POST",
        `/api/model-versions/${args.versionId}/promote`,
        {
          to_status: args.toStatus,
          dryRun: false,
          override: args.override,
          reason: args.reason,
        },
      );
      return (await res.json()) as PromotionCommitResult;
    },
    onSuccess: (result) => {
      toast.success(`Promoted to ${result.status}`);
      queryClient.invalidateQueries({ queryKey: ["/api/model-versions"] });
      dispatch({ type: "setSelectedVersion", versionId: null });
    },
    onError: (err) => {
      toast.error(`Promotion failed: ${err.message}`);
    },
  });

  if (targetStatus == null) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-xs text-muted-foreground">
        This version is retired — no further promotions allowed.
      </div>
    );
  }

  if (dryRun.isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Evaluating gates…
      </div>
    );
  }

  if (dryRun.isError) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-xs text-rose-300 flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Failed to evaluate gates</p>
          <p className="mt-1 font-mono text-[10px] text-rose-300/80">
            {(dryRun.error as Error)?.message}
          </p>
        </div>
      </div>
    );
  }

  const data = dryRun.data;
  if (!data) {
    return (
      <div className="text-xs text-muted-foreground py-8 text-center">
        No promotion data available.
      </div>
    );
  }

  const overrideUsed = overrideOpen && overrideReason.trim().length > 0;
  const canCommit = data.transitionAllowed && (data.allPassed || overrideUsed);

  const handleCommit = () => {
    commitMut.mutate({
      versionId,
      toStatus: targetStatus,
      override: overrideUsed,
      reason: overrideUsed ? overrideReason.trim() : null,
    });
  };

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-3 px-1">
        <div>
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            Promote to{" "}
            <Badge
              variant="outline"
              className="h-5 px-1.5 text-[10px] uppercase border-primary/40 text-primary bg-primary/10"
            >
              {targetStatus}
            </Badge>
          </h4>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {data.fromStatus} → {data.toStatus}
            {data.allPassed ? " · all gates pass" : " · some gates failed"}
          </p>
        </div>
      </header>

      {!data.transitionAllowed ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-300 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Transition not allowed</p>
            <p className="mt-1 text-[10px]">
              {data.transitionDeniedReason ??
                "Server policy denies this status transition."}
            </p>
          </div>
        </div>
      ) : null}

      <ul className="rounded-lg border border-white/10 bg-white/[0.02] px-3">
        {data.gates.length === 0 ? (
          <li className="text-xs text-muted-foreground py-3 text-center">
            No gates configured for this transition.
          </li>
        ) : (
          data.gates.map((g) => <GateRow key={g.id} gate={g} />)
        )}
      </ul>

      <div className="space-y-2">
        {!data.allPassed && data.transitionAllowed ? (
          <button
            type="button"
            className="text-[11px] text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline"
            onClick={() => setOverrideOpen((v) => !v)}
            data-testid="gate-override-toggle"
          >
            {overrideOpen ? "Hide override" : "Override with reason"}
          </button>
        ) : null}
        {overrideOpen ? (
          <div className="space-y-1">
            <Label htmlFor="override-reason" className="text-[10px] uppercase tracking-wider">
              Override reason
            </Label>
            <Textarea
              id="override-reason"
              rows={2}
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Required when overriding failed gates."
              className="text-xs font-mono"
              data-testid="gate-override-reason"
            />
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            dispatch({ type: "setSelectedVersion", versionId, mode: "lineage" })
          }
        >
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!canCommit || commitMut.isPending}
          onClick={handleCommit}
          data-testid="gate-commit"
        >
          {commitMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Rocket className="h-3.5 w-3.5 mr-1" />
          )}
          Promote to {targetStatus}
        </Button>
      </div>
    </section>
  );
}
