/**
 * DeploymentPanel — Active deployments list + start/pause/stop/rollback.
 *
 * W7.e of `docs/plans/2026-05-09-ml-studio-workshop-integration-frontend.md`.
 * Sits *below* the RegistryTable (deployments are a separate concern from
 * promotion). Shows running paper + live deployments with their per-min
 * prediction count (live SSE counter overlaid by W7.f's
 * DeploymentLiveMetrics), paper PnL, and the action triplet.
 *
 * Start flow: top-of-panel "Start deployment" button opens a Dialog that
 * lets the user pick a registry version (paper or live mode) and submit it
 * via `POST /api/deployments`. Once the server accepts, the deployments
 * list query invalidates so the row appears.
 *
 * Per-row controls call:
 *   - `POST /api/deployments/:id/pause`
 *   - `POST /api/deployments/:id/stop`
 *   - `POST /api/deployments/:id/rollback`  (re-promote previous live version)
 *
 * The pred/min counter is hydrated from the optional `liveCounters` prop
 * threaded down by PromoteStage (which reads W7.f `useDeploymentEvents`).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Plus,
} from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Label } from "@/shared/ui/label";
import { toast } from "sonner";
import { apiRequest } from "@/infrastructure/api/query_client";
import { useMLStudio } from "../../MLStudioContext";
import {
  useModelVersionRegistry,
  type ModelVersionRow,
} from "./RegistryTable";

// ─── Types (mirror server `/api/deployments` row shape) ──────────────────────

export type DeploymentMode = "paper" | "live";
export type DeploymentStatus = "running" | "paused" | "stopped" | "failed";

export interface DeploymentRow {
  id: number;
  versionId: number;
  versionLabel: string;
  catalogId: string;
  symbol: string;
  timeframe: string;
  mode: DeploymentMode;
  status: DeploymentStatus;
  startedAt: string;
  predictionsEmitted: number;
  paperPnl: number | null;
  /** Optional drift PSI snapshot (see W7.f DeploymentLiveMetrics). */
  driftPsi: number | null;
}

