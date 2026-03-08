import type { Phase } from "./types";
import { PHASES } from "./types";
import { PhaseAPanel } from "./panels/PhaseAPanel";

interface PhasePanelProps {
  phase: Phase;
}

export function PhasePanel({ phase }: PhasePanelProps) {
  const info = PHASES.find((p) => p.id === phase);
  if (!info) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Unknown phase: {phase}
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="text-lg font-mono font-semibold mb-2">
        Phase {info.id}: {info.name}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">{info.description}</p>
      {phase === "A" ? (
        <PhaseAPanel />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {info.models.map((model) => (
            <div key={model} className="border border-border rounded-lg p-4 font-mono text-sm hover:bg-muted/50 transition-colors">
              <div className="font-medium">{model}</div>
              <div className="text-xs text-muted-foreground mt-1">No data yet</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
