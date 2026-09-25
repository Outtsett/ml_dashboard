/**
 * Model Cycle — pick a model, press Play, watch it train, tune, validate and
 * trade bar by bar. Route `/cycle`, opened in the resizable side panel over
 * the Market chart (`App.tsx`).
 *
 * Owns the setup form's state and the connection lifecycle; the run's data
 * lives in `useCycleStore`, fed by `connection.ts`. The chart, terminal,
 * scoreboard, trades, folds and curves panels are other builders' files —
 * imported here as-is, each reading the store directly with zero props.
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleCheck,
  Loader2,
  OctagonX,
  PlayCircle,
  SquareStop,
} from "lucide-react";

import { cn } from "@/shared/utils/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Button } from "@/shared/ui/button";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";

import { attachLatest } from "@/cycle/connection";
import { ConfigForm, createInitialCycleFormState, type CycleFormState } from "@/cycle/ConfigForm";
import { Controls } from "@/cycle/Controls";
import { PhaseStrip } from "@/cycle/PhaseStrip";
import { useCycleStore, type CycleClientStatus } from "@/cycle/store";
import { useCycleCatalog } from "@/cycle/useCycleCatalog";

import { CycleScoreboard } from "@/cycle/Scoreboard";
import { CycleTerminal } from "@/cycle/Terminal";
import { CycleTrades } from "@/cycle/Trades";
import { CycleFolds } from "@/cycle/Folds";
import { CycleCurves } from "@/cycle/Curves";

const STATUS_META: Record<CycleClientStatus, { label: string; icon: typeof Circle; className: string }> = {
  idle: { label: "Idle", icon: Circle, className: "border-white/15 text-neutral-400" },
  starting: { label: "Starting…", icon: Loader2, className: "border-[#56B4E9]/50 bg-[#56B4E9]/10 text-[#56B4E9]" },
  running: { label: "Running", icon: PlayCircle, className: "border-[#E69F00]/50 bg-[#E69F00]/10 text-[#E69F00]" },
  complete: { label: "Complete", icon: CircleCheck, className: "border-[#009E73]/50 bg-[#009E73]/10 text-[#009E73]" },
  failed: { label: "Failed", icon: OctagonX, className: "border-[#D55E00]/50 bg-[#D55E00]/10 text-[#D55E00]" },
  stopped: { label: "Stopped", icon: SquareStop, className: "border-white/20 text-neutral-400" },
};

function StatusChip({ status }: { status: CycleClientStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold", meta.className)}>
      <Icon className={cn("h-3.5 w-3.5", status === "starting" && "animate-spin")} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export default function CyclePage() {
  const status = useCycleStore((state) => state.status);
  const error = useCycleStore((state) => state.error);
  const plan = useCycleStore((state) => state.plan);
  const { symbol, timeframeMinutes } = useSymbolContext();
  const { entries: catalogEntries, byFamily } = useCycleCatalog();

  const [formState, setFormState] = useState<CycleFormState>(createInitialCycleFormState);
  const [setupExpanded, setSetupExpanded] = useState(true);

  useEffect(() => {
    void attachLatest();
  }, []);

  const running = status === "starting" || status === "running";
  const selectedFamilyEntry = plan
    ? byFamily.get(plan.modelFamily)
    : catalogEntries.find((entry) => entry.key === formState.familyKey);
  const familyLabel = plan?.modelLabel ?? selectedFamilyEntry?.label ?? "No model selected";
  const symbolTimeframe = plan ? `${plan.symbol} · ${plan.timeframe}` : `${symbol} · ${timeframeMinutes}m`;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 *:shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-neutral-100">Model cycle</h1>
          <p className="text-xs text-neutral-500">
            {familyLabel} · <span className="font-mono">{symbolTimeframe}</span>
          </p>
        </div>
        <StatusChip status={status} />
      </div>

      <PhaseStrip />
      <Controls formState={formState} />

      {status === "failed" && error && (
        <div className="flex items-start gap-2 rounded-lg border border-[#D55E00]/50 bg-[#D55E00]/10 px-3 py-2 text-sm text-[#D55E00]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-white/[0.02]">
        <button
          type="button"
          onClick={() => setSetupExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between px-3 py-2 text-left"
        >
          <span className="text-[10px] uppercase tracking-widest text-neutral-500">
            {running ? "Setup (running)" : "Setup"}
            {running && !setupExpanded && (
              <span className="ml-2 normal-case tracking-normal text-neutral-400">
                {familyLabel} · {formState.timeframe} · {formState.dateStart} → {formState.dateEnd}
              </span>
            )}
          </span>
          {setupExpanded ? <ChevronUp className="h-3.5 w-3.5 text-neutral-500" /> : <ChevronDown className="h-3.5 w-3.5 text-neutral-500" />}
        </button>
        {(setupExpanded || !running) && (
          <div className="border-t border-white/5 px-3 py-3">
            <ConfigForm value={formState} onChange={setFormState} disabled={running} />
          </div>
        )}
      </div>

      <CycleScoreboard />

      <Tabs defaultValue="terminal" className="flex flex-col">
        <TabsList>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="trades">Trades</TabsTrigger>
          <TabsTrigger value="folds">Folds</TabsTrigger>
          <TabsTrigger value="curves">Curves</TabsTrigger>
        </TabsList>
        {/* A definite height, not flex-1: the side panel scrolls, so flex-1
            resolves to "as tall as the content" and the virtual lists inside
            rendered every row (5,000 terminal rows, 110,000 px — measured
            2026-09-25 — re-rendered on every update, freezing the tab). */}
        <TabsContent value="terminal" className="h-[min(62vh,560px)] min-h-0">
          <CycleTerminal />
        </TabsContent>
        <TabsContent value="trades" className="h-[min(72vh,680px)] min-h-0">
          <CycleTrades />
        </TabsContent>
        <TabsContent value="folds" className="flex-1">
          <CycleFolds />
        </TabsContent>
        <TabsContent value="curves" className="flex-1">
          <CycleCurves />
        </TabsContent>
      </Tabs>

      {/* Play is reachable even with the setup panel collapsed. */}
      {!running && !setupExpanded && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setSetupExpanded(true)} className="self-start text-xs">
          Expand setup
        </Button>
      )}
    </div>
  );
}
