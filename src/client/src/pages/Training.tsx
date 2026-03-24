import { useState, useEffect } from "react";
import { PhaseSidebar } from "./training/PhaseSidebar";
import { PhasePanel } from "./training/PhasePanel";
import { PipelineOverview } from "./training/PipelineOverview";
import { TrainingControls } from "./training/TrainingControls";
import { HPOWorkflow } from "./training/HPOWorkflow";
import type { Phase, PhaseStatus } from "./training/types";

export default function Training() {
  const [activePhase, setActivePhase] = useState<Phase | "overview" | "hpo">("overview");
  const [phaseStatuses, setPhaseStatuses] = useState<Record<Phase, PhaseStatus>>({
    A: "idle",
    B: "idle",
    C: "idle",
    D: "idle",
    E: "idle",
  });

  // Poll phase status from QuestDB every 5 seconds
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/training/status");
        if (!res.ok) return;
        const rows = await res.json();
        const statuses: Record<Phase, PhaseStatus> = {
          A: "idle",
          B: "idle",
          C: "idle",
          D: "idle",
          E: "idle",
        };
        for (const row of rows) {
          if (row.phase && row.latest_ts) {
            const age = Date.now() - new Date(row.latest_ts).getTime();
            statuses[row.phase as Phase] = age < 30_000 ? "running" : "completed";
          }
        }
        setPhaseStatuses(statuses);
      } catch {
        // ignore -- QuestDB may not be running
      }
    };

    poll(); // initial fetch
    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-full">
      <PhaseSidebar
        activePhase={activePhase}
        phaseStatuses={phaseStatuses}
        onSelect={setActivePhase}
      />
      <main className="flex-1 overflow-auto p-6">
        <TrainingControls />
        {activePhase === "overview" ? (
          <PipelineOverview phaseStatuses={phaseStatuses} onSelectPhase={(p) => setActivePhase(p)} />
        ) : activePhase === "hpo" ? (
          <HPOWorkflow />
        ) : (
          <PhasePanel phase={activePhase} />
        )}
      </main>
    </div>
  );
}