export interface DeploymentLiveCounter {
  predictionsPerMin: number | null;
  paperPnl: number | null;
  driftPsi: number | null;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

const DEPLOYMENTS_QUERY_KEY = ["/api/deployments"] as const;

export function useDeployments(status: DeploymentStatus | "all" = "running") {
  return useQuery<DeploymentRow[]>({
    queryKey: [...DEPLOYMENTS_QUERY_KEY, { status }],
    queryFn: async ({ signal }) => {
      const url =
        status === "all"
          ? `/api/deployments`
          : `/api/deployments?status=${encodeURIComponent(status)}`;
      const res = await fetch(url, { signal, credentials: "include" });
      if (res.status === 404) return [];
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      const data = (await res.json()) as unknown;
      return Array.isArray(data) ? (data as DeploymentRow[]) : [];
    },
    staleTime: 15_000,
  });
}

interface ControlArgs {
  id: number;
  action: "pause" | "stop" | "rollback" | "resume";
}

function useDeploymentControl() {
  const queryClient = useQueryClient();
  return useMutation<{ id: number }, Error, ControlArgs>({
    mutationFn: async ({ id, action }) => {
      const res = await apiRequest(
        "POST",
        `/api/deployments/${id}/${action}`,
      );
      return (await res.json()) as { id: number };
    },
    onSuccess: (_, vars) => {
      toast.success(`Deployment ${vars.action}: #${vars.id}`);
      queryClient.invalidateQueries({ queryKey: DEPLOYMENTS_QUERY_KEY });
    },
    onError: (err, vars) => {
      toast.error(`Deployment ${vars.action} failed: ${err.message}`);
    },
  });
}

interface StartArgs {
  versionId: number;
  mode: DeploymentMode;
}

function useStartDeployment() {
  const queryClient = useQueryClient();
  return useMutation<DeploymentRow, Error, StartArgs>({
    mutationFn: async (args) => {
      const res = await apiRequest("POST", `/api/deployments`, {
        version_id: args.versionId,
        mode: args.mode,
      });
      return (await res.json()) as DeploymentRow;
    },
    onSuccess: (row) => {
      toast.success(`Started ${row.mode} deployment for ${row.versionLabel}`);
      queryClient.invalidateQueries({ queryKey: DEPLOYMENTS_QUERY_KEY });
    },
    onError: (err) => {
      toast.error(`Failed to start deployment: ${err.message}`);
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtPnl(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toFixed(0)}`;
}

function fmtNumber(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function pnlClass(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v > 0) return "text-[hsl(var(--data-pos))]";
  if (v < 0) return "text-[hsl(var(--data-neg))]";
  return "text-muted-foreground";
}

function modeVisual(mode: DeploymentMode): string {
  return mode === "live"
    ? "border-[hsl(var(--data-neg)/0.4)] text-[hsl(var(--data-neg))] bg-[hsl(var(--data-neg)/0.1)]"
    : "border-primary/40 text-primary bg-primary/10";
}

function statusVisual(status: DeploymentStatus): string {
  switch (status) {
    case "running":
      return "border-[hsl(var(--data-pos)/0.4)] text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.1)]";
    case "paused":
      return "border-amber-500/40 text-amber-300 bg-amber-500/10";
    case "failed":
      return "border-[hsl(var(--data-neg)/0.4)] text-[hsl(var(--data-neg))] bg-[hsl(var(--data-neg)/0.1)]";
    case "stopped":
      return "border-white/15 text-muted-foreground bg-white/5";
  }
}

// ─── Start dialog ────────────────────────────────────────────────────────────

interface StartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registry: ModelVersionRow[];
  registryLoading: boolean;
}

function StartDeploymentDialog({
  open,
  onOpenChange,
  registry,
  registryLoading,
}: StartDialogProps) {
  const [versionId, setVersionId] = useState<string>("");
  const [mode, setMode] = useState<DeploymentMode>("paper");
  const startMut = useStartDeployment();

  // Restrict the picker to versions that have at least reached "shadow".
  const eligible = useMemo(
    () =>
      registry.filter(
        (r) => r.status === "shadow" || r.status === "paper" || r.status === "live",
      ),
    [registry],
  );

  const handleStart = () => {
    const id = Number(versionId);
    if (!Number.isFinite(id) || id <= 0) {
      toast.error("Pick a model version");
      return;
    }
    startMut.mutate(
      { versionId: id, mode },
      {
        onSuccess: () => {
          onOpenChange(false);
          setVersionId("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start deployment</DialogTitle>
          <DialogDescription>
            Pick a registered model version and a mode. Paper streams predictions
            into <code className="font-mono">prediction_log</code>; live scores
            each bar through the MLBridge ZMQ engine.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Model version</Label>
            <Select value={versionId} onValueChange={setVersionId}>
              <SelectTrigger
                className="h-9 text-xs"
                data-testid="start-deploy-version"
              >
                <SelectValue
                  placeholder={
                    registryLoading
                      ? "Loading…"
                      : eligible.length === 0
                        ? "No eligible versions"
                        : "Pick a version"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {eligible.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    <span className="font-mono text-xs">
                      {r.versionId} · {r.catalogId} · {r.symbol}/{r.timeframe} ·{" "}
                      {r.status}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mode</Label>
            <Select
              value={mode}
              onValueChange={(v) => setMode(v as DeploymentMode)}
            >
              <SelectTrigger
                className="h-9 text-xs"
                data-testid="start-deploy-mode"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paper">Paper (simulator)</SelectItem>
                <SelectItem value="live">Live (MLBridge)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleStart}
            disabled={!versionId || startMut.isPending}
            data-testid="start-deploy-submit"
          >
            {startMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1" />
            )}
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface DeploymentPanelProps {
  /**
   * Per-deployment live counter map (deploymentId → counter snapshot).
   * Threaded down by PromoteStage which subscribes to W7.f's
   * `useDeploymentEvents` hook. Optional — when omitted the row reads the
   * polled values from the deployments query (no per-min rate).
   */
  liveCounters?: Record<number, DeploymentLiveCounter>;
  /** Override deployments (testing hook). */
  deployments?: DeploymentRow[];
}

export function DeploymentPanel({
  liveCounters,
  deployments: deploymentsOverride,
}: DeploymentPanelProps) {
  const { state } = useMLStudio();
  const queryEnabled = deploymentsOverride === undefined;
  const deploymentsQ = useDeployments("running");
  const deployments = deploymentsOverride ?? deploymentsQ.data ?? [];

  const registryQ = useModelVersionRegistry(state.registryFilters);
  const control = useDeploymentControl();

  const [startOpen, setStartOpen] = useState(false);

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <header className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[hsl(var(--data-pos))]" />
          <h3 className="text-sm font-semibold text-foreground">
            Active deployments
          </h3>
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] border-[hsl(var(--data-pos)/0.3)] text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.1)]"
          >
            {deployments.length}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => setStartOpen(true)}
          data-testid="start-deploy-open"
        >
          <Plus className="h-3 w-3 mr-1" />
          Start deployment
        </Button>
      </header>

      {queryEnabled && deploymentsQ.isLoading ? (
        <div className="px-5 py-10 text-center text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 mx-auto mb-2 animate-spin" />
          Loading deployments…
        </div>
      ) : queryEnabled && deploymentsQ.isError ? (
        <div className="px-5 py-10 text-center text-xs text-[hsl(var(--data-neg))]">
          <AlertCircle className="h-5 w-5 mx-auto mb-2" />
          Failed to load deployments:{" "}
          <span className="font-mono">
            {(deploymentsQ.error as Error)?.message}
          </span>
        </div>
      ) : deployments.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium text-foreground/80">
            No active deployments
          </p>
          <p className="mt-1 text-muted-foreground/80">
            Promote a model in the registry above to <code>shadow</code>, then
            click <span className="text-foreground">Start deployment</span>.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/5">
          {deployments.map((d) => {
            const live = liveCounters?.[d.id];
            const predPerMin = live?.predictionsPerMin;
            const pnl = live?.paperPnl ?? d.paperPnl;
            const drift = live?.driftPsi ?? d.driftPsi;
            const busy = control.isPending && control.variables?.id === d.id;
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
                data-testid={`deployment-row-${d.id}`}
              >
                <div className="flex items-center gap-2 min-w-[180px]">
                  <span className="font-mono text-xs text-foreground">
                    {d.symbol}/{d.timeframe}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-5 px-1.5 text-[10px] uppercase",
                      modeVisual(d.mode),
                    )}
                  >
                    {d.mode}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-5 px-1.5 text-[10px] uppercase",
                      statusVisual(d.status),
                    )}
                  >
                    {d.status}
                  </Badge>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground min-w-[120px] truncate">
                  {d.versionLabel}
                </div>
                <div className="flex items-baseline gap-1 text-xs min-w-[100px]">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    pred/min
                  </span>
                  <span className="font-mono text-foreground">
                    {predPerMin != null ? predPerMin.toFixed(0) : "—"}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 text-xs min-w-[100px]">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    paper PnL
                  </span>
                  <span className={cn("font-mono", pnlClass(pnl))}>
                    {fmtPnl(pnl)}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 text-xs min-w-[80px]">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    drift
                  </span>
                  <span
                    className={cn(
                      "font-mono",
                      drift != null && drift > 0.2
                        ? "text-amber-300"
                        : "text-foreground",
                    )}
                  >
                    {fmtNumber(drift, 2)}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[10px]"
                    disabled={busy || d.status !== "running"}
                    onClick={() => control.mutate({ id: d.id, action: "pause" })}
                    data-testid={`deployment-pause-${d.id}`}
                  >
                    <Pause className="h-3 w-3 mr-1" />
                    Pause
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[10px] text-[hsl(var(--data-neg))] hover:text-[hsl(var(--data-neg))]"
                    disabled={busy}
                    onClick={() => control.mutate({ id: d.id, action: "stop" })}
                    data-testid={`deployment-stop-${d.id}`}
                  >
                    <Square className="h-3 w-3 mr-1" />
                    Stop
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[10px] text-amber-300 hover:text-amber-200"
                    disabled={busy || d.mode !== "live"}
                    onClick={() =>
                      control.mutate({ id: d.id, action: "rollback" })
                    }
                    data-testid={`deployment-rollback-${d.id}`}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Rollback
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <StartDeploymentDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        registry={registryQ.data ?? []}
        registryLoading={registryQ.isLoading}
      />
    </section>
  );
}
