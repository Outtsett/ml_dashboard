/**
 * PromoteStage — Stage 6 of the ML Studio pipeline (W7.e rewrite).
 *
 * Per `docs/plans/2026-05-09-ml-studio-workshop-integration-frontend.md` §7
 * the visual hierarchy is:
 *
 *   ┌─ Top bar (title + Refresh + filter bar) ──────────────────────────────┐
 *   ├─ RegistryTable (FOCAL) ───────────────────────────────────────────────┤
 *   │   row click → opens right Sheet drawer ──►                            │
 *   ├─ DeploymentPanel (separate concern, below registry) ──────────────────┤
 *   ├─ DeploymentLiveMetrics (lazy — W7.f sparkline strip) ─────────────────┤
 *   └───────────────────────────────────────────────────────────────────────┘
 *
 *   Right Sheet drawer:
 *     - LineageCard (mode === "lineage")
 *     - Promote-to-{nextStatus} button → swaps to PromotionGatePanel
 *     - PromotionGatePanel (mode === "promote")
 *
 * Filter bar lives in this file (single use-case; no need for a separate
 * component) — status multi-select chips, catalog combobox, symbol+timeframe
 * paired Select.
 *
 * The W8 agent panel uses `side="left"` to coexist with this drawer.
 */

import { Suspense, lazy, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Rocket,
  RefreshCw,
  Filter,
  Layers,
  Check,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { useMLStudio } from "../MLStudioContext";
import {
  RegistryTable,
  useModelVersionRegistry,
  type ModelVersionStatus,
} from "./promote/RegistryTable";
import { LineageCard } from "./promote/LineageCard";
import { PromotionGatePanel, nextStatus } from "./promote/PromotionGatePanel";
import { DeploymentPanel } from "./promote/DeploymentPanel";

// ─── Lazy W7.f live metrics strip ─────────────────────────────────────────────
//
// The sparkline strip ships in W7.f along with the `useDeploymentEvents` SSE
// hook. We import via `React.lazy` so the SSE subscription doesn't fire until
// the chunk is actually loaded; if W7.f hasn't shipped, the lazy import will
// fail and the Suspense boundary swallows the missing-module error in the
// inner ErrorBoundary fallback. (Until W7.f, the section renders a placeholder
// strip.)

const DeploymentLiveMetrics = lazy(() =>
  import("./promote/DeploymentLiveMetrics")
    .then((m) => ({ default: m.DeploymentLiveMetrics }))
    .catch(() => ({
      default: function MissingLiveMetrics() {
        return (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-3 text-[11px] text-muted-foreground text-center">
            Live metrics sparkline strip ships with W7.f.
          </div>
        );
      },
    })),
);

// ─── Filter bar primitives ───────────────────────────────────────────────────

const STATUS_OPTIONS: ModelVersionStatus[] = [
  "candidate",
  "shadow",
  "paper",
  "live",
  "retired",
];

const TIMEFRAME_OPTIONS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

function StatusChip({
  status,
  active,
  onToggle,
}: {
  status: ModelVersionStatus;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      data-testid={`registry-filter-status-${status}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wider transition-colors",
        active
          ? "border-primary bg-primary/15 text-foreground"
          : "border-white/10 bg-white/5 text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      {active ? <Check className="h-3 w-3" /> : null}
      {status}
    </button>
  );
}

function CatalogCombobox({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: string[];
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => o.toLowerCase().includes(term));
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 min-w-[140px] justify-between text-xs"
          data-testid="registry-filter-catalog"
        >
          <span className="font-mono truncate">
            {value ?? "Any catalog"}
          </span>
          <Search className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="flex items-center gap-2 mb-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search catalog…"
            className="h-7 text-xs"
            autoFocus
          />
          {value ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => {
                onChange(null);
                setSearch("");
                setOpen(false);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
        <ScrollArea className="max-h-60">
          <div className="space-y-0.5">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                No catalog ids match.
              </p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-white/5",
                    value === c && "bg-primary/10 text-foreground",
                  )}
                  data-testid={`registry-filter-catalog-option-${c}`}
                >
                  <span className="font-mono">{c}</span>
                  {value === c ? <Check className="h-3 w-3" /> : null}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

// ─── Drawer body switcher ────────────────────────────────────────────────────

function DrawerBody({ versionId }: { versionId: number }) {
  const { state, dispatch } = useMLStudio();
  const registry = useModelVersionRegistry(state.registryFilters);
  const row = registry.data?.find((r) => r.id === versionId) ?? null;
  const next = row ? nextStatus(row.status) : null;

  return (
    <div className="flex h-full flex-col gap-4">
      <ScrollArea className="-mx-6 flex-1 px-6">
        {state.drawerMode === "promote" ? (
          row ? (
            <PromotionGatePanel
              versionId={versionId}
              currentStatus={row.status}
            />
          ) : (
            <div className="text-xs text-muted-foreground py-8 text-center">
              Loading version status…
            </div>
          )
        ) : (
          <LineageCard versionId={versionId} />
        )}
      </ScrollArea>

      {state.drawerMode === "lineage" && row ? (
        <div className="border-t border-white/10 pt-3 -mx-6 px-6">
          <Button
            size="sm"
            className="w-full"
            disabled={next == null || row.status === "retired"}
            onClick={() =>
              dispatch({
                type: "setSelectedVersion",
                versionId,
                mode: "promote",
              })
            }
            data-testid="drawer-open-promote"
          >
            <Rocket className="h-3.5 w-3.5 mr-1" />
            {next ? `Promote to ${next}` : "Already retired"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PromoteStage() {
  const { state, dispatch } = useMLStudio();
  const queryClient = useQueryClient();
  const registry = useModelVersionRegistry(state.registryFilters);

  // Catalog options come from current visible rows (server-filtered).
  const catalogOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of registry.data ?? []) set.add(r.catalogId);
    return Array.from(set).sort();
  }, [registry.data]);

  const handleStatusToggle = (status: ModelVersionStatus) => {
    const cur = state.registryFilters.status;
    const next = cur.includes(status)
      ? cur.filter((s) => s !== status)
      : [...cur, status];
    dispatch({ type: "setRegistryFilters", filters: { status: next } });
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/model-versions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/deployments"] });
  };

  const drawerOpen = state.selectedVersionId != null;
  const drawerTitle =
    state.drawerMode === "promote" ? "Promote model version" : "Model version lineage";
  const drawerSub =
    state.drawerMode === "promote"
      ? "Run pre-promotion gates against thresholds and commit when ready."
      : "Provenance trail from catalog spec through training to active deployment.";

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-white/5 px-4 pb-2 pt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display flex items-center gap-2 text-xl font-bold">
            <Rocket className="h-4 w-4 text-primary" />
            Stage 6 — Promote
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handleRefresh}
            data-testid="promote-refresh"
          >
            <RefreshCw
              className={cn(
                "h-3 w-3 mr-1",
                registry.isFetching && "animate-spin",
              )}
            />
            Refresh
          </Button>
          <code className="ml-auto text-[10px] font-mono text-muted-foreground/70">
            symbol={state.symbol} · tf={state.timeframe}
          </code>
        </div>
        <p className="text-xs text-muted-foreground max-w-3xl">
          Pick a model version, review its lineage, run promotion gates, and
          deploy paper or live. Live deployments bridge to the MLBridge scoring
          engine over ZMQ; paper writes into{" "}
          <code className="text-foreground/80">prediction_log</code>.
        </p>

        {/* Filter bar */}
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="promote-filter-bar"
        >
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground/80">
            <Filter className="h-3 w-3" />
            Filters
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {STATUS_OPTIONS.map((s) => (
              <StatusChip
                key={s}
                status={s}
                active={state.registryFilters.status.includes(s)}
                onToggle={() => handleStatusToggle(s)}
              />
            ))}
          </div>
          <CatalogCombobox
            value={state.registryFilters.catalogId}
            options={catalogOptions}
            onChange={(catalogId) =>
              dispatch({ type: "setRegistryFilters", filters: { catalogId } })
            }
          />
          <div className="flex items-center gap-1">
            <Select
              value={state.registryFilters.symbol ?? "__any__"}
              onValueChange={(v) =>
                dispatch({
                  type: "setRegistryFilters",
                  filters: { symbol: v === "__any__" ? null : v },
                })
              }
            >
              <SelectTrigger
                className="h-8 w-[110px] text-xs"
                data-testid="registry-filter-symbol"
              >
                <SelectValue placeholder="Any symbol" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any symbol</SelectItem>
                <SelectItem value={state.symbol}>{state.symbol}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={state.registryFilters.timeframe ?? "__any__"}
              onValueChange={(v) =>
                dispatch({
                  type: "setRegistryFilters",
                  filters: { timeframe: v === "__any__" ? null : v },
                })
              }
            >
              <SelectTrigger
                className="h-8 w-[100px] text-xs"
                data-testid="registry-filter-timeframe"
              >
                <SelectValue placeholder="Any tf" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any timeframe</SelectItem>
                {TIMEFRAME_OPTIONS.map((tf) => (
                  <SelectItem key={tf} value={tf}>
                    {tf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4 space-y-4">
        <RegistryTable />
        <DeploymentPanel />
        <Suspense
          fallback={
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11px] text-muted-foreground text-center">
              Loading live metrics…
            </div>
          }
        >
          <DeploymentLiveMetrics />
        </Suspense>
      </div>

      <Sheet
        open={drawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            dispatch({ type: "setSelectedVersion", versionId: null });
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col gap-3"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              {drawerTitle}
            </SheetTitle>
            <SheetDescription>{drawerSub}</SheetDescription>
            {state.selectedVersionId != null ? (
              <Badge
                variant="outline"
                className="self-start h-5 px-1.5 text-[10px] font-mono"
              >
                version_id={state.selectedVersionId}
              </Badge>
            ) : null}
          </SheetHeader>
          {state.selectedVersionId != null ? (
            <DrawerBody versionId={state.selectedVersionId} />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
